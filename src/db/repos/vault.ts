import {
  db,
  eraseDatabase,
  type ExportBundle,
  type Folder,
  type LinkTag,
  type Note,
  type NoteLink,
  type SavedLink,
  type Tag,
} from '../index';
import type { VaultSnapshot } from '@/lib/search';
import { normalizeUrl } from '@/lib/url/normalize';
import { domainOf } from '@/lib/url/extract';
import { deriveNoteTitle, sanitizeNoteTitle } from '@/lib/notes';

/**
 * Whole-vault operations: reading a consistent snapshot, exporting to a file
 * the user owns, importing it back, and erasing everything.
 */

/** One consistent read of everything the UI needs. */
export async function getSnapshot(): Promise<VaultSnapshot> {
  // Dexie's positional form is limited to five tables, so the array form is used
  // once a transaction spans the whole vault.
  return db.transaction('r', [db.folders, db.links, db.tags, db.linkTags, db.notes, db.noteLinks], async () => {
    const [folders, links, tags, linkTags, notes, noteLinks] = await Promise.all([
      db.folders.toArray(),
      db.links.toArray(),
      db.tags.toArray(),
      db.linkTags.toArray(),
      db.notes.toArray(),
      db.noteLinks.toArray(),
    ]);
    return { folders, links, tags, linkTags, notes, noteLinks };
  });
}

export async function exportVault(): Promise<ExportBundle> {
  const snapshot = await getSnapshot();
  const meta = await db.meta.toArray();
  return {
    format: 'stash-export',
    // Version 2 adds notes and note references. Version 1 files still import.
    version: 2,
    exportedAt: Date.now(),
    folders: snapshot.folders,
    links: snapshot.links,
    tags: snapshot.tags,
    linkTags: snapshot.linkTags,
    notes: snapshot.notes,
    noteLinks: snapshot.noteLinks,
    // Schema bookkeeping is rebuilt on the destination device.
    meta: meta.filter((row) => row.key !== 'db.schemaInfo' && row.key !== 'db.seeded'),
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  ok: boolean;
  message?: string;
  foldersImported: number;
  linksImported: number;
  notesImported: number;
  foldersSkipped: number;
  linksSkipped: number;
  notesSkipped: number;
}

export function isValidBundle(value: unknown): value is ExportBundle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExportBundle>;
  return (
    candidate.format === 'stash-export' &&
    Array.isArray(candidate.folders) &&
    Array.isArray(candidate.links)
  );
}

/**
 * Import a previously exported bundle.
 *
 * `merge` keeps what is already there and skips items whose ids already exist,
 * which makes importing the same file twice a no-op rather than a duplication
 * event. `replace` wipes the vault first and should only be reachable behind an
 * explicit confirmation.
 */
