import { newId } from './id';
import { db, META_KEYS, type Folder } from './index';
import { getMeta, setMeta } from './repos/settings';

/**
 * First-run seeding.
 *
 * Runs exactly once, guarded by a meta flag, and only ever *adds* folders. It
 * is deliberately tiny: an empty vault is intimidating when the whole point is
 * to file something away in two taps, but a pre-built taxonomy is worse. Four
 * obvious starting points, renameable and deletable like any other folder.
 */
const STARTER_FOLDERS: ReadonlyArray<{ name: string; icon: string }> = [
  { name: 'Development', icon: 'code' },
  { name: 'Learning', icon: 'graduation-cap' },
  { name: 'Entertainment', icon: 'clapperboard' },
  { name: 'Reading', icon: 'book-open' },
];

export async function ensureSeeded(): Promise<boolean> {
  const seeded = await getMeta<boolean>(META_KEYS.seeded, false);
  if (seeded) return false;

  return db.transaction('rw', db.folders, db.meta, async () => {
    // Re-check inside the transaction so a double boot cannot seed twice.
    const row = await db.meta.get(META_KEYS.seeded);
    if (row?.value) return false;

    const existingCount = await db.folders.count();
    if (existingCount === 0) {
      const now = Date.now();
      const folders: Folder[] = STARTER_FOLDERS.map((starter, index) => ({
        id: newId(),
        parentId: null,
        name: starter.name,
        icon: starter.icon,
        createdAt: now,
        updatedAt: now,
        sortOrder: index,
        isFavorite: false,
        isLocked: false,
      }));
      await db.folders.bulkAdd(folders);
    }

    await setMeta(META_KEYS.seeded, true);
    return true;
  });
}

export { STARTER_FOLDERS };
