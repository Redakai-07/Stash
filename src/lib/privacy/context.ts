import { db } from '@/db';
import { computeProtection, type Protection } from './protection';

/**
 * DB-aware privacy queries.
 *
 * Kept apart from `protection.ts` so that module stays pure and unit-testable,
 * and apart from the repositories so the "what is protected right now" question
 * has exactly one implementation.
 *
 * Reading protection requires the structural fields only — ids, parents and the
 * lock flags — every one of which is plaintext even when the row around it is
 * sealed. That is deliberate: the lock state has to be resolvable while the
 * vault is locked, otherwise the app could not know what to hide.
 */
export async function readProtection(): Promise<Protection> {
  const [folders, notes, links] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.links.toArray(),
  ]);
  return computeProtection(folders, notes, links);
}

/** Whether a folder (or anything above it) is locked right now. */
export async function isFolderProtected(folderId: string | null): Promise<boolean> {
  if (!folderId) return false;
  const protection = await readProtection();
  return protection.folders.has(folderId);
}

/** Whether a note's ancestors include a locked note. */
export async function isNoteParentProtected(parentNoteId: string | null): Promise<boolean> {
  if (!parentNoteId) return false;
  const protection = await readProtection();
  return protection.notes.has(parentNoteId);
}
