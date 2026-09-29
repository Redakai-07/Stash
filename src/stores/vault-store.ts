'use client';

import { create } from 'zustand';
import type {
  Folder,
  FolderDeletionImpact,
  LinkTag,
  Note,
  NoteDeletionImpact,
  NoteLink,
  NoteLinkOrigin,
  SavedLink,
  Tag,
  TrashEntry,
  TrashImpact,
} from '@/db/types';
import { getSnapshot } from '@/db/repos/vault';
import { ensureSeeded } from '@/db/seed';
import { openDatabase } from '@/db';
import {
  createFolder as createFolderRepo,
  deleteFolder as deleteFolderRepo,
  getDeletionImpact,
  moveFolder as moveFolderRepo,
  renameFolder as renameFolderRepo,
  reorderFolder as reorderFolderRepo,
  setFolderFavorite,
  setFolderIcon,
  setFolderLocked,
  type CreateFolderResult,
  type DeleteStrategy,
  type MoveResult,
} from '@/db/repos/folders';
import {
  createLink as createLinkRepo,
  deleteLinkPermanently as discardLinkRepo,
  findDuplicates,
  listLinksInFolder,
  moveLink as moveLinkRepo,
  setLinkFavorite,
  setLinkArchived,
  setLinkLocked,
  setLinkUnavailable as setLinkUnavailableRepo,
  touchLinkOpened,
  updateLink as updateLinkRepo,
  type CreateLinkInput,
  type DuplicateMatch,
  type UpdateLinkInput,
} from '@/db/repos/links';
import {
  emptyTrash as emptyTrashRepo,
  listTrashGroups,
  purgeBatch as purgeBatchRepo,
  restoreAll as restoreAllRepo,
  restoreBatch as restoreBatchRepo,
  trashLink as trashLinkRepo,
} from '@/db/repos/trash';
import { getRecentFolderIds, pruneRecentFolders, pushRecentFolder, setLastFolderId } from '@/db/repos/settings';
import { listTags, setLinkTags } from '@/db/repos/tags';
import {
  attachLinkToNote as attachLinkToNoteRepo,
  createNote as createNoteRepo,
  createNoteFromLink as createNoteFromLinkRepo,
  deleteNote as deleteNoteRepo,
  detachLinkFromNote as detachLinkFromNoteRepo,
  moveNote as moveNoteRepo,
  getNoteDeletionImpact,
  renameNote as renameNoteRepo,
  reorderNote as reorderNoteRepo,
  setNoteArchived,
  setNoteFavorite,
  setNoteLocked,
  updateNote as updateNoteRepo,
  type CreateNoteInput,
  type CreateNoteResult,
  type MoveNoteResult,
  type NoteDeleteStrategy,
} from '@/db/repos/notes';
import { visibleNotes } from '@/lib/notes';
import { noteBreadcrumb, noteChildren, noteDescendantIds } from '@/lib/tree';
import { computeFolderStats, type FolderStats } from '@/lib/folder-stats';
import { isSessionLocked } from '@/lib/privacy/keyring';
import { computeProtection, hiddenIds, type HiddenIds, type Protection } from '@/lib/privacy/protection';

/**
 * The in-memory mirror of the vault.
 *
 * Every write goes through this store, which is what makes "IndexedDB is the
 * source of truth" enforceable: the store re-reads after a mutation instead of
 * inventing state that the database does not have. Reads never touch the
 * network, so the whole app is functional in airplane mode.
 */

export type VaultStatus = 'booting' | 'ready' | 'error';

