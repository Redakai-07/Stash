import { newId } from '../id';
import { db, type Folder, type FolderDeletionImpact, type SavedLink } from '../index';
import {
  canMoveFolder,
  descendantIdsOf,
  folderDeletionImpact,
  hasSiblingWithName,
  nextSortOrder,
} from '@/lib/tree';
import { computeFolderStats, type FolderStats } from '@/lib/folder-stats';
import { isFolderProtected } from '@/lib/privacy/context';
import { getVaultKey } from '@/lib/privacy/keyring';
import { isSealed, openFolder, sealFolder } from '@/lib/privacy/protection';
import { reconcileProtection } from '@/lib/privacy/reconcile';

export type { FolderStats };

/**
 * Folder persistence. Every structural rule lives in `@/lib/tree`, so this
 * module only has to load data, validate, and write it back.
 *
 * ## Why the sealing paths are not wrapped in a Dexie transaction
 *
 * Dexie ends a transaction as soon as the callback yields to a promise it does
 * not own, and WebCrypto is exactly that — `crypto.subtle.encrypt` resolves on a
 * platform task outside Dexie's zone. Awaiting it inside `db.transaction`
 * therefore produces `PrematureCommitError: Transaction committed too early`,
 * and the write is lost.
 *
 * The two cannot be mixed, so the crypto happens *around* the database read and
 * write rather than inside them. The cost is that create and rename are no
 * longer a single atomic step; what is bought is that sealing actually happens.
 * A concurrent duplicate folder name is a harmless outcome — the vault tolerates
 * same-named siblings (ordering already falls back to the label) — whereas
 * silently failing to encrypt a locked row is not.
 */

export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
  icon?: string;
}

export type CreateFolderResult =
  | { ok: true; folder: Folder }
  | { ok: false; reason: 'duplicate'; existing: Folder }
  | { ok: false; reason: 'invalid'; message: string };

export async function listFolders(): Promise<Folder[]> {
  return db.folders.toArray();
}

export async function getFolder(id: string): Promise<Folder | undefined> {
  return db.folders.get(id);
}

/** Trim + collapse internal whitespace; names are display-only, not paths. */
export function sanitizeFolderName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function createFolder(input: CreateFolderInput): Promise<CreateFolderResult> {
  const name = sanitizeFolderName(input.name);
  if (name.length === 0) return { ok: false, reason: 'invalid', message: 'Enter a folder name.' };

  const parentId = input.parentId ?? null;
  const parentProtected = await isFolderProtected(parentId);

  const folders = await db.folders.toArray();
  if (parentId && !folders.some((folder) => folder.id === parentId)) {
    return { ok: false, reason: 'invalid', message: 'The parent folder no longer exists.' };
  }
  // Compared in plaintext so a locked sibling's blanked name cannot make an
  // ordinary duplicate look free.
  const opened = await Promise.all(folders.map((candidate) => openFolder(candidate, getVaultKey())));
  const existing = opened.find(
    (folder) => folder.parentId === parentId && folder.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing) return { ok: false, reason: 'duplicate', existing };

  const now = Date.now();
  const folder: Folder = {
    id: newId(),
    parentId,
    name,
    createdAt: now,
    updatedAt: now,
    sortOrder: nextSortOrder(opened, parentId),
    isFavorite: false,
    isLocked: false,
  };
  if (input.icon) folder.icon = input.icon;
  // A subfolder of a locked folder is born sealed, so its name never exists in
  // the clear even for an instant. The plaintext record is still returned.
  await db.folders.add(parentProtected ? await sealFolder(folder, getVaultKey()) : folder);
  return { ok: true, folder };
}

