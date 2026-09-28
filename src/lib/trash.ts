import type { Folder, Note, SavedLink, TrashEntry, TrashImpact } from '@/db/types';
import { displayUrl } from '@/lib/format';
import { breadcrumbOf, folderPathLabel, noteBreadcrumb } from '@/lib/tree';

/**
 * The trash, as pure data.
 *
 * Deleting is not the same as destroying, and the difference lives here. A
 * thrown-away row keeps its id, its place in the hierarchy and its content, so
 * restoring it is exact: the folder comes back with the same subfolders in the
 * same order, and the link comes back at the same address. Nothing is exported
 * to a shadow copy that could drift from the original.
 *
 * Two ideas do all the work:
 *
 *  - **`deletedAt`** marks a row as thrown away. Absent means live, which is why
 *    introducing this cost no migration and why a row that predates the trash is
 *    live by definition rather than by assumption.
 *  - **`trashBatch`** records what was thrown away *together*. A batch is the
 *    unit the user thinks in — "the folder I deleted" — so it is the unit listed,
 *    restored and purged. Deleting a folder is one act; it should not come back
 *    as ninety separate pieces.
 *
 * Everything in this module is a pure function over rows, so the grouping rules
 * are testable without a database and identical everywhere they are used.
 */

/** True when a row has been thrown away. */
export function isTrashed(row: { deletedAt?: number }): boolean {
  return typeof row.deletedAt === 'number' && row.deletedAt > 0;
}

/** Only the live rows. The one filter every listing goes through. */
export function liveOnly<T extends { deletedAt?: number }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isTrashed(row));
}

/** Only the thrown-away rows. */
export function trashedOnly<T extends { deletedAt?: number }>(rows: readonly T[]): T[] {
  return rows.filter(isTrashed);
}

/**
 * Every trashed id, by family.
 *
 * Used to decide whether a reference still resolves: a link whose folder is in
 * the trash is not filed there any more, and must not point at a place the UI
 * cannot show.
 */
export interface TrashState {
  folders: ReadonlySet<string>;
  links: ReadonlySet<string>;
  notes: ReadonlySet<string>;
}

export const EMPTY_TRASH_STATE: TrashState = {
  folders: new Set(),
  links: new Set(),
  notes: new Set(),
};

export function readTrashState(input: {
  folders: readonly Folder[];
  links: readonly SavedLink[];
  notes: readonly Note[];
}): TrashState {
  return {
    folders: new Set(trashedOnly(input.folders).map((row) => row.id)),
    links: new Set(trashedOnly(input.links).map((row) => row.id)),
    notes: new Set(trashedOnly(input.notes).map((row) => row.id)),
  };
}

export function hasTrash(state: TrashState): boolean {
  return state.folders.size > 0 || state.links.size > 0 || state.notes.size > 0;
}

/** The batch a trashed row belongs to, with a stable fallback for rows without one. */
export function batchOf(row: { id: string; kind: string; trashBatch?: string; deletedAt?: number }): string {
  if (row.trashBatch) return row.trashBatch;
  // A row can only lack a batch if it was hand-written or arrived from a backup
  // whose batch field was dropped. Treating it as a batch of its own keeps the
  // invariant that every trashed row shows up in exactly one entry, so nothing
  // can become invisible while still occupying its id.
  return `single:${row.kind}:${row.id}:${row.deletedAt ?? 0}`;
}

export interface TrashRows {
  folders: Folder[];
  links: SavedLink[];
  notes: Note[];
}

/**
 * Group the trash into the batches a person would recognise.
 *
 * The entry's root is the row the user actually deleted: the outermost member of
 * the batch. Its name is the entry's name, and its old location is the entry's
 * subtitle, so a trashed folder reads as "Divorce — Personal" rather than as a
 * count of rows.
 */
export function groupTrash(input: TrashRows): TrashEntry[] {
  const byBatch = new Map<string, TrashRows>();

  const push = (batch: string, kind: 'folders' | 'links' | 'notes', row: Folder | SavedLink | Note) => {
    let bucket = byBatch.get(batch);
    if (!bucket) {
      bucket = { folders: [], links: [], notes: [] };
      byBatch.set(batch, bucket);
    }
    (bucket[kind] as Array<Folder | SavedLink | Note>).push(row);
  };

  for (const folder of input.folders) {
    if (!isTrashed(folder)) continue;
    push(batchOf({ id: folder.id, kind: 'folder', trashBatch: folder.trashBatch, deletedAt: folder.deletedAt }), 'folders', folder);
  }
  for (const link of input.links) {
    if (!isTrashed(link)) continue;
    push(batchOf({ id: link.id, kind: 'link', trashBatch: link.trashBatch, deletedAt: link.deletedAt }), 'links', link);
  }
  for (const note of input.notes) {
    if (!isTrashed(note)) continue;
    push(batchOf({ id: note.id, kind: 'note', trashBatch: note.trashBatch, deletedAt: note.deletedAt }), 'notes', note);
  }

  const entries: TrashEntry[] = [];
  for (const [batch, rows] of byBatch) {
    const entry = describeBatch(batch, rows, input);
    if (entry) entries.push(entry);
  }

  // Newest first: the thing you just deleted is the thing you most likely want.
  return entries.sort((a, b) => b.deletedAt - a.deletedAt || a.label.localeCompare(b.label));
}

