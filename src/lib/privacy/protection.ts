import type { EncryptedPayload, Folder, Note, SavedLink } from '@/db/types';
import { decryptJson, encryptJson, isEncryptedPayload } from './crypto';

/**
 * What "locked" means in Stash.
 *
 * Two independent things are true of a locked item, and both matter:
 *
 *  1. It is **sealed**. Its secret fields are replaced by AES-GCM ciphertext in
 *     the database, so nothing sensitive survives in IndexedDB at rest. Sealing
 *     is not a UI trick: with the session locked and the key discarded, the
 *     plaintext genuinely is not present to be shown, indexed or leaked.
 *  2. It is **hidden** while the session is locked — from search, recents,
 *     previews, pickers, counts and snippets.
 *
 * A folder lock is *inherited*: everything beneath a locked folder is protected
 * exactly as if it had been locked itself. Inheritance is derived rather than
 * stored, so moving an item into or out of a locked folder cannot leave a
 * record that is hidden but readable, or readable but hidden. Deriving it means
 * the two sets below are always consistent with each other by construction.
 */

/** Ids that are locked, either in their own right or through an ancestor. */
export interface Protection {
  folders: Set<string>;
  notes: Set<string>;
  links: Set<string>;
}

export const EMPTY_PROTECTION: Protection = {
  folders: new Set(),
  notes: new Set(),
  links: new Set(),
};

export function hasAnyProtection(protection: Protection): boolean {
  return protection.folders.size > 0 || protection.notes.size > 0 || protection.links.size > 0;
}

/**
 * Resolve the effective lock set for the whole vault in one pass.
 *
 * Each family is walked root-down using the parent links the vault already
 * stores (`parentId`, `parentNoteId`), so a folder five levels under a locked
 * folder is protected without the user having to lock it too. Cycles — which can
 * only come from hand-edited or imported data — terminate instead of hanging.
 */
export function computeProtection(
  folders: readonly Folder[],
  notes: readonly Note[],
  links: readonly SavedLink[],
): Protection {
  const lockedFolders = new Set<string>();
  for (const folder of folders) if (folder.isLocked) lockedFolders.add(folder.id);

  const folderParent = new Map<string, string | null>();
  for (const folder of folders) folderParent.set(folder.id, folder.parentId);

  const protectedFolders = new Set<string>();
  for (const folder of folders) {
    let cursor: string | null = folder.id;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      if (lockedFolders.has(cursor)) {
        protectedFolders.add(folder.id);
        break;
      }
      cursor = folderParent.get(cursor) ?? null;
    }
  }

  const lockedNotes = new Set<string>();
  for (const note of notes) if (note.isLocked) lockedNotes.add(note.id);

  const noteParent = new Map<string, string | null>();
  for (const note of notes) noteParent.set(note.id, note.parentNoteId);

  const protectedNotes = new Set<string>();
  for (const note of notes) {
    let cursor: string | null = note.id;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      if (lockedNotes.has(cursor)) {
        protectedNotes.add(note.id);
        break;
      }
      cursor = noteParent.get(cursor) ?? null;
    }
  }

  // A link is protected when it is locked itself, or when it lives anywhere
  // inside a locked folder. A link referenced *by* a locked note is not covered:
  // links are owned by folders, and the same link may legitimately be visible in
  // the Library while a private note happens to reference it.
  const protectedLinks = new Set<string>();
  for (const link of links) {
    if (link.isLocked) {
      protectedLinks.add(link.id);
      continue;
    }
    if (link.folderId && protectedFolders.has(link.folderId)) protectedLinks.add(link.id);
  }

  return { folders: protectedFolders, notes: protectedNotes, links: protectedLinks };
}

/** Ids a locked session must not reveal. Deliberately empty when unlocked. */
export interface HiddenIds {
  folders: ReadonlySet<string>;
  notes: ReadonlySet<string>;
  links: ReadonlySet<string>;
}

const EMPTY_HIDDEN: HiddenIds = {
  folders: new Set(),
  notes: new Set(),
  links: new Set(),
};

/**
 * The ids to withhold from every listing surface.
 *
 * This is the single choke point for the entire "do not leak" requirement: when
 * the session is locked, protected ids are hidden; when it is unlocked they are
 * ordinary items again. Deriving it from {@link Protection} means a new listing
 * surface cannot get the rule subtly different — it either consults this or it
 * is operating on already-filtered data.
 */
export function hiddenIds(protection: Protection, sessionLocked: boolean): HiddenIds {
  if (!sessionLocked) return EMPTY_HIDDEN;
  return { folders: protection.folders, notes: protection.notes, links: protection.links };
}

export function isHidden(hidden: HiddenIds, kind: 'folder' | 'note' | 'link', id: string): boolean {
  if (kind === 'folder') return hidden.folders.has(id);
  if (kind === 'note') return hidden.notes.has(id);
  return hidden.links.has(id);
}

// ---------------------------------------------------------------------------
// Sealing
//
// The persisted shapes below are the *only* place a secret is allowed to become
// ciphertext. Each pair is symmetric: sealing blanks the plaintext fields and
// stores the payload; opening restores them and drops the payload, so an
// in-memory object never carries both.
// ---------------------------------------------------------------------------

interface NoteSecret {
  title: string;
  content: string;
}

interface LinkSecret {
  url: string;
  normalizedUrl: string;
  title?: string;
  description?: string;
  userNote?: string;
  rawText?: string;
  source?: string;
}

interface FolderSecret {
  name: string;
  icon?: string;
}

/** True when a row on disk is ciphertext rather than plaintext. */
export function isSealed(row: { enc?: EncryptedPayload }): boolean {
  return isEncryptedPayload(row.enc);
}

