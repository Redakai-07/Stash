import { newId } from '../id';
import {
  db,
  type Note,
  type NoteDeletionImpact,
  type NoteLink,
  type NoteLinkOrigin,
  type SavedLink,
} from '../index';
import {
  canMoveNote,
  nextNoteSortOrder,
  noteDeletionImpact,
  noteDescendantIds,
  type MoveCheck,
} from '@/lib/tree';
import { contentFromLink, deriveNoteTitle, sanitizeNoteTitle, titleFromLink } from '@/lib/notes';

/**
 * Note persistence.
 *
 * Two invariants are enforced here rather than trusted to the UI:
 *
 *  1. Deleting a note never deletes a saved link. Note deletion removes note
 *     rows and the references that point at links; the links themselves are not
 *     in the transaction's blast radius.
 *  2. A note can never be its own ancestor. Moves are validated against the
 *     same pure rules the UI uses to grey out impossible destinations.
 */

export interface CreateNoteInput {
  title?: string;
  content?: string;
  parentNoteId?: string | null;
  /** Used when the title is blank: derived from the first line of content. */
  fallbackTitle?: string;
}

export type CreateNoteResult =
  | { ok: true; note: Note }
  | { ok: false; reason: 'invalid'; message: string };

export async function listNotes(): Promise<Note[]> {
  return db.notes.toArray();
}

export async function getNote(id: string): Promise<Note | undefined> {
  return db.notes.get(id);
}

export async function countNotes(): Promise<number> {
  return db.notes.count();
}

export function buildNoteRecord(input: CreateNoteInput, siblings: readonly Note[]): Note {
  const now = Date.now();
  const content = input.content ?? '';
  const title = sanitizeNoteTitle(input.title ?? '') || deriveNoteTitle(content, input.fallbackTitle ?? 'Untitled note');
  const parentNoteId = input.parentNoteId ?? null;

  return {
    id: newId(),
    parentNoteId,
    title,
    content,
    createdAt: now,
    updatedAt: now,
    sortOrder: nextNoteSortOrder(siblings, parentNoteId),
    isFavorite: false,
    isArchived: false,
    isLocked: false,
  };
}

export async function createNote(input: CreateNoteInput): Promise<CreateNoteResult> {
  return db.transaction('rw', db.notes, async () => {
    const notes = await db.notes.toArray();
    const parentNoteId = input.parentNoteId ?? null;
    if (parentNoteId && !notes.some((note) => note.id === parentNoteId)) {
      return { ok: false, reason: 'invalid', message: 'The parent note no longer exists.' } as const;
    }

    const note = buildNoteRecord(input, notes);
    await db.notes.add(note);
    return { ok: true, note } as const;
  });
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
}

export async function updateNote(id: string, patch: UpdateNoteInput): Promise<Note | null> {
  return db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note) return null;

    const updated: Note = { ...note, updatedAt: Date.now() };
    if (patch.title !== undefined) {
      const title = sanitizeNoteTitle(patch.title);
      updated.title = title.length > 0 ? title : deriveNoteTitle(updated.content);
    }
    if (patch.content !== undefined) updated.content = patch.content;

    await db.notes.put(updated);
    return updated;
  });
}

/**
 * The autosave path.
 *
 * Deliberately narrow: it writes only content, title, and `updatedAt`, and it
 * never rewrites structure. Typing cannot disturb a note's position in the
 * tree, and an interrupted save can only ever lose the last few keystrokes.
 */
export async function saveNoteContent(id: string, content: string): Promise<number | null> {
  const note = await db.notes.get(id);
  if (!note) return null;
  const updatedAt = Date.now();
  // `modify` avoids a read-modify-write race with a concurrent structural change.
  await db.notes.update(id, { content, updatedAt });
  return updatedAt;
}

export async function renameNote(id: string, rawTitle: string): Promise<Note | null> {
  const title = sanitizeNoteTitle(rawTitle);
  return updateNote(id, { title });
}

export type MoveNoteResult = { ok: true; note: Note } | { ok: false; reason: string };

export async function canMoveNoteTo(id: string, targetParentNoteId: string | null): Promise<MoveCheck> {
  const notes = await db.notes.toArray();
  return canMoveNote(notes, id, targetParentNoteId);
}

export async function moveNote(id: string, targetParentNoteId: string | null): Promise<MoveNoteResult> {
  return db.transaction('rw', db.notes, async () => {
    const notes = await db.notes.toArray();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return { ok: false, reason: 'That note no longer exists.' } as const;

    const check = canMoveNote(notes, id, targetParentNoteId);
    if (!check.ok) return { ok: false, reason: check.reason } as const;

    const updated: Note = {
      ...note,
      parentNoteId: targetParentNoteId,
      sortOrder: nextNoteSortOrder(notes, targetParentNoteId),
      updatedAt: Date.now(),
    };
    await db.notes.put(updated);
    return { ok: true, note: updated } as const;
  });
}

