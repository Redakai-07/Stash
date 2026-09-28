import {
  db,
  eraseDatabase,
  type ExportBundle,
  type Folder,
  type LinkTag,
  type IncomingFolder,
  type IncomingLink,
  type IncomingNote,
  type Note,
  type NoteLink,
  type SavedLink,
  type Tag,
} from '../index';
import type { VaultSnapshot } from '@/lib/search';
import { normalizeUrl } from '@/lib/url/normalize';
import { domainOf } from '@/lib/url/extract';
import { deriveNoteTitle, sanitizeNoteTitle } from '@/lib/notes';
import { isEncryptedPayload } from '@/lib/privacy/crypto';
import { getVaultKey, readKeyring, toExportedKeyring } from '@/lib/privacy/keyring';
import { adoptExportedKeyring } from '@/lib/privacy/keyring';
import { isSealed, openVault } from '@/lib/privacy/protection';
import { reconcileProtection } from '@/lib/privacy/reconcile';
import { countTrashed } from './trash';
import { liveOnly } from '@/lib/trash';

/**
 * Whole-vault operations: reading a consistent snapshot, exporting to a file
 * the user owns, importing it back, and erasing everything.
 *
 * The snapshot/export split matters for privacy. A **snapshot** is what the UI
 * renders: it is opened, so sealed rows arrive as plaintext for an unlocked
 * session and as blank placeholders for a locked one. An **export** is what the
 * user owns and stores elsewhere: it keeps sealed rows sealed, because a backup
 * file must not silently become a plaintext copy of exactly the content the user
 * asked to protect.
 */

/** Read every row exactly as stored, ciphertext included. */
async function readVaultRaw(): Promise<VaultSnapshot> {
  // Dexie's positional form is limited to five tables, so the array form is used
  // once a transaction spans the whole vault.
  return db.transaction('r', [db.folders, db.links, db.tags, db.linkTags, db.notes, db.noteLinks], async () => {
    const [folders, links, tags, linkTags, notes, noteLinks] = await Promise.all([
      db.folders.toArray(),
      db.links.toArray(),
      db.tags.toArray(),
      db.linkTags.toArray(),
      db.notes.toArray(),
      db.noteLinks.toArray(),
    ]);
    return { folders, links, tags, linkTags, notes, noteLinks };
  });
}

/**
 * One consistent read of everything the UI needs, with secrets restored.
 *
 * Decryption happens here — after the transaction has closed, never inside it —
 * so the read stays a plain database operation and the crypto never holds an
 * IndexedDB transaction open.
 *
 * Rows that have been thrown away are left out, and so are the references that
 * pointed at them. This is the single place the trash filter is applied, for the
 * same reason the lock filter has a single place: a screen that reads the
 * snapshot cannot accidentally show a deleted row, because a deleted row is not
 * in the snapshot. The trash itself reads the database directly, so it is the
 * one surface that can still see them.
 */
export async function getSnapshot(): Promise<VaultSnapshot> {
  const raw = await readVaultRaw();
  const opened = await openVault(
    { folders: raw.folders, notes: raw.notes, links: raw.links },
    getVaultKey(),
  );

  const folders = liveOnly(opened.folders);
  const links = liveOnly(opened.links);
  const notes = liveOnly(opened.notes);
  const linkIds = new Set(links.map((row) => row.id));
  const noteIds = new Set(notes.map((row) => row.id));

  return {
    folders,
    links,
    notes,
    tags: raw.tags,
    // A reference to something in the trash describes a relationship the UI
    // cannot show either end of, so it goes with the row.
    linkTags: raw.linkTags.filter((row) => linkIds.has(row.linkId)),
    noteLinks: raw.noteLinks.filter((row) => noteIds.has(row.noteId) && linkIds.has(row.linkId)),
  };
}

/** Whether the vault currently holds anything recoverable. */
export async function trashSummary(): Promise<{ folders: number; links: number; notes: number }> {
  return countTrashed();
}

/**
 * The legacy `stash-export` format, kept as an interop boundary.
 *
 * The app no longer uses this to move data: `lib/backup` owns that, with the
 * versioned `stash-backup` format, full validation and a planned, atomic
 * restore. What remains here is the old shape on purpose, for one reason — the
 * reader that accepts files written by earlier builds can only be trusted if it
 * is tested against files those builds would actually have produced, and the
 * only honest way to make such a file in a test is to write one with the old
 * writer. A hand-written fixture would just be our guess at what the old format
 * looked like.
 *
 * Nothing in the UI calls `exportVault` or `importVault`. Imports that go through
 * them skip the reference, hierarchy and corruption checks, which is exactly why
 * they are no longer a product path.
 *
 * Sealed rows travel as ciphertext, together with the passcode-wrapped keyring.
 * That combination is what makes a locked item restorable rather than lost: the
 * destination device can adopt the keyring and open the item with the same
 * passcode. The device-bound wrapping is deliberately left behind — it only
 * means something on the phone that created it.
 */