/**
 * Seal a note.
 *
 * Throws when no key is available. That is intentional: silently writing
 * plaintext for an item the user believes is locked would be the worst possible
 * failure, so the write is refused instead.
 */
export async function sealNote(note: Note, key: CryptoKey | null): Promise<Note> {
  if (isSealed(note)) return note;
  if (!key) throw new Error('Cannot lock a note while the vault is locked.');
  const secret: NoteSecret = { title: note.title, content: note.content };
  return { ...note, title: '', content: '', enc: await encryptJson(key, secret) };
}

/** Restore a note's plaintext. Without a key the blanked fields stay blank. */
export async function openNote(note: Note, key: CryptoKey | null): Promise<Note> {
  if (!isSealed(note)) return note;
  if (!key) return { ...note, title: '', content: '' };
  const secret = await decryptJson<NoteSecret>(key, note.enc as EncryptedPayload);
  const opened: Note = { ...note, title: secret.title, content: secret.content };
  delete opened.enc;
  return opened;
}

/**
 * Seal a link.
 *
 * The address goes in with everything else, so a sealed link leaves no URL, no
 * domain and no title readable in the database. `normalizedUrl` is blanked too:
 * dedupe must not report "you already saved this" from behind a lock, because
 * that answer would itself disclose a locked item's existence.
 */
export async function sealLink(link: SavedLink, key: CryptoKey | null): Promise<SavedLink> {
  if (isSealed(link)) return link;
  if (!key) throw new Error('Cannot lock a link while the vault is locked.');
  const secret: LinkSecret = { url: link.url, normalizedUrl: link.normalizedUrl };
  if (link.title !== undefined) secret.title = link.title;
  if (link.description !== undefined) secret.description = link.description;
  if (link.userNote !== undefined) secret.userNote = link.userNote;
  if (link.rawText !== undefined) secret.rawText = link.rawText;
  if (link.source !== undefined) secret.source = link.source;

  const sealed: SavedLink = { ...link, url: '', normalizedUrl: '', enc: await encryptJson(key, secret) };
  delete sealed.title;
  delete sealed.description;
  delete sealed.userNote;
  delete sealed.rawText;
  delete sealed.source;
  return sealed;
}

export async function openLink(link: SavedLink, key: CryptoKey | null): Promise<SavedLink> {
  if (!isSealed(link)) return link;
  if (!key) return link;
  const secret = await decryptJson<LinkSecret>(key, link.enc as EncryptedPayload);
  const opened: SavedLink = { ...link, url: secret.url, normalizedUrl: secret.normalizedUrl };
  delete opened.enc;
  if (secret.title !== undefined) opened.title = secret.title;
  if (secret.description !== undefined) opened.description = secret.description;
  if (secret.userNote !== undefined) opened.userNote = secret.userNote;
  if (secret.rawText !== undefined) opened.rawText = secret.rawText;
  if (secret.source !== undefined) opened.source = secret.source;
  return opened;
}

/** Seal a folder. The name is the secret — "Divorce" is as sensitive as a URL. */
export async function sealFolder(folder: Folder, key: CryptoKey | null): Promise<Folder> {
  if (isSealed(folder)) return folder;
  if (!key) throw new Error('Cannot lock a folder while the vault is locked.');
  const secret: FolderSecret = { name: folder.name };
  if (folder.icon !== undefined) secret.icon = folder.icon;

  const sealed: Folder = { ...folder, name: '', enc: await encryptJson(key, secret) };
  delete sealed.icon;
  return sealed;
}

export async function openFolder(folder: Folder, key: CryptoKey | null): Promise<Folder> {
  if (!isSealed(folder)) return folder;
  if (!key) return folder;
  const secret = await decryptJson<FolderSecret>(key, folder.enc as EncryptedPayload);
  const opened: Folder = { ...folder, name: secret.name };
  delete opened.enc;
  if (secret.icon !== undefined) opened.icon = secret.icon;
  return opened;
}

/**
 * Restore every secret in a vault read. Used by the snapshot path, which is the
 * only way the UI ever sees data, so decryption happens in exactly one place.
 */
export interface RawVault {
  folders: Folder[];
  notes: Note[];
  links: SavedLink[];
}

/**
 * Open as much of a vault read as will open.
 *
 * This is the lenient counterpart to the strict openers above, and the
 * difference is deliberate:
 *
 *  - on a *write* path the strict behaviour is required, because editing a row
 *    that failed to decrypt would overwrite content we could not read;
 *  - on a *read* path one unopenable row must not take down the whole vault.
 *
 * That second case is not hypothetical: importing a backup from a device with a
 * different keyring can bring in ciphertext this device holds no key for. The
 * honest outcomes there are "show it as locked" or "refuse the whole read", and
 * refusing would make an unrelated backup unopenable. So the row keeps its
 * ciphertext, its fields stay blank, and the UI presents it as locked rather
 * than pretending it is empty.
 */
export async function openVault(raw: RawVault, key: CryptoKey | null): Promise<RawVault> {
  const attempt = async <T>(row: T, open: (value: T, k: CryptoKey | null) => Promise<T>): Promise<T> => {
    try {
      return await open(row, key);
    } catch (error) {
      console.warn('[stash] could not open a sealed record', error);
      return row;
    }
  };

  const [folders, notes, links] = await Promise.all([
    Promise.all(raw.folders.map((folder) => attempt(folder, openFolder))),
    Promise.all(raw.notes.map((note) => attempt(note, openNote))),
    Promise.all(raw.links.map((link) => attempt(link, openLink))),
  ]);
  return { folders, notes, links };
}
