import { db } from '@/db';
import type { Folder, Note, SavedLink, TrashEntry, TrashImpact } from '@/db/types';
import { newId } from '@/db/id';
import { descendantIdsOf, noteDescendantIds } from '@/lib/tree';
import { reconcileProtection } from '@/lib/privacy/reconcile';
import { EMPTY_TRASH_IMPACT, groupTrash, isTrashed, resolveRestoreParent } from '@/lib/trash';

/**
 * Throwing things away, and getting them back.
 *
 * The rule the whole module is built around: **nothing here destroys a row until
 * the user says so twice** — once by deleting (which is a move to the trash) and
 * once by purging (which is the only irreversible action in the product).
 *
 * Every operation is one Dexie transaction, so a half-restored folder is not a
 * state the database can be left in. Crypto is never awaited inside a
 * transaction: reconciliation runs after the commit, where it belongs.
 */

/** How many trashed rows exist, by family. Index-backed, so it is a lookup. */
export async function countTrashed(): Promise<{ folders: number; links: number; notes: number }> {
  const [folders, links, notes] = await Promise.all([
    db.folders.where('deletedAt').above(0).count(),
    db.links.where('deletedAt').above(0).count(),
    db.notes.where('deletedAt').above(0).count(),
  ]);
  return { folders, links, notes };
}

/** Every trashed row, grouped into the batches a person would recognise. */
export async function listTrashGroups(): Promise<TrashEntry[]> {
  const [folders, links, notes] = await Promise.all([
    db.folders.where('deletedAt').above(0).toArray(),
    db.links.where('deletedAt').above(0).toArray(),
    db.notes.where('deletedAt').above(0).toArray(),
  ]);
  if (folders.length === 0 && links.length === 0 && notes.length === 0) return [];

  // The subtitles need the parents that are *not* in the trash, so the whole set
  // is read. It is one pass over rows the app already holds in memory.
  const [allFolders, allNotes] = await Promise.all([db.folders.toArray(), db.notes.toArray()]);
  return groupTrash({ folders: allFolders, links, notes: allNotes });
}

function trashStamp(): number {
  return Date.now();
}

function newBatch(): string {
  return `t-${newId()}`;
}

// ---------------------------------------------------------------------------
// Throwing away
// ---------------------------------------------------------------------------

/**
 * Throw a link away.
 *
 * Its references from notes are left alone: a note that pointed at this link
 * keeps pointing at it, so restoring the link restores the connection too.
 * Unlinking is what permanent deletion does, not what throwing away does.
 */
export async function trashLink(id: string): Promise<TrashImpact> {
  return db.transaction('rw', db.links, async () => {
    const link = await db.links.get(id);
    if (!link || isTrashed(link)) return { ...EMPTY_TRASH_IMPACT };

    const deletedAt = trashStamp();
    await db.links.update(id, { deletedAt, trashBatch: newBatch() });
    return { folders: 0, links: 1, notes: 0, rehomed: 0 };
  });
}

/**
 * Throw one folder row away, leaving its subtree where it is.
 *
 * Used by the structural "delete the folder, keep the links" removal, where the
 * contents are re-homed upward and only the folder itself is going. Its name is
 * still something the user typed, so it goes to the trash rather than being
 * deleted outright: restoring it brings the empty folder back, which is a
 * smaller surprise than a name that vanished with no record of it.
 *
 * Called from inside the caller's transaction, so the re-homing and the disposal
 * either both happen or neither does.
 */
export async function trashFolderShell(id: string): Promise<void> {
  const now = trashStamp();
  await db.folders.update(id, { deletedAt: now, trashBatch: newBatch(), updatedAt: now });
}

/**
 * Throw a note away.
 *
 * `keep-children` promotes the subnotes and throws away only the note itself —
 * nothing is deleted, so nothing needs recovering. `delete-subtree` takes the
 * whole branch as one batch, which is what makes restoring it put the branch
 * back together rather than as a pile of loose notes.
 */