export async function exportVault(): Promise<ExportBundle> {
  const snapshot = await readVaultRaw();
  const meta = await db.meta.toArray();
  const keyring = await readKeyring();

  const bundle: ExportBundle = {
    format: 'stash-export',
    // Version 3 adds the keyring envelope and sealed rows. Versions 1 and 2
    // still import: the keyring is simply absent.
    version: 3,
    exportedAt: Date.now(),
    folders: snapshot.folders,
    links: snapshot.links,
    tags: snapshot.tags,
    linkTags: snapshot.linkTags,
    notes: snapshot.notes,
    noteLinks: snapshot.noteLinks,
    // Schema bookkeeping is rebuilt on the destination device, and the security
    // table is not a `meta` row at all, so it cannot be dragged out by accident.
    meta: meta.filter((row) => row.key !== 'db.schemaInfo' && row.key !== 'db.seeded'),
  };

  if (keyring) bundle.security = { keyring: toExportedKeyring(keyring) };
  return bundle;
}

/** Statistics about what a bundle holds, for the export confirmation. */
export function describeBundleLocks(bundle: ExportBundle): {
  sealedFolders: number;
  sealedNotes: number;
  sealedLinks: number;
  hasKeyring: boolean;
} {
  return {
    sealedFolders: bundle.folders.filter(isSealed).length,
    sealedNotes: (bundle.notes ?? []).filter(isSealed).length,
    sealedLinks: bundle.links.filter(isSealed).length,
    hasKeyring: Boolean(bundle.security?.keyring),
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  ok: boolean;
  message?: string;
  foldersImported: number;
  linksImported: number;
  notesImported: number;
  foldersSkipped: number;
  linksSkipped: number;
  notesSkipped: number;
  /**
   * True when a passcode-wrapped keyring arrived and this device had none, so
   * the backup's locked content can be opened with the original passcode.
   */
  keyringAdopted: boolean;
  /** Rows that arrived sealed, and so stay locked rather than readable. */
  lockedImported: number;
}

export function isValidBundle(value: unknown): value is ExportBundle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExportBundle>;
  return (
    candidate.format === 'stash-export' &&
    Array.isArray(candidate.folders) &&
    Array.isArray(candidate.links)
  );
}

/**
 * Import a legacy bundle. See the note on `exportVault` above: this is the
 * interop path for files written by earlier builds, not what the app uses.
 *
 * `merge` keeps what is already there and skips items whose ids already exist.
 * `replace` wipes the vault first.
 */