export async function importVault(bundle: ExportBundle, mode: ImportMode): Promise<ImportResult> {
  const result: ImportResult = {
    ok: false,
    foldersImported: 0,
    linksImported: 0,
    notesImported: 0,
    foldersSkipped: 0,
    linksSkipped: 0,
    notesSkipped: 0,
  };

  try {
    await db.transaction(
      'rw',
      [db.folders, db.links, db.tags, db.linkTags, db.notes, db.noteLinks, db.meta],
      async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.links.clear(),
          db.linkTags.clear(),
          db.folders.clear(),
          db.tags.clear(),
          db.noteLinks.clear(),
          db.notes.clear(),
        ]);
      }

      const existingFolderIds = new Set((await db.folders.toArray()).map((folder) => folder.id));
      const existingLinkIds = new Set((await db.links.toArray()).map((link) => link.id));

      const foldersToAdd: Folder[] = [];
      const incomingFolders = bundle.folders.filter(isFolderish);
      for (const folder of incomingFolders) {
        if (existingFolderIds.has(folder.id)) {
          result.foldersSkipped += 1;
          continue;
        }
        foldersToAdd.push(normalizeFolder(folder));
        existingFolderIds.add(folder.id);
      }
      if (foldersToAdd.length > 0) await db.folders.bulkPut(foldersToAdd);
      result.foldersImported = foldersToAdd.length;

      const knownFolderIds = new Set((await db.folders.toArray()).map((folder) => folder.id));
      const linksToAdd: SavedLink[] = [];
      const incomingLinks = bundle.links.filter(isLinkish);
      for (const link of incomingLinks) {
        if (existingLinkIds.has(link.id)) {
          result.linksSkipped += 1;
          continue;
        }
        linksToAdd.push(normalizeLink(link, knownFolderIds));
        existingLinkIds.add(link.id);
      }
      if (linksToAdd.length > 0) await db.links.bulkPut(linksToAdd);
      result.linksImported = linksToAdd.length;

      if (Array.isArray(bundle.tags) && bundle.tags.length > 0) {
        const known = new Set((await db.tags.toArray()).map((tag) => tag.id));
        const tagsToAdd = bundle.tags.filter((tag) => isTagish(tag) && !known.has(tag.id));
        if (tagsToAdd.length > 0) await db.tags.bulkPut(tagsToAdd.map((tag) => ({ id: tag.id, name: String(tag.name) })));
      }

      if (Array.isArray(bundle.linkTags) && bundle.linkTags.length > 0) {
        const validLinks = new Set((await db.links.toArray()).map((link) => link.id));
        const validTags = new Set((await db.tags.toArray()).map((tag) => tag.id));
        const linkTags = bundle.linkTags.filter(
          (linkTag): linkTag is LinkTag =>
            isLinkTagish(linkTag) && validLinks.has(linkTag.linkId) && validTags.has(linkTag.tagId),
        );
        if (linkTags.length > 0) await db.linkTags.bulkPut(linkTags);
      }

      // ---- Notes ---------------------------------------------------------
      // Same merge contract as folders: ids already present are skipped, so
      // re-importing a file never duplicates a note. A version 1 bundle simply
      // has no `notes` array and this block does nothing.
      const existingNoteIds = new Set((await db.notes.toArray()).map((note) => note.id));
      const incomingNotes = (bundle.notes ?? []).filter(isNotish);
      // Parent links are validated against the union of what is already here and
      // what is arriving, so a child is not orphaned just because its parent
      // happened to be listed later in the file.
      const resolvableNoteIds = new Set(existingNoteIds);
      for (const note of incomingNotes) resolvableNoteIds.add(note.id);

      const notesToAdd: Note[] = [];
      for (const note of incomingNotes) {
        if (existingNoteIds.has(note.id)) {
          result.notesSkipped += 1;
          continue;
        }
        notesToAdd.push(normalizeNote(note, resolvableNoteIds));
        existingNoteIds.add(note.id);
      }
      if (notesToAdd.length > 0) await db.notes.bulkPut(notesToAdd);
      result.notesImported = notesToAdd.length;

      const knownNoteIds = new Set((await db.notes.toArray()).map((note) => note.id));
      const knownLinkIds = new Set((await db.links.toArray()).map((link) => link.id));
      const noteLinks = (bundle.noteLinks ?? []).filter(
        (row): row is NoteLink =>
          isNoteLinkish(row) && knownNoteIds.has(row.noteId) && knownLinkIds.has(row.linkId),
      );
      if (noteLinks.length > 0) await db.noteLinks.bulkPut(noteLinks);

      if (Array.isArray(bundle.meta)) {
        const rows = bundle.meta.filter(
          (row) => row && typeof row.key === 'string' && row.key !== 'db.schemaInfo' && row.key !== 'db.seeded',
        );
        if (rows.length > 0) await db.meta.bulkPut(rows);
      }
      },
    );

    result.ok = true;
    return result;
  } catch (error) {
    result.ok = false;
    result.message = error instanceof Error ? error.message : 'Import failed.';
    return result;
  }
}

function isFolderish(value: unknown): value is Folder {
  if (!value || typeof value !== 'object') return false;
  const folder = value as Partial<Folder>;
  return typeof folder.id === 'string' && typeof folder.name === 'string';
}

function isLinkish(value: unknown): value is SavedLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<SavedLink>;
  return typeof link.id === 'string' && typeof link.url === 'string';
}