export interface VaultState {
  status: VaultStatus;
  error?: string;
  /**
   * Hidden-while-locked items are already removed from every collection below.
   * A component that renders `state.folders` cannot leak a locked folder, because
   * a locked folder is not in `state.folders`.
   */
  folders: Folder[];
  links: SavedLink[];
  tags: Tag[];
  linkTags: LinkTag[];
  folderStats: Map<string, FolderStats>;
  recentFolderIds: string[];
  /** Every visible note, including archived ones. */
  notes: Note[];
  /**
   * Notes a browsing UI should show: archived notes and their subtrees removed.
   * Precomputed once per refresh so no component has to walk the tree.
   */
  visibleNotes: Note[];
  /** Note-to-link references, the join between the two halves of the vault. */
  noteLinks: NoteLink[];
  /**
   * Which ids are locked, in their own right or through an ancestor.
   *
   * Unlike the collections above this is *not* filtered: the UI needs it to show
   * a lock badge on a subtree that inherited a lock, and to explain why an item
   * cannot be unlocked on its own. It contains ids only — never content — and ids
   * of locked items are useless without the key.
   */
  protection: Protection;
  /** Whether the session is currently locked, i.e. the vault key is absent. */
  sessionLocked: boolean;
  /** Ids withheld from search and listings. Empty while unlocked. */
  hidden: HiddenIds;
  /**
   * Live, unarchived links that have no folder: the Inbox.
   *
   * Derived once per refresh rather than filtered in each screen, because Home,
   * Settings and the Inbox itself all ask the same question and none of them
   * should walk the link list to answer it.
   */
  inboxLinks: SavedLink[];
  /**
   * Derived collections, computed once per refresh.
   *
   * These exist as state rather than as selectors that build an array on the
   * spot, and that is a correctness requirement, not a micro-optimisation. A
   * zustand selector that returns a fresh array on every call breaks React's
   * store subscription: the snapshot never compares equal, so the component
   * re-renders in a loop and React refuses the update. Precomputing gives every
   * read the same reference until the vault actually changes, and it also means
   * no screen has to walk the link list to answer a question Home already asked.
   */
  favoriteFolders: Folder[];
  favoriteNotes: Note[];
  tagUsage: Array<{ name: string; count: number }>;
  /** Tag names per link. A Map so a lookup is O(1) and returns a stable ref. */
  tagsByLink: Map<string, string[]>;
  /**
   * What is in the trash, grouped into the acts that produced it.
   *
   * The trash is deliberately outside the snapshot: trash-aware filtering
   * everywhere else is what makes the rest of the app unable to show a deleted
   * row, and a surface that could see them would undo that. So it is read on
   * demand, by the one screen whose whole purpose is to show them.
   */
  trashGroups: TrashEntry[];
  trashLoaded: boolean;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;

  createFolder: (input: { name: string; parentId?: string | null; icon?: string }) => Promise<CreateFolderResult>;
  renameFolder: (id: string, name: string) => Promise<boolean>;
  moveFolder: (id: string, targetParentId: string | null) => Promise<MoveResult>;
  reorderFolder: (id: string, direction: 'up' | 'down') => Promise<boolean>;
  deleteFolder: (id: string, strategy: DeleteStrategy) => Promise<boolean>;
  toggleFolderFavorite: (id: string, value?: boolean) => Promise<void>;
  setFolderEmojiIcon: (id: string, icon: string | undefined) => Promise<void>;
  toggleFolderLocked: (id: string, value?: boolean) => Promise<void>;
  deletionImpact: (id: string) => Promise<FolderDeletionImpact | null>;

  saveLink: (input: CreateLinkInput) => Promise<SavedLink>;
  updateLink: (id: string, patch: UpdateLinkInput) => Promise<void>;
  moveLink: (id: string, folderId: string | null) => Promise<void>;
  toggleLinkFavorite: (id: string, value?: boolean) => Promise<void>;
  archiveLink: (id: string, value: boolean) => Promise<void>;
  toggleLinkLocked: (id: string, value?: boolean) => Promise<void>;
  /** Moves a link to the trash: recoverable, and what every "Delete" button does. */
  deleteLink: (id: string) => Promise<void>;
  /** Permanently throws away a link created moments ago. The only undo path. */
  discardLink: (id: string) => Promise<void>;
  /** Record by hand that the address no longer works, or that it does again. */
  setLinkUnavailable: (id: string, value: boolean) => Promise<void>;
  markLinkOpened: (id: string) => Promise<void>;
  duplicatesFor: (url: string, excludeId?: string) => Promise<DuplicateMatch[]>;
  linksInFolder: (folderId: string | null, includeNested?: boolean) => Promise<SavedLink[]>;
  setTags: (linkId: string, names: string[]) => Promise<void>;