export async function importVault(bundle: ExportBundle, mode: ImportMode): Promise<ImportResult> {
  const result: ImportResult = {
    ok: false,
    foldersImported: 0,
    linksImported: 0,
    notesImported: 0,
    foldersSkipped: 0,
    linksSkipped: 0,
    notesSkipped: 0,
    keyringAdopted: false,
    lockedImported: 0,
  };

  try {
    await db.transaction(
      'rw',
      [db.folders, db.links, db.tags, db.linkTags, db.notes, db.noteLinks, db.meta],
      async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.links.clear(),
          db.linkTags.clear(),
          db.folders.clear(),
          db.tags.clear(),
          db.noteLinks.clear(),
          db.notes.clear(),
        ]);
      }

      const existingFolderIds = new Set((await db.folders.toArray()).map((folder) => folder.id));
      const existingLinkIds = new Set((await db.links.toArray()).map((link) => link.id));

      const foldersToAdd: Folder[] = [];
      const incomingFolders = bundle.folders.filter(isFolderish);
      for (const folder of incomingFolders) {
        if (existingFolderIds.has(folder.id)) {
          result.foldersSkipped += 1;
          continue;
        }
        foldersToAdd.push(normalizeFolder(folder));
        if (isSealed(folder)) result.lockedImported += 1;
        existingFolderIds.add(folder.id);
      }
      if (foldersToAdd.length > 0) await db.folders.bulkPut(foldersToAdd);
      result.foldersImported = foldersToAdd.length;

      const knownFolderIds = new Set((await db.folders.toArray()).map((folder) => folder.id));
      const linksToAdd: SavedLink[] = [];
      const incomingLinks = bundle.links.filter(isLinkish);
      for (const link of incomingLinks) {
        if (existingLinkIds.has(link.id)) {
          result.linksSkipped += 1;
          continue;
        }
        linksToAdd.push(normalizeLink(link, knownFolderIds));
        if (isSealed(link)) result.lockedImported += 1;
        existingLinkIds.add(link.id);
      }
      if (linksToAdd.length > 0) await db.links.bulkPut(linksToAdd);
      result.linksImported = linksToAdd.length;

      if (Array.isArray(bundle.tags) && bundle.tags.length > 0) {
        const known = new Set((await db.tags.toArray()).map((tag) => tag.id));
        const tagsToAdd = bundle.tags.filter((tag) => isTagish(tag) && !known.has(tag.id));
        if (tagsToAdd.length > 0) await db.tags.bulkPut(tagsToAdd.map((tag) => ({ id: tag.id, name: String(tag.name) })));
      }

      if (Array.isArray(bundle.linkTags) && bundle.linkTags.length > 0) {
        const validLinks = new Set((await db.links.toArray()).map((link) => link.id));
        const validTags = new Set((await db.tags.toArray()).map((tag) => tag.id));
        const linkTags = bundle.linkTags.filter(
          (linkTag): linkTag is LinkTag =>
            isLinkTagish(linkTag) && validLinks.has(linkTag.linkId) && validTags.has(linkTag.tagId),
        );
        if (linkTags.length > 0) await db.linkTags.bulkPut(linkTags);
      }

      // ---- Notes ---------------------------------------------------------
      // Same merge contract as folders: ids already present are skipped, so
      // re-importing a file never duplicates a note. A version 1 bundle simply
      // has no `notes` array and this block does nothing.
      const existingNoteIds = new Set((await db.notes.toArray()).map((note) => note.id));
      const incomingNotes = (bundle.notes ?? []).filter(isNotish);
      // Parent links are validated against the union of what is already here and
      // what is arriving, so a child is not orphaned just because its parent
      // happened to be listed later in the file.
      const resolvableNoteIds = new Set(existingNoteIds);
      for (const note of incomingNotes) resolvableNoteIds.add(note.id);

      const notesToAdd: Note[] = [];
      for (const note of incomingNotes) {
        if (existingNoteIds.has(note.id)) {
          result.notesSkipped += 1;
          continue;
        }
        notesToAdd.push(normalizeNote(note, resolvableNoteIds));
        if (isSealed(note)) result.lockedImported += 1;
        existingNoteIds.add(note.id);
      }
      if (notesToAdd.length > 0) await db.notes.bulkPut(notesToAdd);
      result.notesImported = notesToAdd.length;

      const knownNoteIds = new Set((await db.notes.toArray()).map((note) => note.id));
      const knownLinkIds = new Set((await db.links.toArray()).map((link) => link.id));
      const noteLinks = (bundle.noteLinks ?? []).filter(
        (row): row is NoteLink =>
          isNoteLinkish(row) && knownNoteIds.has(row.noteId) && knownLinkIds.has(row.linkId),
      );
      if (noteLinks.length > 0) await db.noteLinks.bulkPut(noteLinks);

      if (Array.isArray(bundle.meta)) {
        const rows = bundle.meta.filter(
          (row) => row && typeof row.key === 'string' && row.key !== 'db.schemaInfo' && row.key !== 'db.seeded',
        );
        if (rows.length > 0) await db.meta.bulkPut(rows);
      }
      },
    );

    // Adopt the backup's keyring only when this device has none. Taking over an
    // existing one would orphan everything already sealed here, so it is never
    // done implicitly — the bundle's locked rows simply stay locked.
    result.keyringAdopted = await adoptExportedKeyring(bundle.security?.keyring);

    // An imported vault can cross a lock boundary (a subfolder restored under a
    // locked parent), so sealing is re-derived once the rows are in place.
    await reconcileProtection();

    result.ok = true;
    return result;
  } catch (error) {
    result.ok = false;
    result.message = error instanceof Error ? error.message : 'Import failed.';
    return result;
  }
}

function isFolderish(value: unknown): value is IncomingFolder {
  if (!value || typeof value !== 'object') return false;
  const folder = value as Partial<Folder>;
  return typeof folder.id === 'string' && typeof folder.name === 'string';
}

function isLinkish(value: unknown): value is IncomingLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<SavedLink>;
  return typeof link.id === 'string' && typeof link.url === 'string';
}

function isTagish(value: unknown): value is Tag {
  if (!value || typeof value !== 'object') return false;
  const tag = value as Partial<Tag>;
  return typeof tag.id === 'string' && typeof tag.name === 'string';
}

function isLinkTagish(value: unknown): value is LinkTag {
  if (!value || typeof value !== 'object') return false;
  const linkTag = value as Partial<LinkTag>;
  return typeof linkTag.linkId === 'string' && typeof linkTag.tagId === 'string';
}