function describeBatch(batch: string, rows: TrashRows, all: TrashRows): TrashEntry | null {
  const batchFolderIds = new Set(rows.folders.map((folder) => folder.id));
  const batchNoteIds = new Set(rows.notes.map((note) => note.id));

  // The root is the row with no parent inside its own batch.
  const rootFolder =
    rows.folders.find((folder) => !folder.parentId || !batchFolderIds.has(folder.parentId)) ??
    rows.folders.slice().sort((a, b) => a.createdAt - b.createdAt)[0];
  const rootNote =
    rows.notes.find((note) => !note.parentNoteId || !batchNoteIds.has(note.parentNoteId)) ??
    rows.notes.slice().sort((a, b) => a.createdAt - b.createdAt)[0];
  const rootLink = rows.links.slice().sort((a, b) => a.createdAt - b.createdAt)[0];

  let kind: TrashEntry['kind'];
  let rootId: string;
  let label: string;
  let path: string;

  if (rootFolder) {
    kind = 'folder';
    rootId = rootFolder.id;
    label = rootFolder.name;
    path = rootFolder.parentId ? folderPathLabel(all.folders, rootFolder.parentId) : 'Top level';
  } else if (rootNote) {
    kind = 'note';
    rootId = rootNote.id;
    label = rootNote.title;
    const chain = noteBreadcrumb(all.notes, rootNote.id);
    // The chain starts at the note itself, so its parent's path is the drop-off.
    path = chain.length > 1 ? chain.slice(0, -1).map((entry) => entry.title).join(' → ') : 'Top level';
  } else if (rootLink) {
    kind = 'link';
    rootId = rootLink.id;
    label = rootLink.title?.trim() || displayUrl(rootLink.url, 60) || 'Saved link';
    path = rootLink.folderId ? folderPathLabel(all.folders, rootLink.folderId) : 'Inbox';
  } else {
    // A batch with no rows cannot happen through any code path; returning null
    // rather than inventing an entry keeps the list honest.
    return null;
  }

  const deletedAt = Math.max(
    ...rows.folders.map((row) => row.deletedAt ?? 0),
    ...rows.links.map((row) => row.deletedAt ?? 0),
    ...rows.notes.map((row) => row.deletedAt ?? 0),
  );

  return {
    batch,
    kind,
    rootId,
    label,
    deletedAt,
    folderCount: rows.folders.length,
    linkCount: rows.links.length,
    noteCount: rows.notes.length,
    path,
  };
}

/** A one-line description of what a batch holds, for the trash list. */
export function describeTrashEntry(entry: TrashEntry): string {
  if (entry.kind === 'folder') {
    const parts: string[] = [];
    const subfolders = entry.folderCount - 1;
    if (subfolders > 0) parts.push(`${subfolders} subfolder${subfolders === 1 ? '' : 's'}`);
    if (entry.linkCount > 0) parts.push(`${entry.linkCount} link${entry.linkCount === 1 ? '' : 's'}`);
    if (parts.length === 0) return 'Empty folder';
    return parts.join(' · ');
  }
  if (entry.kind === 'note' && entry.noteCount > 1) {
    return `${entry.noteCount - 1} subnote${entry.noteCount === 2 ? '' : 's'}`;
  }
  return entry.path;
}

export const EMPTY_TRASH_IMPACT: TrashImpact = { folders: 0, links: 0, notes: 0, rehomed: 0 };

export function addImpact(a: TrashImpact, b: TrashImpact): TrashImpact {
  return {
    folders: a.folders + b.folders,
    links: a.links + b.links,
    notes: a.notes + b.notes,
    rehomed: a.rehomed + b.rehomed,
  };
}

/**
 * Where a restored row should end up.
 *
 * Restoring is not simply clearing a flag: while something was in the trash, its
 * parent may have been thrown away too — or purged for good. A row that came
 * back pointing at a parent nobody can see would be unreachable, which is
 * indistinguishable from still being deleted, so it is re-homed upward instead
 * and the move is reported.
 */
export function resolveRestoreParent(input: {
  parentId: string | null;
  /** Ids still in the trash *after* this batch is restored. */
  stillTrashed: ReadonlySet<string>;
  /** Ids that exist at all. */
  known: ReadonlySet<string>;
}): { parentId: string | null; rehomed: boolean } {
  const { parentId, stillTrashed, known } = input;
  if (!parentId) return { parentId: null, rehomed: false };
  if (known.has(parentId) && !stillTrashed.has(parentId)) return { parentId, rehomed: false };
  return { parentId: null, rehomed: true };
}

/**
 * Whether a folder's name was readable when it was thrown away.
 *
 * A sealed folder has no name at rest, so a trash entry for it shows as a locked
 * item rather than pretending to be empty. The UI asks this rather than checking
 * for an empty string itself, so "blank because encrypted" and "genuinely
 * nameless" stay distinguishable.
 */
export function isSealedEntry(entry: TrashEntry): boolean {
  return entry.label.trim().length === 0;
}

/** Folder ids that are in the trash, for filtering listings and pickers. */
export function trashedFolderIds(rows: readonly Folder[]): Set<string> {
  return new Set(trashedOnly(rows).map((folder) => folder.id));
}

/** Breadcrumb labels for a folder path, used by the trash entry subtitle. */
export function folderSubtitle(folders: readonly Folder[], folderId: string | null): string {
  if (!folderId) return 'Top level';
  return breadcrumbOf(folders, folderId)
    .map((folder) => folder.name)
    .join(' → ');
}