  // ---- Notes ---------------------------------------------------------------
  createNote: (input: CreateNoteInput) => Promise<CreateNoteResult>;
  /** Autosave path for title + body. Writes only those fields. */
  saveNoteDraft: (id: string, draft: { title: string; content: string }) => Promise<void>;
  renameNote: (id: string, title: string) => Promise<boolean>;
  moveNote: (id: string, targetParentNoteId: string | null) => Promise<MoveNoteResult>;
  reorderNote: (id: string, direction: 'up' | 'down') => Promise<boolean>;
  deleteNote: (id: string, strategy: NoteDeleteStrategy) => Promise<boolean>;
  toggleNoteFavorite: (id: string, value?: boolean) => Promise<void>;
  archiveNote: (id: string, value: boolean) => Promise<void>;
  toggleNoteLocked: (id: string, value?: boolean) => Promise<void>;
  noteDeletionImpact: (id: string) => Promise<NoteDeletionImpact | null>;
  attachLink: (noteId: string, linkId: string, origin?: NoteLinkOrigin) => Promise<boolean>;
  detachLink: (noteId: string, linkId: string) => Promise<void>;
  createNoteFromLink: (linkId: string, parentNoteId?: string | null) => Promise<CreateNoteResult>;

  // ---- Trash ---------------------------------------------------------------
  /** Read the trash. Called by the Trash screen, not by `refresh`. */
  loadTrash: () => Promise<void>;
  restoreTrash: (batch: string) => Promise<TrashImpact>;
  restoreAllTrash: () => Promise<TrashImpact>;
  purgeTrash: (batch: string) => Promise<TrashImpact>;
  emptyTrashNow: () => Promise<TrashImpact>;
}

/**
 * Move live, unarchived links with no folder into the Inbox list.
 *
 * Sorted newest first: the Inbox is a queue of recent arrivals, so the thing you
 * just saved from another app is at the top, which is the whole point of saving
 * without filing.
 */