function isNotish(value: unknown): value is IncomingNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  return typeof note.id === 'string' && typeof note.title === 'string';
}

function isNoteLinkish(value: unknown): value is NoteLink {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<NoteLink>;
  return typeof row.noteId === 'string' && typeof row.linkId === 'string';
}

/**
 * Coerce an incoming note into a valid row.
 *
 * A note whose parent is missing from both the file and the vault is promoted to
 * a root note: silently dropping it would be data loss, and pointing at a
 * non-existent parent would make it unreachable.
 */
function normalizeNote(note: IncomingNote, resolvableNoteIds: ReadonlySet<string>): Note {
  const now = Date.now();
  const enc = note.enc;
  const sealed = isEncryptedPayload(enc);
  const content = typeof note.content === 'string' ? note.content : '';
  const title = sanitizeNoteTitle(note.title ?? '');

  const record: Note = {
    id: note.id,
    parentNoteId:
      typeof note.parentNoteId === 'string' && resolvableNoteIds.has(note.parentNoteId)
        ? note.parentNoteId
        : null,
    // A sealed note has no plaintext to normalise, and deriving a title from an
    // empty body would invent one. It stays blank.
    title: sealed ? '' : title.length > 0 ? title : deriveNoteTitle(content),
    content: sealed ? '' : content,
    createdAt: typeof note.createdAt === 'number' ? note.createdAt : now,
    updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : now,
    sortOrder: typeof note.sortOrder === 'number' ? note.sortOrder : 0,
    isFavorite: Boolean(note.isFavorite),
    isArchived: Boolean(note.isArchived),
    // Sealed implies locked. Letting a sealed row arrive marked unlocked would
    // invite reconciliation to decrypt-and-unseal content the owner expected to
    // stay protected.
    isLocked: sealed ? true : Boolean(note.isLocked),
  };
  if (sealed && enc) record.enc = enc;
  return record;
}

function normalizeFolder(folder: IncomingFolder): Folder {
  const now = Date.now();
  const enc = folder.enc;
  const sealed = isEncryptedPayload(enc);
  const record: Folder = {
    id: folder.id,
    parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
    name: sealed ? '' : String(folder.name).slice(0, 80),
    createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : now,
    updatedAt: typeof folder.updatedAt === 'number' ? folder.updatedAt : now,
    sortOrder: typeof folder.sortOrder === 'number' ? folder.sortOrder : 0,
    isFavorite: Boolean(folder.isFavorite),
    isLocked: sealed ? true : Boolean(folder.isLocked),
  };
  if (!sealed && folder.icon) record.icon = String(folder.icon);
  if (sealed && enc) record.enc = enc;
  return record;
}

function normalizeLink(link: IncomingLink, knownFolderIds: Set<string>): SavedLink {
  const now = Date.now();
  const enc = link.enc;
  const sealed = isEncryptedPayload(enc);
  const record: SavedLink = {
    id: link.id,
    folderId: typeof link.folderId === 'string' && knownFolderIds.has(link.folderId) ? link.folderId : null,
    url: sealed ? '' : String(link.url),
    normalizedUrl: sealed ? '' : (normalizeUrl(link.url) ?? link.normalizedUrl ?? String(link.url)),
    createdAt: typeof link.createdAt === 'number' ? link.createdAt : now,
    updatedAt: typeof link.updatedAt === 'number' ? link.updatedAt : now,
    isFavorite: Boolean(link.isFavorite),
    isArchived: Boolean(link.isArchived),
    isLocked: sealed ? true : Boolean(link.isLocked),
  };
  if (sealed && enc) record.enc = enc;
  if (!sealed) {
    if (link.title) record.title = String(link.title);
    if (link.description) record.description = String(link.description);
    if (link.userNote) record.userNote = String(link.userNote);
    record.source = link.source ? String(link.source) : domainOf(link.url);
  }
  // Provenance is not content, so it is not part of the sealed set: knowing
  // which app produced a link does not reveal what the link is.
  if (link.sourcePackage) record.sourcePackage = String(link.sourcePackage);
  if (!sealed && link.rawText) record.rawText = String(link.rawText);
  if (typeof link.lastOpenedAt === 'number') record.lastOpenedAt = link.lastOpenedAt;
  return record;
}

/** Irreversible. Only reachable behind an explicit typed confirmation. */
export async function eraseVault(): Promise<void> {
  await eraseDatabase();
}

/** Stable file name for exports, e.g. `stash-2026-09-26.json`. */
export function exportFileName(at = new Date()): string {
  const iso = at.toISOString().slice(0, 10);
  return `stash-${iso}.json`;
}