export async function trashNote(id: string, strategy: 'delete-subtree' | 'keep-children'): Promise<TrashImpact> {
  const impact = await db.transaction('rw', db.notes, async () => {
    const notes = await db.notes.toArray();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note || isTrashed(note)) return { ...EMPTY_TRASH_IMPACT };

    const deletedAt = trashStamp();
    if (strategy === 'keep-children') {
      // Structural, and nothing is thrown away: the children take this note's
      // place, so the user never needs the trash for them.
      const children = notes
        .filter((candidate) => candidate.parentNoteId === id && !isTrashed(candidate))
        .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.title.localeCompare(b.title)));
      const siblings = notes.filter(
        (candidate) => candidate.parentNoteId === note.parentNoteId && candidate.id !== id && !isTrashed(candidate),
      );
      const baseOrder = siblings.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
      const now = Date.now();
      await Promise.all(
        children.map((child, index) =>
          db.notes.update(child.id, {
            parentNoteId: note.parentNoteId,
            sortOrder: baseOrder + index,
            updatedAt: now,
          }),
        ),
      );
      await db.notes.update(id, { deletedAt, trashBatch: newBatch() });
      return { folders: 0, links: 0, notes: 1, rehomed: children.length };
    }

    const descendants = noteDescendantIds(notes, id);
    const batch = newBatch();
    const doomed = [id, ...descendants];
    await Promise.all(doomed.map((noteId) => db.notes.update(noteId, { deletedAt, trashBatch: batch })));
    return { folders: 0, links: 0, notes: doomed.length, rehomed: 0 };
  });

  // A trashed note leaves its parent's lock region, which can change what its
  // subnotes inherit. Reconciling after the commit keeps sealing in step.
  if (impact.notes > 0) await reconcileProtection();
  return impact;
}

/**
 * Throw a folder and everything under it away, as one batch.
 *
 * The links inside come along, because they were *in* the folder: leaving them
 * behind would scatter a deleted topic's contents into the library root, which is
 * precisely the loss the trash exists to prevent. Notes are untouched — a note is
 * not inside a folder.
 *
 * Only the *live* subtree is stamped. A subfolder that was already thrown away is
 * its own decision with its own batch, and deleting its former parent must not
 * quietly absorb it: doing so would erase a trash entry the user could still see,
 * and restoring the parent would then resurrect something deleted separately.
 * Already-trashed rows are therefore left exactly as they are.
 */