function inboxOf(links: readonly SavedLink[]): SavedLink[] {
  return links
    .filter((link) => !link.isArchived && link.folderId === null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * A shared "no tags" value.
 *
 * Returned for every untagged link so the answer is one stable reference rather
 * than a fresh empty array per read — the same reasoning as the derived
 * collections above. It is never written to.
 */
const NO_TAGS: string[] = [];

/** Tag names per link id, each list sorted so the display order is stable. */
function tagNamesByLink(tags: readonly Tag[], linkTags: readonly LinkTag[]): Map<string, string[]> {
  const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const byLink = new Map<string, string[]>();
  for (const row of linkTags) {
    const name = namesById.get(row.tagId);
    if (!name) continue;
    const bucket = byLink.get(row.linkId);
    if (bucket) bucket.push(name);
    else byLink.set(row.linkId, [name]);
  }
  for (const names of byLink.values()) names.sort();
  return byLink;
}

/** Tag names in use, with how many live links carry each, most used first. */
function tagUsageOf(tags: readonly Tag[], linkTags: readonly LinkTag[]): Array<{ name: string; count: number }> {
  const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const counts = new Map<string, number>();
  for (const row of linkTags) {
    const name = namesById.get(row.tagId);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));
}

/**
 * Read the vault, then apply the lock filter once, centrally.
 *
 * This is the single place "what may be shown right now" is decided. Every
 * screen, picker and count downstream reads the same collections, so a new
 * surface inherits the lock rules instead of having to implement them.
 *
 * **A locked item is still listed; what it loses is everything but its shape.**
 * That is the product decision behind the placeholders: a locked note shows as a
 * locked row rather than vanishing, so tapping it can offer the device prompt —
 * which is how every other app with a screen lock behaves, and the only way
 * "open the locked thing" can be an interaction at all. What makes it safe is
 * that the row on disk is already ciphertext with its fields blanked: there is no
 * plaintext title, URL, name, snippet or note text left to leak, only the fact
 * that something exists there and where it sits.
 *
 * `hidden` is still published, and still means "do not treat this row as
 * content": search does not return it, dedupe does not match it, and pickers do
 * not offer it as a destination.
 */
async function loadEverything() {
  const [snapshot, recentFolderIds] = await Promise.all([getSnapshot(), pruneRecentFolders()]);
  const tags = await listTags();

  const protection = computeProtection(snapshot.folders, snapshot.notes, snapshot.links);
  const sessionLocked = isSessionLocked();
  const hidden = hiddenIds(protection, sessionLocked);

  const folders = snapshot.folders;
  const links = snapshot.links;
  const notes = snapshot.notes;

  // Counts include locked rows: the row is on screen, so "2 links" beside it
  // has to agree with what the user can see. The *contents* stay unreadable,
  // which is what the counts were ever protecting.
  const folderStats = computeFolderStats(snapshot.folders, snapshot.links);

  return {
    folders,
    links,
    tags,
    linkTags: snapshot.linkTags,
    folderStats,
    recentFolderIds,
    notes,
    visibleNotes: visibleNotes(notes),
    noteLinks: snapshot.noteLinks,
    protection,
    sessionLocked,
    hidden,
    inboxLinks: inboxOf(links),
    favoriteFolders: folders.filter((folder) => folder.isFavorite),
    favoriteNotes: [...visibleNotes(notes)]
      .filter((note) => note.isFavorite)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    tagUsage: tagUsageOf(tags, snapshot.linkTags),
    tagsByLink: tagNamesByLink(tags, snapshot.linkTags),
  };
}

export const useVaultStore = create<VaultState>((set, get) => ({
  status: 'booting',
  folders: [],
  links: [],
  tags: [],
  linkTags: [],
  folderStats: new Map(),
  recentFolderIds: [],
  notes: [],
  visibleNotes: [],
  noteLinks: [],
  protection: { folders: new Set(), notes: new Set(), links: new Set() },
  sessionLocked: false,
  hidden: { folders: new Set(), notes: new Set(), links: new Set() },
  inboxLinks: [],
  favoriteFolders: [],
  favoriteNotes: [],
  tagUsage: [],
  tagsByLink: new Map(),
  trashGroups: [],
  trashLoaded: false,

  initialize: async () => {
    if (get().status === 'ready') return;
    try {
      const opened = await openDatabase();
      if (!opened) throw new Error('IndexedDB is unavailable on this device.');
      await ensureSeeded();
      const data = await loadEverything();
      set({ status: 'ready', error: undefined, ...data });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not open the local vault.',
      });
    }
  },

  refresh: async () => {
    try {
      const data = await loadEverything();
      set({ ...data });
    } catch (error) {
      console.error('[stash] refresh failed', error);
    }
  },

  createFolder: async (input) => {
    const result = await createFolderRepo(input);
    await get().refresh();
    return result;
  },

  renameFolder: async (id, name) => {
    const updated = await renameFolderRepo(id, name);
    if (!updated) return false;
    await get().refresh();
    return true;
  },

  moveFolder: async (id, targetParentId) => {
    const result = await moveFolderRepo(id, targetParentId);
    if (result.ok) await get().refresh();
    return result;
  },

  reorderFolder: async (id, direction) => {
    const ok = await reorderFolderRepo(id, direction);
    if (ok) await get().refresh();
    return ok;
  },

  deleteFolder: async (id, strategy) => {
    const result = await deleteFolderRepo(id, strategy);
    if (!result.ok) return false;
    await get().refresh();
    return true;
  },

  toggleFolderFavorite: async (id, value) => {
    const current = get().folders.find((folder) => folder.id === id);
    const next = value ?? !(current?.isFavorite ?? false);
    // Optimistic: the star should respond to the tap, not to the transaction.
    set({
      folders: get().folders.map((folder) =>
        folder.id === id ? { ...folder, isFavorite: next, updatedAt: Date.now() } : folder,
      ),
    });
    await setFolderFavorite(id, next);
    await get().refresh();
  },

  setFolderEmojiIcon: async (id, icon) => {
    await setFolderIcon(id, icon);
    await get().refresh();
  },

  /**
   * Lock or unlock a folder and everything beneath it.
   *
   * Sealing the subtree happens in the repository, which re-derives it from the
   * flags, so a subfolder or link that inherits this lock becomes ciphertext at
   * rest without the store having to enumerate it.
   */
  toggleFolderLocked: async (id, value) => {
    const current = get().folders.find((folder) => folder.id === id);
    const next = value ?? !(current?.isLocked ?? false);
    await setFolderLocked(id, next);
    await get().refresh();
  },

  deletionImpact: (id) => getDeletionImpact(id),

  saveLink: async (input) => {
    const link = await createLinkRepo(input);
    // Only real folders become remembered destinations; the Inbox is not one.
    if (input.folderId) {
      await pushRecentFolder(input.folderId);
      await setLastFolderId(input.folderId);
    }
    await get().refresh();
    return link;
  },

  updateLink: async (id, patch) => {
    await updateLinkRepo(id, patch);
    await get().refresh();
  },

  moveLink: async (id, folderId) => {
    await moveLinkRepo(id, folderId);
    if (folderId) await pushRecentFolder(folderId);
    await get().refresh();
  },

  toggleLinkFavorite: async (id, value) => {
    const current = get().links.find((link) => link.id === id);
    const next = value ?? !(current?.isFavorite ?? false);
    set({
      links: get().links.map((link) =>
        link.id === id ? { ...link, isFavorite: next, updatedAt: Date.now() } : link,
      ),
    });
    await setLinkFavorite(id, next);
    await get().refresh();
  },

  archiveLink: async (id, value) => {
    await setLinkArchived(id, value);
    await get().refresh();
  },

  toggleLinkLocked: async (id, value) => {
    const current = get().links.find((link) => link.id === id);
    const next = value ?? !(current?.isLocked ?? false);
    await setLinkLocked(id, next);
    await get().refresh();
  },

  deleteLink: async (id) => {
    await trashLinkRepo(id);
    await get().refresh();
  },

  /**
   * Throw away a link that was created moments ago, for good.
   *
   * The undo on a fresh capture is not the same act as changing your mind about
   * something you kept: the row is seconds old, nothing references it yet, and
   * sending it to the trash would fill a recovery surface with noise. The only
   * irreversible path in the product, reachable in exactly one place.
   */
  discardLink: async (id) => {
    await discardLinkRepo(id);
    await get().refresh();
  },

  setLinkUnavailable: async (id, value) => {
    const now = Date.now();
    // Optimistic: marking a dead address is a judgement the user just made by
    // hand, and the badge should appear with the tap, not with the write.
    set({
      links: get().links.map((link) =>
        link.id === id
          ? value
            ? { ...link, isUnavailable: true, unavailableAt: now }
            : { ...link, isUnavailable: false }
          : link,
      ),
    });
    set({ inboxLinks: inboxOf(get().links) });
    await setLinkUnavailableRepo(id, value);
    await get().refresh();
  },

  markLinkOpened: async (id) => {
    await touchLinkOpened(id);
    set({
      links: get().links.map((link) => (link.id === id ? { ...link, lastOpenedAt: Date.now() } : link)),
    });
  },

  duplicatesFor: (url, excludeId) => findDuplicates(url, excludeId ? { excludeId } : {}),

  linksInFolder: (folderId, includeNested = false) => listLinksInFolder(folderId, { includeNested }),

  setTags: async (linkId, names) => {
    await setLinkTags(linkId, names);
    await get().refresh();
  },

  // ---- Notes ---------------------------------------------------------------

  createNote: async (input) => {
    const result = await createNoteRepo(input);
    if (result.ok) await get().refresh();
    return result;
  },

  /**
   * The autosave path.
   *
   * Deliberately does not call `refresh()`: re-reading the whole vault on every
   * debounce tick while someone types a paragraph would be wasteful. Only the
   * touched fields are patched in memory, and they are the same fields the write
   * just changed, so the mirror cannot drift.
   */
  saveNoteDraft: async (id, draft) => {
    const updated = await updateNoteRepo(id, { title: draft.title, content: draft.content });
    if (!updated) return;
    set({
      notes: get().notes.map((note) => (note.id === id ? updated : note)),
    });
  },

  renameNote: async (id, title) => {
    const updated = await renameNoteRepo(id, title);
    if (!updated) return false;
    set({ notes: get().notes.map((note) => (note.id === id ? updated : note)) });
    return true;
  },

  moveNote: async (id, targetParentNoteId) => {
    const result = await moveNoteRepo(id, targetParentNoteId);
    if (result.ok) await get().refresh();
    return result;
  },

  reorderNote: async (id, direction) => {
    const ok = await reorderNoteRepo(id, direction);
    if (ok) await get().refresh();
    return ok;
  },

  deleteNote: async (id, strategy) => {
    const result = await deleteNoteRepo(id, strategy);
    if (!result.ok) return false;
    await get().refresh();
    return true;
  },

  toggleNoteFavorite: async (id, value) => {
    const current = get().notes.find((note) => note.id === id);
    const next = value ?? !(current?.isFavorite ?? false);
    // Optimistic: a star should answer the tap, not the transaction.
    set({
      notes: get().notes.map((note) =>
        note.id === id ? { ...note, isFavorite: next, updatedAt: Date.now() } : note,
      ),
    });
    await setNoteFavorite(id, next);
    await get().refresh();
  },

  archiveNote: async (id, value) => {
    await setNoteArchived(id, value);
    await get().refresh();
  },

  toggleNoteLocked: async (id, value) => {
    const current = get().notes.find((note) => note.id === id);
    const next = value ?? !(current?.isLocked ?? false);
    await setNoteLocked(id, next);
    await get().refresh();
  },

  noteDeletionImpact: (id) => getNoteDeletionImpact(id),

  attachLink: async (noteId, linkId, origin = 'attached') => {
    const created = await attachLinkToNoteRepo(noteId, linkId, origin);
    if (!created) return false;
    await get().refresh();
    return true;
  },

  detachLink: async (noteId, linkId) => {
    await detachLinkFromNoteRepo(noteId, linkId);
    await get().refresh();
  },

  createNoteFromLink: async (linkId, parentNoteId = null) => {
    const result = await createNoteFromLinkRepo(linkId, { parentNoteId });
    if (result.ok) await get().refresh();
    return result;
  },

  loadTrash: async () => {
    const trashGroups = await listTrashGroups();
    set({ trashGroups, trashLoaded: true });
  },

  restoreTrash: async (batch) => {
    const impact = await restoreBatchRepo(batch);
    // The vault changed underneath the trash, so both sides are re-read: the
    // trash because rows left it, the mirror because restored rows are now
    // ordinary content that every screen must see.
    await get().refresh();
    await get().loadTrash();
    return impact;
  },

  restoreAllTrash: async () => {
    const impact = await restoreAllRepo();
    await get().refresh();
    await get().loadTrash();
    return impact;
  },

  purgeTrash: async (batch) => {
    const impact = await purgeBatchRepo(batch);
    await get().refresh();
    await get().loadTrash();
    return impact;
  },

  emptyTrashNow: async () => {
    const impact = await emptyTrashRepo();
    await get().refresh();
    await get().loadTrash();
    return impact;
  },
}));