export async function renameFolder(id: string, rawName: string): Promise<Folder | null> {
  const name = sanitizeFolderName(rawName);
  if (name.length === 0) return null;
  const raw = await db.folders.get(id);
  if (!raw) return null;
  // Compare against the plaintext names: siblings inside a locked folder have
  // blank names on disk, and a duplicate check against "" would be meaningless.
  const folders = await Promise.all(
    (await db.folders.toArray()).map((candidate) => openFolder(candidate, getVaultKey())),
  );
  const folder = folders.find((candidate) => candidate.id === id) ?? await openFolder(raw, getVaultKey());
  if (hasSiblingWithName(folders, folder.parentId, name, id)) return null;
  const updated: Folder = { ...folder, name, updatedAt: Date.now() };
  // The new name is sealed on the way in: a rename must never write a locked
  // folder's name in the clear.
  await db.folders.put(isSealed(raw) ? await sealFolder(updated, getVaultKey()) : updated);
  return updated;
}

export type MoveResult = { ok: true; folder: Folder } | { ok: false; reason: string };

export async function moveFolder(id: string, targetParentId: string | null): Promise<MoveResult> {
  // Names are compared in plaintext, then the row is put back in the form it was
  // found in, so a sealed folder stays sealed through the move.
  const raw = await db.folders.toArray();
  const sealedIds = new Set(raw.filter(isSealed).map((candidate) => candidate.id));
  const folders = await Promise.all(raw.map((candidate) => openFolder(candidate, getVaultKey())));
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return { ok: false, reason: 'That folder no longer exists.' };

  const check = canMoveFolder(folders, id, targetParentId);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (targetParentId && hasSiblingWithName(folders, targetParentId, folder.name, id)) {
    return { ok: false, reason: 'A folder with that name already exists there.' };
  }

  const updated: Folder = {
    ...folder,
    parentId: targetParentId,
    sortOrder: nextSortOrder(folders, targetParentId),
    updatedAt: Date.now(),
  };
  await db.folders.put(sealedIds.has(updated.id) ? await sealFolder(updated, getVaultKey()) : updated);
  const result: MoveResult = { ok: true, folder: updated };

  // The destination may be inside a locked folder (seal the subtree) or outside
  // one (open it again).
  if (result.ok) await reconcileProtection();
  return result;
}

/** Shift a folder one slot up or down among its siblings. */
export async function reorderFolder(id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.folders, async () => {
    const folders = await db.folders.toArray();
    const folder = folders.find((candidate) => candidate.id === id);
    if (!folder) return false;

    const siblings = folders
      .filter((candidate) => candidate.parentId === folder.parentId)
      .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name)));

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
        db.folders.update(candidate.id, { sortOrder: position, updatedAt: now }),
      ),
    );
    return true;
  });
}

export async function setFolderFavorite(id: string, isFavorite: boolean): Promise<void> {
  await db.folders.update(id, { isFavorite, updatedAt: Date.now() });
}

/**
 * Lock or unlock one folder.
 *
 * A folder lock is inherited: every subfolder and every link beneath it is
 * protected too, and reconciliation seals the whole subtree. Unlocking releases
 * the subtree the same way. Nothing about the descendants is stored, so a later
 * move cannot leave a record hidden but readable.
 */
export async function setFolderLocked(id: string, isLocked: boolean): Promise<void> {
  await db.folders.update(id, { isLocked, updatedAt: Date.now() });
  await reconcileProtection();
}

/**
 * Whether clearing this folder's flag would actually release it. A subfolder of
 * a locked folder cannot be unlocked on its own.
 */
export async function isFolderLockInherited(id: string): Promise<boolean> {
  const folders = await db.folders.toArray();
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder || folder.isLocked || !folder.parentId) return false;
  return isFolderProtected(folder.parentId);
}

export async function setFolderIcon(id: string, icon: string | undefined): Promise<void> {
  const raw = await db.folders.get(id);
  if (!raw) return;
  const folder = await openFolder(raw, getVaultKey());
  const updated: Folder = { ...folder, updatedAt: Date.now() };
  if (icon) updated.icon = icon;
  else delete updated.icon;
  await db.folders.put(isSealed(raw) ? await sealFolder(updated, getVaultKey()) : updated);
}

