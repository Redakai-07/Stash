import type { Folder, LinkTag, Note, NoteLink, SavedLink, Tag } from '@/db/types';
import type { VaultSnapshot } from '@/lib/search';
import type { BackupData, PortableSettings } from './format';

/**
 * Planning an import before performing one.
 *
 * The plan is a pure value: given a validated backup and what is currently in
 * the database, it says exactly which rows would be written, which would be left
 * alone, and what would be dropped. Nothing here touches IndexedDB, so the
 * consequences of a restore can be shown, tested, and explained *before* any
 * destructive step is taken — which is the only way a confirmation dialog can be
 * honest.
 *
 * ## Merge
 *
 * Merge is offered because restoring a backup into a vault that already has
 * something in it is a real situation, but it is implemented in the one way that
 * cannot corrupt anything: **an id that already exists is left exactly as it
 * is.** That single rule gives every guarantee that matters:
 *
 *  - no duplicate ids, ever — a collision means the row is not written;
 *  - no broken references — a skipped parent is still a parent, so a child that
 *    arrives attaches to the copy already here;
 *  - no duplicated hierarchies — and importing the same file twice is a no-op
 *    rather than an explosion of copies;
 *  - no half-updated records — an existing row is never partially overwritten.
 *
 * The cost, which the UI states plainly, is that merge adds what is missing and
 * changes nothing that is already present. It is not a sync, and pretending
 * otherwise would require either last-write-wins (silent data loss) or a
 * per-field merge (which cannot be done without knowing intent).
 *
 * ## Replace
 *
 * Replace writes exactly what is in the backup and nothing else. It is the only
 * mode that reproduces the original vault exactly, which is why it is the mode
 * for "my phone died, put my data back".
 */

export type ImportMode = 'merge' | 'replace';

export interface ExistingIndex {
  folderIds: ReadonlySet<string>;
  linkIds: ReadonlySet<string>;
  noteIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  linkTagKeys: ReadonlySet<string>;
  noteLinkKeys: ReadonlySet<string>;
  /** True when there is no user content at all, so a merge can act like a restore. */
  isEmpty: boolean;
}

const JOIN_SEPARATOR = '\u0000';

export function joinKey(a: string, b: string): string {
  return `${a}${JOIN_SEPARATOR}${b}`;
}

export function indexExisting(snapshot: VaultSnapshot): ExistingIndex {
  const isEmpty =
    snapshot.folders.length === 0 &&
    snapshot.links.length === 0 &&
    snapshot.notes.length === 0 &&
    snapshot.tags.length === 0;
  return {
    folderIds: new Set(snapshot.folders.map((row) => row.id)),
    linkIds: new Set(snapshot.links.map((row) => row.id)),
    noteIds: new Set(snapshot.notes.map((row) => row.id)),
    tagIds: new Set(snapshot.tags.map((row) => row.id)),
    linkTagKeys: new Set(snapshot.linkTags.map((row) => joinKey(row.linkId, row.tagId))),
    noteLinkKeys: new Set(snapshot.noteLinks.map((row) => joinKey(row.noteId, row.linkId))),
    isEmpty,
  };
}

export interface ImportCounts {
  folders: number;
  links: number;
  tags: number;
  notes: number;
  linkTags: number;
  noteLinks: number;
}

export interface ImportPlan {
  mode: ImportMode;
  folders: Folder[];
  links: SavedLink[];
  tags: Tag[];
  notes: Note[];
  linkTags: LinkTag[];
  noteLinks: NoteLink[];
  /** Settings to apply, or `null` to keep this device's own. */
  settings: PortableSettings | null;
  counts: ImportCounts;
  /** Rows the backup offered but merge deliberately left untouched. */
  skipped: { folders: number; links: number; notes: number; tags: number };
  /**
   * Whether the backup's keyring should replace the device's.
   *
   * `keep` when this device already has one and nothing is being cleared — the
   * local keyring is what unseals everything already here. `adopt` when the
   * backup brings a keyring *and* either the device has none or everything local
   * is about to be cleared, in which case the backup's key is the only one that
   * can open the rows arriving with it.
   */
  keyring: 'keep' | 'adopt';
  /**
   * True when adopting will replace a keyring this device already has. The
   * current passcode stops working at that point, which the user must be told
   * before, not after.
   */
  replacesKeyring: boolean;
  /** Things the user should know about what this plan will and will not do. */
  messages: string[];
}

/**
 * Decide what an import would do.
 *
 * `hasKeyring` and `canInstallKeyring` come from the caller rather than being
 * read here, so this stays a pure function and the same plan can be computed in
 * a test with no database at all.
 */