// ---------------------------------------------------------------------------
// Selectors
//
// Pure derivations over the mirror. Components use these instead of rebuilding
// the same maps and filters on every render.
// ---------------------------------------------------------------------------

/** Direct subnotes of `parentNoteId` (`null` = root notes), in display order. */
export function selectChildNotes(state: VaultState, parentNoteId: string | null): Note[] {
  return noteChildren(state.visibleNotes, parentNoteId);
}

/** Ancestors from the root down to the note itself, for breadcrumbs. */
export function selectNoteTrail(state: VaultState, noteId: string): Note[] {
  return noteBreadcrumb(state.notes, noteId);
}

/** How many notes live below this one, so a parent note reads as a container. */
export function selectDescendantNoteCount(state: VaultState, noteId: string): number {
  return noteDescendantIds(state.notes, noteId).length;
}

/** Saved links referenced by a note, in the order they were attached. */
export function selectLinksForNote(state: VaultState, noteId: string): SavedLink[] {
  const byId = new Map(state.links.map((link) => [link.id, link]));
  return state.noteLinks
    .filter((row) => row.noteId === noteId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => byId.get(row.linkId))
    .filter((link): link is SavedLink => Boolean(link) && !link!.isArchived);
}

/** Notes that reference a saved link. Powers "Referenced in" on a link. */
export function selectNotesForLink(state: VaultState, linkId: string): Note[] {
  const byId = new Map(state.notes.map((note) => [note.id, note]));
  return state.noteLinks
    .filter((row) => row.linkId === linkId)
    .map((row) => byId.get(row.noteId))
    .filter((note): note is Note => Boolean(note));
}

