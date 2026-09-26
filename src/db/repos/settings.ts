import { db, META_KEYS, type MetaRow } from '../index';

/**
 * Small key-value store for preferences and capture history.
 *
 * Kept inside the same IndexedDB as the vault so there is no second place user
 * state can hide, and so export/import carries preferences along with data.
 */

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  if (!row) return fallback;
  return row.value as T;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const row: MetaRow = { key, value };
  await db.meta.put(row);
}

/** How many capture destinations we remember for the fast path. */
export const RECENT_DESTINATION_LIMIT = 5;

export async function getRecentFolderIds(): Promise<string[]> {
  const ids = await getMeta<string[]>(META_KEYS.recentFolders, []);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}

/**
 * Move-to-front list of recently used destinations. This is what makes repeat
 * captures a single tap instead of a folder hunt.
 */
export async function pushRecentFolder(folderId: string): Promise<string[]> {
  const current = await getRecentFolderIds();
  const next = [folderId, ...current.filter((id) => id !== folderId)].slice(0, RECENT_DESTINATION_LIMIT);
  await setMeta(META_KEYS.recentFolders, next);
  return next;
}

export async function getLastFolderId(): Promise<string | null> {
  const value = await getMeta<string | null>(META_KEYS.lastFolderId, null);
  return typeof value === 'string' ? value : null;
}

export async function setLastFolderId(folderId: string | null): Promise<void> {
  await setMeta(META_KEYS.lastFolderId, folderId);
}

export type ThemeMode = 'light' | 'dark' | 'system';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export async function getThemeMode(): Promise<ThemeMode> {
  const value = await getMeta<ThemeMode>(META_KEYS.themeMode, 'system');
  return isThemeMode(value) ? value : 'system';
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await setMeta(META_KEYS.themeMode, mode);
}

/**
 * Drop remembered destinations that point at folders which no longer exist.
 * Without this, deleting a folder could leave a dead shortcut in the Save Sheet.
 */
export async function pruneRecentFolders(): Promise<string[]> {
  const ids = await getRecentFolderIds();
  if (ids.length === 0) return [];
  const existing = new Set((await db.folders.toArray()).map((folder) => folder.id));
  const pruned = ids.filter((id) => existing.has(id));
  if (pruned.length !== ids.length) await setMeta(META_KEYS.recentFolders, pruned);
  return pruned;
}