export async function getDeletionImpact(id: string): Promise<FolderDeletionImpact | null> {
  const [folders, links] = await Promise.all([db.folders.toArray(), db.links.toArray()]);
  return folderDeletionImpact(folders, links, id);
}

export type DeleteStrategy = 'move-contents-up' | 'delete-everything';

export interface DeleteFolderResult {
  ok: boolean;
  removedFolderCount: number;
  /** Links deleted outright (delete-everything). */
  removedLinkCount: number;
  /** Links re-homed into the parent folder (move-contents-up). */
  movedLinkCount: number;
}

/**
 * Deleting is always explicit about what happens to the contents. There is no
 * code path that removes a folder's data as a side effect of removing the
 * folder itself.
 */
export async function deleteFolder(id: string, strategy: DeleteStrategy): Promise<DeleteFolderResult> {
  const result = await db.transaction('rw', db.folders, db.links, async () => {
    const folders = await db.folders.toArray();
    const folder = folders.find((candidate) => candidate.id === id);
    if (!folder) {
      return { ok: false, removedFolderCount: 0, removedLinkCount: 0, movedLinkCount: 0 };
    }

    const descendants = descendantIdsOf(folders, id);
    const doomedFolders = [id, ...descendants];
    const parentId = folder.parentId;

    if (strategy === 'delete-everything') {
      const links = await db.links.where('folderId').anyOf(doomedFolders).toArray();
      await db.links.bulkDelete(links.map((link: SavedLink) => link.id));
      await db.folders.bulkDelete(doomedFolders);
      return {
        ok: true,
        removedFolderCount: doomedFolders.length,
        removedLinkCount: links.length,
        movedLinkCount: 0,
      };
    }

    // move-contents-up: links in this exact folder are re-homed; all deeper
    // folders are flattened into the parent so nothing is lost. Their links
    // follow them, which keeps the structure meaningful without deleting data.
    const links = await db.links.toArray();
    const movedLinks = links.filter((link) => link.folderId !== null && doomedFolders.includes(link.folderId));
    const now = Date.now();
    await Promise.all(
      movedLinks.map((link) => db.links.update(link.id, { folderId: parentId, updatedAt: now })),
    );

    const remaining = folders.filter((candidate) => !doomedFolders.includes(candidate.id));
    const baseOrder = nextSortOrder(remaining, parentId);
    const childrenInOrder = folders
      .filter((candidate) => descendantOrderRank(doomedFolders, candidate) >= 0)
      .sort((a, b) => descendantOrderRank(doomedFolders, a) - descendantOrderRank(doomedFolders, b));
    await Promise.all(
      childrenInOrder.map((candidate, index) =>
        db.folders.update(candidate.id, {
          parentId,
          sortOrder: baseOrder + index,
          updatedAt: now,
        }),
      ),
    );

    await db.folders.delete(id);
    return {
      ok: true,
      removedFolderCount: 1,
      removedLinkCount: 0,
      movedLinkCount: movedLinks.length,
    };
  });

  // Flattening a deleted folder's children into its parent can lift them out of
  // a locked region, in which case they must be opened again.
  if (result.ok) await reconcileProtection();
  return result;
}

/** Stable ordering rank of a doomed descendant, used when flattening upward. */
function descendantOrderRank(doomed: readonly string[], candidate: Folder): number {
  const index = doomed.indexOf(candidate.id);
  return index < 0 ? -1 : index;
}

/**
 * Counts for every folder, with no filtering. The UI uses the pure
 * {@link computeFolderStats} directly so it can pass the lock-aware hidden sets;
 * this stays as the unfiltered database read for callers that just want totals.
 */
export async function getFolderStats(): Promise<Map<string, FolderStats>> {
  const [folders, links] = await Promise.all([db.folders.toArray(), db.links.toArray()]);
  return computeFolderStats(folders, links);
}