/** Notes the user edited most recently, newest first. */
export function selectRecentNotes(state: VaultState, limit = 4): Note[] {
  return [...state.visibleNotes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/** Note ids referenced by any note, used to badge links in lists. */
export function selectReferencedLinkIds(state: VaultState): Set<string> {
  return new Set(state.noteLinks.map((row) => row.linkId));
}

/** Convenience selector: recent destinations that still exist, newest first. */
export function selectRecentDestinations(state: VaultState): Folder[] {
  const byId = new Map(state.folders.map((folder) => [folder.id, folder]));
  return state.recentFolderIds
    .map((id) => byId.get(id))
    .filter((folder): folder is Folder => Boolean(folder));
}

/**
 * The Inbox, newest first.
 *
 * Already filtered by lock and by live-only at the snapshot boundary, so this
 * needs no further guard: a list that reads it cannot leak anything.
 */
export function selectInboxLinks(state: VaultState): SavedLink[] {
  return state.inboxLinks;
}

/** Links the user marked as no longer working, for a "needs attention" count. */
export function selectUnavailableLinks(state: VaultState): SavedLink[] {
  return state.links.filter((link) => link.isUnavailable && !link.isArchived);
}

/** Favorite notes, newest first. Precomputed, so the reference is stable. */
export function selectFavoriteNotes(state: VaultState): Note[] {
  return state.favoriteNotes;
}

/** Favorite folders, in the order the library shows them. Precomputed. */
export function selectFavoriteFolders(state: VaultState): Folder[] {
  return state.favoriteFolders;
}

/**
 * Tag names in use, with how many live links carry each one. Precomputed.
 *
 * Returns the same array until the vault changes, which is what lets a screen
 * subscribe to it directly — see the note on the derived collections in
 * {@link VaultState}.
 */
export function selectTagUsage(state: VaultState): Array<{ name: string; count: number }> {
  return state.tagUsage;
}

/** Tag names for one link, alphabetically. A stable lookup, never a new array. */
export function selectTagsForLink(state: VaultState, linkId: string): string[] {
  return state.tagsByLink.get(linkId) ?? NO_TAGS;
}

export { getRecentFolderIds, inboxOf };