export async function trashFolder(id: string): Promise<TrashImpact> {
  const impact = await db.transaction('rw', db.folders, db.links, async () => {
    const folders = await db.folders.toArray();
    const folder = folders.find((candidate) => candidate.id === id);
    if (!folder || isTrashed(folder)) return { ...EMPTY_TRASH_IMPACT };

    const batch = newBatch();
    const deletedAt = trashStamp();
    const trashedFolderIds = new Set(folders.filter(isTrashed).map((row) => row.id));
    // `descendantIdsOf` says where the rows are; the filter says which of them
    // this act actually concerns.
    const folderIds = [id, ...descendantIdsOf(folders, id)].filter(
      (folderId) => !trashedFolderIds.has(folderId),
    );

    const links = await db.links.where('folderId').anyOf(folderIds).toArray();
    const liveLinks = links.filter((link) => !isTrashed(link));

    await Promise.all(folderIds.map((folderId) => db.folders.update(folderId, { deletedAt, trashBatch: batch })));
    if (liveLinks.length > 0) {
      await Promise.all(
        liveLinks.map((link) => db.links.update(link.id, { deletedAt, trashBatch: batch })),
      );
    }

    return { folders: folderIds.length, links: liveLinks.length, notes: 0, rehomed: 0 };
  });

  if (impact.folders > 0) await reconcileProtection();
  return impact;
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

/**
 * Bring a whole batch back.
 *
 * The rows return to the ids and the positions they had. Where a parent is no
 * longer available — thrown away in a different act, or purged for good — the row
 * is re-homed to the top level (or to the Inbox, for a link) rather than being
 * left unreachable, and the count of those moves is reported so the user is not
 * surprised by where something landed.
 */
export async function restoreBatch(batch: string): Promise<TrashImpact> {
  const impact = await db.transaction(
    'rw',
    [db.folders, db.links, db.notes],
    async () => {
      const [folders, links, notes] = await Promise.all([
        db.folders.toArray(),
        db.links.toArray(),
        db.notes.toArray(),
      ]);

      const batchRows = {
        folders: folders.filter((row: Folder) => row.trashBatch === batch && isTrashed(row)),
        links: links.filter((row: SavedLink) => row.trashBatch === batch && isTrashed(row)),
        notes: notes.filter((row: Note) => row.trashBatch === batch && isTrashed(row)),
      };
      if (batchRows.folders.length + batchRows.links.length + batchRows.notes.length === 0) {
        return { ...EMPTY_TRASH_IMPACT };
      }

      // What is still in the trash *after* this batch comes back determines which
      // parents are usable.
      const restoringFolders = new Set(batchRows.folders.map((row) => row.id));
      const restoringNotes = new Set(batchRows.notes.map((row) => row.id));

      const trashedFolderIds = new Set(
        folders.filter((row) => isTrashed(row) && !restoringFolders.has(row.id)).map((row) => row.id),
      );
      const trashedNoteIds = new Set(
        notes.filter((row) => isTrashed(row) && !restoringNotes.has(row.id)).map((row) => row.id),
      );
      const knownFolderIds = new Set(folders.map((row) => row.id));
      const knownNoteIds = new Set(notes.map((row) => row.id));

      let rehomed = 0;
      const now = Date.now();

      // Rows are written back whole with the trash fields *removed* rather than
      // patched with `undefined`. Restoration is rare enough that a full write is
      // free, and deleting the properties outright leaves no doubt about whether
      // an `undefined` value cleared the index entry or merely stored one.
      const restoredFolders: Folder[] = batchRows.folders.map((folder) => {
        const resolved = resolveRestoreParent({
          parentId: folder.parentId,
          stillTrashed: trashedFolderIds,
          known: knownFolderIds,
        });
        if (resolved.rehomed) rehomed += 1;
        const next: Folder = { ...folder, parentId: resolved.parentId, updatedAt: now };
        delete next.deletedAt;
        delete next.trashBatch;
        return next;
      });
      if (restoredFolders.length > 0) await db.folders.bulkPut(restoredFolders);

      const restoredLinks: SavedLink[] = batchRows.links.map((link) => {
        // A link's home is a folder, or the Inbox when it had none or the folder
        // is gone. Landing in the Inbox is better than pointing at a folder the
        // user cannot open.
        const target = link.folderId;
        const needsMove = target !== null && (trashedFolderIds.has(target) || !knownFolderIds.has(target));
        if (needsMove) rehomed += 1;
        const next: SavedLink = { ...link, folderId: needsMove ? null : target, updatedAt: now };
        delete next.deletedAt;
        delete next.trashBatch;
        return next;
      });
      if (restoredLinks.length > 0) await db.links.bulkPut(restoredLinks);

      const restoredNotes: Note[] = batchRows.notes.map((note) => {
        const resolved = resolveRestoreParent({
          parentId: note.parentNoteId,
          stillTrashed: trashedNoteIds,
          known: knownNoteIds,
        });
        if (resolved.rehomed) rehomed += 1;
        const next: Note = { ...note, parentNoteId: resolved.parentId, updatedAt: now };
        delete next.deletedAt;
        delete next.trashBatch;
        return next;
      });
      if (restoredNotes.length > 0) await db.notes.bulkPut(restoredNotes);

      return {
        folders: batchRows.folders.length,
        links: batchRows.links.length,
        notes: batchRows.notes.length,
        rehomed,
      } satisfies TrashImpact;
    },
  );

  // A restored row can land inside a locked region (or beside one), so the
  // sealing of the subtree is derived again rather than assumed.
  if (impact.folders + impact.links + impact.notes > 0) await reconcileProtection();
  return impact;
}

/** Bring back everything currently in the trash. */
export async function restoreAll(): Promise<TrashImpact> {
  const [folders, links, notes] = await Promise.all([
    db.folders.where('deletedAt').above(0).toArray(),
    db.links.where('deletedAt').above(0).toArray(),
    db.notes.where('deletedAt').above(0).toArray(),
  ]);
  const batches = new Set<string>();
  for (const row of [...folders, ...links, ...notes]) {
    if (row.trashBatch) batches.add(row.trashBatch);
  }

  let total = { ...EMPTY_TRASH_IMPACT };
  for (const batch of batches) {
    const impact = await restoreBatch(batch);
    total = {
      folders: total.folders + impact.folders,
      links: total.links + impact.links,
      notes: total.notes + impact.notes,
      rehomed: total.rehomed + impact.rehomed,
    };
  }
  return total;
}

// ---------------------------------------------------------------------------
// Destroying
// ---------------------------------------------------------------------------

/**
 * Remove a batch for good.
 *
 * This is the only irreversible operation in Stash, and it is deliberately the
 * least convenient one. Join rows that only existed to describe a destroyed row
 * go with it — a tag applied to a link nobody can reach is not information, it is
 * litter. Notes themselves are never touched by deleting a link, and links are
 * never touched by deleting a note.
 */
export async function purgeBatch(batch: string): Promise<TrashImpact> {
  return db.transaction('rw', [db.folders, db.links, db.notes, db.noteLinks, db.linkTags], async () => {
    const [folders, links, notes] = await Promise.all([
      db.folders.toArray(),
      db.links.toArray(),
      db.notes.toArray(),
    ]);

    const folderIds = folders.filter((row: Folder) => row.trashBatch === batch && isTrashed(row)).map((row) => row.id);
    const linkIds = links.filter((row: SavedLink) => row.trashBatch === batch && isTrashed(row)).map((row) => row.id);
    const noteIds = notes.filter((row: Note) => row.trashBatch === batch && isTrashed(row)).map((row) => row.id);

    if (folderIds.length + linkIds.length + noteIds.length === 0) return { ...EMPTY_TRASH_IMPACT };

    if (linkIds.length > 0) {
      await db.linkTags.where('linkId').anyOf(linkIds).delete();
      await db.noteLinks.where('linkId').anyOf(linkIds).delete();
    }
    if (noteIds.length > 0) {
      await db.noteLinks.where('noteId').anyOf(noteIds).delete();
    }

    if (folderIds.length > 0) await db.folders.bulkDelete(folderIds);
    if (linkIds.length > 0) await db.links.bulkDelete(linkIds);
    if (noteIds.length > 0) await db.notes.bulkDelete(noteIds);

    return { folders: folderIds.length, links: linkIds.length, notes: noteIds.length, rehomed: 0 };
  });
}

/** Empty the trash. Every trashed row, gone, in one transaction. */
export async function emptyTrash(): Promise<TrashImpact> {
  return db.transaction('rw', [db.folders, db.links, db.notes, db.noteLinks, db.linkTags], async () => {
    const [folders, links, notes] = await Promise.all([
      db.folders.where('deletedAt').above(0).toArray(),
      db.links.where('deletedAt').above(0).toArray(),
      db.notes.where('deletedAt').above(0).toArray(),
    ]);

    if (folders.length === 0 && links.length === 0 && notes.length === 0) return { ...EMPTY_TRASH_IMPACT };

    const folderIds = folders.map((row: Folder) => row.id);
    const linkIds = links.map((row: SavedLink) => row.id);
    const noteIds = notes.map((row: Note) => row.id);

    await db.linkTags.where('linkId').anyOf(linkIds).delete();
    await db.noteLinks.where('linkId').anyOf(linkIds).delete();
    await db.noteLinks.where('noteId').anyOf(noteIds).delete();

    await db.folders.bulkDelete(folderIds);
    await db.links.bulkDelete(linkIds);
    await db.notes.bulkDelete(noteIds);

    return { folders: folderIds.length, links: linkIds.length, notes: noteIds.length, rehomed: 0 };
  });
}

