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
} from '@/db/types';
import { getSnapshot } from '@/db/repos/vault';
import { ensureSeeded } from '@/db/seed';
import { openDatabase } from '@/db';
import {
  createFolder as createFolderRepo,
  deleteFolder as deleteFolderRepo,
  getDeletionImpact,
  getFolderStats,
  moveFolder as moveFolderRepo,
  renameFolder as renameFolderRepo,
  reorderFolder as reorderFolderRepo,
  setFolderFavorite,
  setFolderIcon,
  type CreateFolderResult,
  type DeleteStrategy,
  type FolderStats,
  type MoveResult,
} from '@/db/repos/folders';
import {
  createLink as createLinkRepo,
  deleteLink as deleteLinkRepo,
  findDuplicates,
  listLinksInFolder,
  moveLink as moveLinkRepo,
  setLinkFavorite,
  setLinkArchived,
  touchLinkOpened,
  updateLink as updateLinkRepo,
  type CreateLinkInput,
  type DuplicateMatch,
  type UpdateLinkInput,
} from '@/db/repos/links';
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
  saveNoteContent as saveNoteContentRepo,
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
  folders: Folder[];
  links: SavedLink[];
  tags: Tag[];
  linkTags: LinkTag[];
  folderStats: Map<string, FolderStats>;
  recentFolderIds: string[];
  /** Every note, including archived ones. */
  notes: Note[];
  /**
   * Notes a browsing UI should show: archived notes and their subtrees removed.
   * Precomputed once per refresh so no component has to walk the tree.
   */
  visibleNotes: Note[];
  /** Note-to-link references, the join between the two halves of the vault. */
  noteLinks: NoteLink[];

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;

  createFolder: (input: { name: string; parentId?: string | null; icon?: string }) => Promise<CreateFolderResult>;
  renameFolder: (id: string, name: string) => Promise<boolean>;
  moveFolder: (id: string, targetParentId: string | null) => Promise<MoveResult>;
  reorderFolder: (id: string, direction: 'up' | 'down') => Promise<boolean>;
  deleteFolder: (id: string, strategy: DeleteStrategy) => Promise<boolean>;
  toggleFolderFavorite: (id: string, value?: boolean) => Promise<void>;
  setFolderEmojiIcon: (id: string, icon: string | undefined) => Promise<void>;
  deletionImpact: (id: string) => Promise<FolderDeletionImpact | null>;

  saveLink: (input: CreateLinkInput) => Promise<SavedLink>;
  updateLink: (id: string, patch: UpdateLinkInput) => Promise<void>;
  moveLink: (id: string, folderId: string | null) => Promise<void>;
  toggleLinkFavorite: (id: string, value?: boolean) => Promise<void>;
  archiveLink: (id: string, value: boolean) => Promise<void>;
  deleteLink: (id: string) => Promise<void>;
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
}

async function loadEverything() {
  const [snapshot, folderStats, recentFolderIds] = await Promise.all([
    getSnapshot(),
    getFolderStats(),
    pruneRecentFolders(),
  ]);
  const tags = await listTags();
  return {
    folders: snapshot.folders,
    links: snapshot.links,
    tags,
    linkTags: snapshot.linkTags,
    folderStats,
    recentFolderIds,
    notes: snapshot.notes,
    visibleNotes: visibleNotes(snapshot.notes),
    noteLinks: snapshot.noteLinks,
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

  deleteLink: async (id) => {
    await deleteLinkRepo(id);
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

export { getRecentFolderIds };
