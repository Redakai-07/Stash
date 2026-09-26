import Dexie, { type Table } from 'dexie';
import { normalizeUrl } from '@/lib/url/normalize';
import {
  META_KEYS,
  type Folder,
  type LinkTag,
  type MetaRow,
  type Note,
  type NoteLink,
  type SavedLink,
  type Tag,
} from './types';

export * from './types';

/**
 * The single source of truth for user data.
 *
 * Guarantees that matter for the product:
 *  - Data lives in IndexedDB, which survives app close, force stop, restart,
 *    offline use and a normal Android app update.
 *  - The schema is versioned. Upgrades run explicit migrations, and nothing in
 *    the boot path ever drops a table, so an update can never silently wipe a
 *    vault.
 *  - Only the user's explicit "Erase vault" action (or clearing app data /
 *    uninstalling) removes data.
 */
class StashDatabase extends Dexie {
  folders!: Table<Folder, string>;
  links!: Table<SavedLink, string>;
  tags!: Table<Tag, string>;
  linkTags!: Table<LinkTag, [string, string]>;
  notes!: Table<Note, string>;
  noteLinks!: Table<NoteLink, [string, string]>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'stash') {
    super(name);

    // ---- Version 1: initial vault -------------------------------------------------
    // Only indexable values appear here. IndexedDB keys may be numbers, strings,
    // dates, binaries or arrays -- booleans are skipped silently, so flag-based
    // lookups (`isFavorite`) are done with filters rather than fake indexes.
    this.version(1).stores({
      folders: 'id, parentId, name, sortOrder, updatedAt',
      links: 'id, folderId, normalizedUrl, createdAt, updatedAt, lastOpenedAt',
      tags: 'id, &name',
      linkTags: '[linkId+tagId], linkId, tagId',
      meta: 'key',
    });

    // ---- Version 2: index tuning + defensive backfill ------------------------------
    // Adds the compound indexes the hot paths actually use: ordering a folder's
    // children, and listing a folder newest-first. Also backfills `normalizedUrl`
    // for rows written before normalization existed. Additive only -- no drop,
    // no re-create, no data loss.
    this.version(2)
      .stores({
        folders: 'id, parentId, name, sortOrder, updatedAt, [parentId+sortOrder]',
        links:
          'id, folderId, normalizedUrl, createdAt, updatedAt, lastOpenedAt, [folderId+createdAt]',
        tags: 'id, &name',
        linkTags: '[linkId+tagId], linkId, tagId',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        const links = transaction.table<SavedLink, string>('links');
        await links.toCollection().modify((link) => {
          if (!link.normalizedUrl) {
            link.normalizedUrl = normalizeUrl(link.url) ?? link.url;
          }
          if (typeof link.isArchived !== 'boolean') link.isArchived = false;
          if (typeof link.isFavorite !== 'boolean') link.isFavorite = false;
        });
        await transaction.table<MetaRow, string>('meta').put({
          key: META_KEYS.schemaInfo,
          value: { version: 2, migratedAt: Date.now() },
        });
      });

    // ---- Version 3: hierarchical notes ---------------------------------------------
    // Purely additive. Two new tables appear and not a single existing row is
    // read, rewritten, or deleted, so installing this over an existing vault
    // cannot cost the user a link or a folder.
    this.version(3)
      .stores({
        folders: 'id, parentId, name, sortOrder, updatedAt, [parentId+sortOrder]',
        links:
          'id, folderId, normalizedUrl, createdAt, updatedAt, lastOpenedAt, [folderId+createdAt]',
        tags: 'id, &name',
        linkTags: '[linkId+tagId], linkId, tagId',
        notes: 'id, parentNoteId, title, sortOrder, createdAt, updatedAt, [parentNoteId+sortOrder]',
        // Compound keys are the primary key here: a note references a link at
        // most once, and both directions of the relationship stay indexed.
        noteLinks: '[noteId+linkId], noteId, linkId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        // Defensive backfill for rows written by an early build of the note
        // editor. Touches nothing if the tables are empty, which is the normal
        // case when upgrading from a links-only vault.
        const notes = transaction.table<Note, string>('notes');
        await notes.toCollection().modify((note) => {
          if (typeof note.content !== 'string') note.content = '';
          if (typeof note.sortOrder !== 'number') note.sortOrder = 0;
          if (typeof note.isFavorite !== 'boolean') note.isFavorite = false;
          if (typeof note.isArchived !== 'boolean') note.isArchived = false;
          if (typeof note.isLocked !== 'boolean') note.isLocked = false;
          if (note.parentNoteId === undefined) note.parentNoteId = null;
        });
        await transaction.table<MetaRow, string>('meta').put({
          key: META_KEYS.schemaInfo,
          value: { version: 3, migratedAt: Date.now() },
        });
      });

    // A newer build (or another tab) upgraded the schema: close so the other
    // context can proceed instead of us writing through a stale schema.
    this.on('versionchange', () => {
      this.close();
    });
  }
}

export const db = new StashDatabase();

/**
 * Opens the database and applies pending migrations. Called once during boot.
 * Resolves to `true` when the vault is reachable.
 */
export async function openDatabase(): Promise<boolean> {
  try {
    await db.open();
    return true;
  } catch (error) {
    console.error('[stash] failed to open IndexedDB', error);
    return false;
  }
}

export function isDatabaseOpen(): boolean {
  return db.isOpen();
}

/** Irreversible: only ever called from the explicit "Erase vault" action. */
export async function eraseDatabase(): Promise<void> {
  db.close();
  await Dexie.delete(db.name);
  await db.open();
}

export { StashDatabase };
