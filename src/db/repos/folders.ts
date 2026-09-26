import { newId } from '../id';
import { db, type Folder, type FolderDeletionImpact, type SavedLink } from '../index';
import {
  canMoveFolder,
  descendantIdsOf,
  folderDeletionImpact,
  hasSiblingWithName,
  nextSortOrder,
} from '@/lib/tree';

/**
 * Folder persistence. Every structural rule lives in `@/lib/tree`, so this
 * module only has to load data, validate, and write it back in one
 * transaction.
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

  return db.transaction('rw', db.folders, async () => {
    const folders = await db.folders.toArray();
    if (parentId && !folders.some((folder) => folder.id === parentId)) {
      return { ok: false, reason: 'invalid', message: 'The parent folder no longer exists.' } as const;
    }
    const existing = folders.find(
      (folder) => folder.parentId === parentId && folder.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) return { ok: false, reason: 'duplicate', existing } as const;

    const now = Date.now();
    const folder: Folder = {
      id: newId(),
      parentId,
      name,
      createdAt: now,
      updatedAt: now,
      sortOrder: nextSortOrder(folders, parentId),
      isFavorite: false,
      isLocked: false,
    };
    if (input.icon) folder.icon = input.icon;
    await db.folders.add(folder);
    return { ok: true, folder } as const;
  });
}

export async function renameFolder(id: string, rawName: string): Promise<Folder | null> {
  const name = sanitizeFolderName(rawName);
  if (name.length === 0) return null;
  return db.transaction('rw', db.folders, async () => {
    const folder = await db.folders.get(id);
    if (!folder) return null;
    const folders = await db.folders.toArray();
    if (hasSiblingWithName(folders, folder.parentId, name, id)) return null;
    const updated: Folder = { ...folder, name, updatedAt: Date.now() };
    await db.folders.put(updated);
    return updated;
  });
}

export type MoveResult = { ok: true; folder: Folder } | { ok: false; reason: string };

export async function moveFolder(id: string, targetParentId: string | null): Promise<MoveResult> {
  return db.transaction('rw', db.folders, async () => {
    const folders = await db.folders.toArray();
    const folder = folders.find((candidate) => candidate.id === id);
    if (!folder) return { ok: false, reason: 'That folder no longer exists.' } as const;

    const check = canMoveFolder(folders, id, targetParentId);
    if (!check.ok) return { ok: false, reason: check.reason } as const;

    if (targetParentId && hasSiblingWithName(folders, targetParentId, folder.name, id)) {
      return { ok: false, reason: 'A folder with that name already exists there.' } as const;
    }

    const updated: Folder = {
      ...folder,
      parentId: targetParentId,
      sortOrder: nextSortOrder(folders, targetParentId),
      updatedAt: Date.now(),
    };
    await db.folders.put(updated);
    return { ok: true, folder: updated } as const;
  });
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

export async function setFolderLocked(id: string, isLocked: boolean): Promise<void> {
  await db.folders.update(id, { isLocked, updatedAt: Date.now() });
}

export async function setFolderIcon(id: string, icon: string | undefined): Promise<void> {
  await db.transaction('rw', db.folders, async () => {
    const folder = await db.folders.get(id);
    if (!folder) return;
    const updated: Folder = { ...folder, updatedAt: Date.now() };
    if (icon) updated.icon = icon;
    else delete updated.icon;
    await db.folders.put(updated);
  });
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
  return db.transaction('rw', db.folders, db.links, async () => {
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
}

/** Stable ordering rank of a doomed descendant, used when flattening upward. */
function descendantOrderRank(doomed: readonly string[], candidate: Folder): number {
  const index = doomed.indexOf(candidate.id);
  return index < 0 ? -1 : index;
}

export interface FolderStats {
  /** Direct, non-archived links. */
  directLinks: number;
  /** Non-archived links anywhere below this folder. */
  nestedLinks: number;
  directChildren: number;
}

export async function getFolderStats(): Promise<Map<string, FolderStats>> {
  const [folders, links] = await Promise.all([db.folders.toArray(), db.links.toArray()]);
  const stats = new Map<string, FolderStats>();
  for (const folder of folders) {
    stats.set(folder.id, { directLinks: 0, nestedLinks: 0, directChildren: 0 });
  }
  for (const folder of folders) {
    if (folder.parentId) {
      const parentStats = stats.get(folder.parentId);
      if (parentStats) parentStats.directChildren += 1;
    }
  }
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  for (const link of links) {
    if (link.isArchived || !link.folderId) continue;
    const own = stats.get(link.folderId);
    if (own) own.directLinks += 1;

    // Walk up the chain so nested counts are correct at every ancestor.
    const guard = new Set<string>();
    let current = parentOf.get(link.folderId) ?? null;
    while (current && !guard.has(current)) {
      guard.add(current);
      const ancestor = stats.get(current);
      if (ancestor) ancestor.nestedLinks += 1;
      current = parentOf.get(current) ?? null;
    }
  }
  return stats;
}