function isTagish(value: unknown): value is Tag {
  if (!value || typeof value !== 'object') return false;
  const tag = value as Partial<Tag>;
  return typeof tag.id === 'string' && typeof tag.name === 'string';
}

function isLinkTagish(value: unknown): value is LinkTag {
  if (!value || typeof value !== 'object') return false;
  const linkTag = value as Partial<LinkTag>;
  return typeof linkTag.linkId === 'string' && typeof linkTag.tagId === 'string';
}

function isNotish(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<Note>;
  return typeof note.id === 'string' && typeof note.title === 'string';
}

function isNoteLinkish(value: unknown): value is NoteLink {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<NoteLink>;
  return typeof row.noteId === 'string' && typeof row.linkId === 'string';
}

/**
 * Coerce an incoming note into a valid row.
 *
 * A note whose parent is missing from both the file and the vault is promoted to
 * a root note: silently dropping it would be data loss, and pointing at a
 * non-existent parent would make it unreachable.
 */
function normalizeNote(note: Note, resolvableNoteIds: ReadonlySet<string>): Note {
  const now = Date.now();
  const content = typeof note.content === 'string' ? note.content : '';
  const title = sanitizeNoteTitle(note.title ?? '');
  return {
    id: note.id,
    parentNoteId:
      typeof note.parentNoteId === 'string' && resolvableNoteIds.has(note.parentNoteId)
        ? note.parentNoteId
        : null,
    title: title.length > 0 ? title : deriveNoteTitle(content),
    content,
    createdAt: typeof note.createdAt === 'number' ? note.createdAt : now,
    updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : now,
    sortOrder: typeof note.sortOrder === 'number' ? note.sortOrder : 0,
    isFavorite: Boolean(note.isFavorite),
    isArchived: Boolean(note.isArchived),
    isLocked: Boolean(note.isLocked),
  };
}

function normalizeFolder(folder: Folder): Folder {
  const now = Date.now();
  const record: Folder = {
    id: folder.id,
    parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
    name: String(folder.name).slice(0, 80),
    createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : now,
    updatedAt: typeof folder.updatedAt === 'number' ? folder.updatedAt : now,
    sortOrder: typeof folder.sortOrder === 'number' ? folder.sortOrder : 0,
    isFavorite: Boolean(folder.isFavorite),
    isLocked: Boolean(folder.isLocked),
  };
  if (folder.icon) record.icon = String(folder.icon);
  return record;
}

function normalizeLink(link: SavedLink, knownFolderIds: Set<string>): SavedLink {
  const now = Date.now();
  const record: SavedLink = {
    id: link.id,
    folderId: typeof link.folderId === 'string' && knownFolderIds.has(link.folderId) ? link.folderId : null,
    url: String(link.url),
    normalizedUrl: normalizeUrl(link.url) ?? link.normalizedUrl ?? String(link.url),
    createdAt: typeof link.createdAt === 'number' ? link.createdAt : now,
    updatedAt: typeof link.updatedAt === 'number' ? link.updatedAt : now,
    isFavorite: Boolean(link.isFavorite),
    isArchived: Boolean(link.isArchived),
  };
  if (link.title) record.title = String(link.title);
  if (link.description) record.description = String(link.description);
  if (link.userNote) record.userNote = String(link.userNote);
  record.source = link.source ? String(link.source) : domainOf(link.url);
  if (link.sourcePackage) record.sourcePackage = String(link.sourcePackage);
  if (link.rawText) record.rawText = String(link.rawText);
  if (typeof link.lastOpenedAt === 'number') record.lastOpenedAt = link.lastOpenedAt;
  return record;
}

/** Irreversible. Only reachable behind an explicit typed confirmation. */
export async function eraseVault(): Promise<void> {
  await eraseDatabase();
}

/** Stable file name for exports, e.g. `stash-2026-09-26.json`. */
export function exportFileName(at = new Date()): string {
  const iso = at.toISOString().slice(0, 10);
  return `stash-${iso}.json`;
}