export function planImport(input: {
  data: BackupData;
  existing: ExistingIndex;
  mode: ImportMode;
  /** Whether the backup carries a usable passcode-wrapped keyring. */
  backupHasKeyring: boolean;
  /** Whether this device already has a keyring. */
  deviceHasKeyring: boolean;
}): ImportPlan {
  const { data, existing, mode } = input;
  const messages: string[] = [];

  const keepRows = <T extends { id: string }>(rows: readonly T[], known: ReadonlySet<string>) => {
    const fresh: T[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (mode === 'replace' || !known.has(row.id)) fresh.push(row);
      else skipped += 1;
    }
    return { fresh, skipped };
  };

  const folders = keepRows(data.folders, existing.folderIds);
  const links = keepRows(data.links, existing.linkIds);
  const notesRows = keepRows(data.notes, existing.noteIds);
  const tags = keepRows(data.tags, existing.tagIds);

  // Join rows are resolved against the union of what stays and what arrives, so
  // a pair whose other half is being kept still links up correctly.
  const knownFolders = mode === 'replace' ? new Set(folders.fresh.map((row) => row.id)) : union(existing.folderIds, folders.fresh);
  const knownLinks = mode === 'replace' ? new Set(links.fresh.map((row) => row.id)) : union(existing.linkIds, links.fresh);
  const knownNotes = mode === 'replace' ? new Set(notesRows.fresh.map((row) => row.id)) : union(existing.noteIds, notesRows.fresh);
  const knownTags = mode === 'replace' ? new Set(tags.fresh.map((row) => row.id)) : union(existing.tagIds, tags.fresh);

  const linkTags = data.linkTags.filter((row) => {
    if (!knownLinks.has(row.linkId) || !knownTags.has(row.tagId)) return false;
    return mode === 'replace' || !existing.linkTagKeys.has(joinKey(row.linkId, row.tagId));
  });

  const noteLinks = data.noteLinks.filter((row) => {
    if (!knownNotes.has(row.noteId) || !knownLinks.has(row.linkId)) return false;
    return mode === 'replace' || !existing.noteLinkKeys.has(joinKey(row.noteId, row.linkId));
  });

  // --- Settings ----------------------------------------------------------
  // Replace restores preferences, because it restores the vault. Merge keeps the
  // device's own preferences unless there is nothing here to preserve — a
  // merge should not silently retheme an app the user is already using.
  let settings: PortableSettings | null = data.settings;
  if (mode === 'merge') {
    if (!existing.isEmpty) {
      settings = null;
      if (hasNonDefaultSettings(data.settings)) {
        messages.push('Your current preferences are kept; the backup’s preferences were not applied.');
      }
    }
  }

  // Remembered capture destinations must point at real folders after the import,
  // or the Save sheet would offer a destination that no longer exists.
  if (settings) {
    const recents = settings.recentFolderIds.filter((id) => knownFolders.has(id));
    const lastFolderId = settings.lastFolderId && knownFolders.has(settings.lastFolderId) ? settings.lastFolderId : null;
    settings = { ...settings, recentFolderIds: recents, lastFolderId };
  }

  // --- Keyring -----------------------------------------------------------
  const keyring: 'keep' | 'adopt' = input.backupHasKeyring && (!input.deviceHasKeyring || mode === 'replace') ? 'adopt' : 'keep';
  const replacesKeyring = keyring === 'adopt' && input.deviceHasKeyring;

  if (keyring === 'keep' && input.deviceHasKeyring && input.backupHasKeyring && mode === 'merge') {
    messages.push(
      'This backup carries its own key. Your existing key is kept, so locked items from the backup stay locked unless the keys match.',
    );
  }

  const counts: ImportCounts = {
    folders: folders.fresh.length,
    links: links.fresh.length,
    tags: tags.fresh.length,
    notes: notesRows.fresh.length,
    linkTags: linkTags.length,
    noteLinks: noteLinks.length,
  };

  if (mode === 'merge') {
    const skippedTotal = folders.skipped + links.skipped + notesRows.skipped + tags.skipped;
    if (skippedTotal > 0) {
      messages.push(
        `${skippedTotal} item(s) in this backup already exist here and were left untouched — merge never overwrites.`,
      );
    }
  }

  return {
    mode,
    folders: folders.fresh,
    links: links.fresh,
    tags: tags.fresh,
    notes: notesRows.fresh,
    linkTags,
    noteLinks,
    settings,
    counts,
    skipped: {
      folders: folders.skipped,
      links: links.skipped,
      notes: notesRows.skipped,
      tags: tags.skipped,
    },
    keyring,
    replacesKeyring,
    messages,
  };
}

function union<T extends { id: string }>(existing: ReadonlySet<string>, rows: readonly T[]): Set<string> {
  const next = new Set(existing);
  for (const row of rows) next.add(row.id);
  return next;
}

function hasNonDefaultSettings(settings: PortableSettings): boolean {
  return (
    settings.themeMode !== 'system' ||
    settings.relockPolicy !== 'immediate' ||
    settings.lockApp !== true ||
    settings.secureScreen !== false ||
    settings.biometric !== true ||
    settings.lastFolderId !== null ||
    settings.recentFolderIds.length > 0
  );
}

export function planTotal(plan: ImportPlan): number {
  const counts = plan.counts;
  return counts.folders + counts.links + counts.tags + counts.notes + counts.linkTags + counts.noteLinks;
}

/** A one-line description of what a plan will write, for the confirmation. */
export function describePlan(plan: ImportPlan): string {
  const parts: string[] = [];
  if (plan.counts.folders) parts.push(`${plan.counts.folders} folder(s)`);
  if (plan.counts.links) parts.push(`${plan.counts.links} link(s)`);
  if (plan.counts.notes) parts.push(`${plan.counts.notes} note(s)`);
  if (plan.counts.tags) parts.push(`${plan.counts.tags} tag(s)`);
  if (parts.length === 0) return 'Nothing to write.';
  return parts.join(', ');
}