/** Shift a note one slot up or down among its siblings. */
export async function reorderNote(id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.notes, async () => {
    const notes = await db.notes.toArray();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return false;

    const siblings = notes
      .filter((candidate) => candidate.parentNoteId === note.parentNoteId)
      .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.title.localeCompare(b.title)));

    const index = siblings.findIndex((candidate) => candidate.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= siblings.length) return false;

    const reordered = siblings.slice();
    const [moved] = reordered.splice(index, 1);
    if (!moved) return false;
    reordered.splice(target, 0, moved);

    const now = Date.now();
    await Promise.all(
      reordered.map((candidate, position) =>
        db.notes.update(candidate.id, { sortOrder: position, updatedAt: now }),
      ),
    );
    return true;
  });
}

export async function setNoteFavorite(id: string, isFavorite: boolean): Promise<void> {
  await db.notes.update(id, { isFavorite, updatedAt: Date.now() });
}

export async function setNoteArchived(id: string, isArchived: boolean): Promise<void> {
  await db.notes.update(id, { isArchived, updatedAt: Date.now() });
}

/**
 * Locking is persisted but not yet enforced: Phase 1 committed to the schema so
 * enabling it later never requires a migration.
 */
export async function setNoteLocked(id: string, isLocked: boolean): Promise<void> {
  await db.notes.update(id, { isLocked, updatedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

export type NoteDeleteStrategy = 'delete-subtree' | 'keep-children';

export interface DeleteNoteResult {
  ok: boolean;
  removedNoteCount: number;
  /** Subnotes re-parented instead of removed (`keep-children`). */
  movedNoteCount: number;
  /** References removed. Saved links are never counted here as deletions. */
  removedReferenceCount: number;
}

export async function getNoteDeletionImpact(id: string): Promise<NoteDeletionImpact | null> {
  const [notes, noteLinks] = await Promise.all([db.notes.toArray(), db.noteLinks.toArray()]);
  return noteDeletionImpact(notes, groupLinksByNote(noteLinks), id);
}

/** `noteId -> linkIds`, the shape the pure impact calculation expects. */
export function groupLinksByNote(noteLinks: readonly NoteLink[]): Map<string, string[]> {
  const byNote = new Map<string, string[]>();
  for (const row of noteLinks) {
    const bucket = byNote.get(row.noteId);
    if (bucket) bucket.push(row.linkId);
    else byNote.set(row.noteId, [row.linkId]);
  }
  return byNote;
}

/**
 * Delete a note.
 *
 * `keep-children` promotes the subnotes to where the note used to sit, which is
 * the safe default the UI recommends. `delete-subtree` removes the branch. In
 * both cases saved links survive untouched -- only the references from the
 * removed notes are cleaned up.
 */
export async function deleteNote(id: string, strategy: NoteDeleteStrategy): Promise<DeleteNoteResult> {
  return db.transaction('rw', db.notes, db.noteLinks, async () => {
    const notes = await db.notes.toArray();
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) {
      return { ok: false, removedNoteCount: 0, movedNoteCount: 0, removedReferenceCount: 0 };
    }

    const descendants = noteDescendantIds(notes, id);
    const doomed = [id, ...descendants];

    const references = await db.noteLinks.where('noteId').anyOf(doomed).toArray();
    if (references.length > 0) {
      await db.noteLinks.bulkDelete(
        references.map((reference) => [reference.noteId, reference.linkId] as [string, string]),
      );
    }

    if (strategy === 'delete-subtree') {
      await db.notes.bulkDelete(doomed);
      return {
        ok: true,
        removedNoteCount: doomed.length,
        movedNoteCount: 0,
        removedReferenceCount: references.length,
      };
    }

    // keep-children: promote the direct children to the deleted note's parent.
    const newParentId = note.parentNoteId;
    const remaining = notes.filter((candidate) => !doomed.includes(candidate.id));
    const baseOrder = nextNoteSortOrder(remaining, newParentId);
    const children = notes
      .filter((candidate) => candidate.parentNoteId === id)
      .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.title.localeCompare(b.title)));

    const now = Date.now();
    await Promise.all(
      children.map((child, index) =>
        db.notes.update(child.id, { parentNoteId: newParentId, sortOrder: baseOrder + index, updatedAt: now }),
      ),
    );
    await db.notes.delete(id);

    return {
      ok: true,
      removedNoteCount: 1,
      movedNoteCount: children.length,
      removedReferenceCount: references.filter((reference) => reference.noteId === id).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Links <-> notes
// ---------------------------------------------------------------------------

export async function listNoteLinks(): Promise<NoteLink[]> {
  return db.noteLinks.toArray();
}

export async function linkIdsForNote(noteId: string): Promise<string[]> {
  const rows = await db.noteLinks.where('noteId').equals(noteId).toArray();
  return rows.map((row) => row.linkId);
}

export async function noteIdsForLink(linkId: string): Promise<string[]> {
  const rows = await db.noteLinks.where('linkId').equals(linkId).toArray();
  return rows.map((row) => row.noteId);
}

/**
 * Reference a saved link from a note.
 *
 * Only the link's id is stored. The one SavedLink row remains the single source
 * of truth for the URL, title and folder, so a note never holds a stale copy of
 * a link that has since moved.
 */
export async function attachLinkToNote(
  noteId: string,
  linkId: string,
  origin: NoteLinkOrigin = 'attached',
): Promise<NoteLink | null> {
  return db.transaction('rw', db.notes, db.links, db.noteLinks, async () => {
    const [note, link] = await Promise.all([db.notes.get(noteId), db.links.get(linkId)]);
    if (!note || !link) return null;

    const existing = await db.noteLinks.get([noteId, linkId]);
    if (existing) return existing;

    const siblings = await db.noteLinks.where('noteId').equals(noteId).toArray();
    const record: NoteLink = {
      noteId,
      linkId,
      origin,
      createdAt: Date.now(),
      sortOrder: siblings.length === 0 ? 0 : Math.max(...siblings.map((row) => row.sortOrder)) + 1,
    };
    await db.noteLinks.put(record);
    return record;
  });
}

/** Remove the reference only. The saved link is untouched. */
export async function detachLinkFromNote(noteId: string, linkId: string): Promise<void> {
  await db.noteLinks.delete([noteId, linkId]);
}

/**
 * Cascade used when a saved link is itself deleted: the notes that referenced it
 * simply stop referencing it. Notes are never deleted as a side effect.
 */
export async function removeLinkReferences(linkId: string): Promise<number> {
  return db.transaction('rw', db.noteLinks, async () => {
    const rows = await db.noteLinks.where('linkId').equals(linkId).toArray();
    if (rows.length === 0) return 0;
    await db.noteLinks.bulkDelete(rows.map((row) => [row.noteId, row.linkId] as [string, string]));
    return rows.length;
  });
}

export interface CreateNoteFromLinkOptions {
  parentNoteId?: string | null;
  /** Write the URL into the note body as well as referencing it. */
  includeLinkUrl?: boolean;
  title?: string;
}

/**
 * Turn a saved link into a note.
 *
 * The new note is titled from the link, seeded with the link's own note text,
 * and the link is attached with `origin: 'created-from'` so the relationship
 * survives even if the body text is later rewritten.
 */
export async function createNoteFromLink(
  linkId: string,
  options: CreateNoteFromLinkOptions = {},
): Promise<CreateNoteResult> {
  const link = await db.links.get(linkId);
  if (!link) return { ok: false, reason: 'invalid', message: 'That link no longer exists.' };

  const result = await createNote({
    title: options.title ?? titleFromLink(link),
    content: contentFromLink(link, { includeLinkUrl: options.includeLinkUrl ?? true }),
    parentNoteId: options.parentNoteId ?? null,
  });
  if (!result.ok) return result;

  await attachLinkToNote(result.note.id, linkId, 'created-from');
  return result;
}

/** Links referenced by a note, resolved for display. Order follows `sortOrder`. */
export async function linksReferencedByNote(noteId: string): Promise<SavedLink[]> {
  const rows = await db.noteLinks.where('noteId').equals(noteId).toArray();
  if (rows.length === 0) return [];
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  const links = await db.links.where('id').anyOf(rows.map((row) => row.linkId)).toArray();
  const byId = new Map(links.map((link) => [link.id, link]));
  return rows
    .map((row) => byId.get(row.linkId))
    .filter((link): link is SavedLink => Boolean(link));
}

/**
 * Notes that reference a link, resolved for display. Used by the link sheet so a
 * saved link can show what thinking it is attached to.
 */
export async function notesReferencingLink(linkId: string): Promise<Note[]> {
  const rows = await db.noteLinks.where('linkId').equals(linkId).toArray();
  if (rows.length === 0) return [];
  const notes = await db.notes.where('id').anyOf(rows.map((row) => row.noteId)).toArray();
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

/** Note ids and titles for a whole set of links at once, for list rendering. */
export async function noteReferenceMap(): Promise<Map<string, string[]>> {
  const rows = await db.noteLinks.toArray();
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = map.get(row.linkId);
    if (bucket) bucket.push(row.noteId);
    else map.set(row.linkId, [row.noteId]);
  }
  return map;
}
