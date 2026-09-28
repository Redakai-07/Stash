import type { Folder, LinkTag, Note, NoteLink, SavedLink, Tag } from '@/db/types';
import { isEncryptedPayload } from '@/lib/privacy/crypto';
import { deriveNoteTitle, sanitizeNoteTitle } from '@/lib/notes';
import { domainOf } from '@/lib/url/extract';
import { normalizeUrl } from '@/lib/url/normalize';

/**
 * Reading rows out of an untrusted document.
 *
 * The dividing line, stated once and applied everywhere below:
 *
 *  - A row that cannot be *understood* — not an object, no usable id, a link with
 *    no address and no ciphertext, a malformed `enc` payload — is **corruption**.
 *    It fails the whole import. Quietly dropping such a row would be data loss
 *    presented as a successful restore, which is the worst outcome the feature
 *    can produce.
 *  - A row that can be understood but is missing a *defaultable* field gets the
 *    default, and the repair is counted and reported. `isFavorite: undefined` is
 *    not a reason to refuse someone's backup.
 *
 * Nothing here reads from or writes to a database, so every rule is testable on
 * plain objects and identical whether the file came from a phone, a desktop or a
 * hand-edited JSON document.
 */

export interface ReadCollector {
  /** Fatal problems. Any entry here makes the whole document invalid. */
  errors: string[];
  /** Fields that were missing or the wrong type and were defaulted. */
  coerced: number;
  /** `label:id` of rows that could not be understood at all. */
  corrupt: string[];
}

export function createCollector(): ReadCollector {
  return { errors: [], coerced: 0, corrupt: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Row {
  constructor(private readonly collector: ReadCollector) {}

  /** A required string. */
  text(source: Record<string, unknown>, key: string, label: string, options: { allowEmpty?: boolean } = {}): string {
    const value = source[key];
    if (typeof value !== 'string') {
      if (value === undefined) this.fail(`${label}: "${key}" is required.`);
      else this.fail(`${label}: "${key}" must be text.`);
      return '';
    }
    if (!options.allowEmpty && value.length === 0) {
      this.fail(`${label}: "${key}" is empty.`);
    }
    return value;
  }

  /** A required string that must look like an identifier. */
  id(source: Record<string, unknown>, label: string): string {
    const value = source.id;
    if (typeof value !== 'string' || value.length === 0) {
      this.fail(`${label}: missing or invalid "id".`);
      return '';
    }
    return value;
  }

  optionalText(source: Record<string, unknown>, key: string): string | undefined {
    const value = source[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      this.collector.coerced += 1;
      return undefined;
    }
    return value.length > 0 ? value : undefined;
  }

  /** A nullable parent reference. A non-string collapses to `null` and is reported. */
  parentRef(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.length > 0) return value;
    this.collector.coerced += 1;
    return null;
  }

  flag(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (value !== undefined) this.collector.coerced += 1;
    return fallback;
  }

  count(source: Record<string, unknown>, key: string, fallback: number): number {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value !== undefined) this.collector.coerced += 1;
    return fallback;
  }

  optionalCount(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value !== undefined) this.collector.coerced += 1;
    return undefined;
  }

  private fail(message: string): void {
    this.collector.errors.push(message);
  }
}

/** A ciphertext field, when present, must be a well-formed payload. */
function readPayload(
  source: Record<string, unknown>,
  collector: ReadCollector,
  label: string,
): SavedLink['enc'] {
  const value = source.enc;
  if (value === undefined || value === null) return undefined;
  if (!isEncryptedPayload(value)) {
    // Unrecoverable: the row claims to be sealed but there is nothing usable to
    // decrypt, so the item's real content is gone. Fatal, not defaultable.
    collector.corrupt.push(`${label}: malformed ciphertext`);
    collector.errors.push(`${label}: the encrypted payload is malformed.`);
    return undefined;
  }
  return value;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Read a collection.
 *
 * A non-array where an array belongs is treated as "absent" only for the
 * optional collections of an older file; for the three collections every version
 * has, a wrong type is corruption.
 */
export function readCollection(
  value: unknown,
  label: string,
  collector: ReadCollector,
  options: { required?: boolean } = {},
): unknown[] {
  if (value === undefined || value === null) {
    if (options.required) collector.errors.push(`This backup has no "${label}".`);
    return [];
  }
  if (!Array.isArray(value)) {
    collector.errors.push(`"${label}" must be a list.`);
    return [];
  }
  return value;
}

export function readFolders(value: unknown, collector: ReadCollector): Folder[] {
  const rows = readCollection(value, 'folders', collector, { required: true });
  const reader = new Row(collector);
  const folders: Folder[] = [];
  const seen = new Set<string>();

  rows.forEach((entry, index) => {
    const label = `folder #${index + 1}`;
    if (!isRow(entry)) {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not an object.`);
      return;
    }
    const id = reader.id(entry, label);
    if (!id) return;
    if (seen.has(id)) {
      collector.errors.push(`Two folders share the id "${id}".`);
      return;
    }
    seen.add(id);

    const enc = readPayload(entry, collector, `${label} (${id})`);
    const sealed = Boolean(enc);
    const rawName = entry.name;
    // A sealed folder has no readable name; an unsealed one must have one.
    const name = sealed
      ? ''
      : typeof rawName === 'string'
        ? rawName.slice(0, 200)
        : (() => {
            collector.errors.push(`${label} (${id}): "name" must be text.`);
            return '';
          })();
    if (!sealed && typeof rawName === 'string' && rawName.trim().length === 0) {
      collector.errors.push(`${label} (${id}): "name" is empty.`);
    }

    const folder: Folder = {
      id,
      parentId: reader.parentRef(entry, 'parentId'),
      name,
      createdAt: reader.count(entry, 'createdAt', 0),
      updatedAt: reader.count(entry, 'updatedAt', 0),
      sortOrder: reader.count(entry, 'sortOrder', index),
      isFavorite: reader.flag(entry, 'isFavorite', false),
      // Sealed implies locked: a row without its plaintext is not readable, and
      // importing it as unlocked would invite an unseal that cannot happen.
      isLocked: sealed ? true : reader.flag(entry, 'isLocked', false),
    };
    if (!sealed) {
      const icon = reader.optionalText(entry, 'icon');
      if (icon) folder.icon = icon;
    }
    if (enc) folder.enc = enc;
    folders.push(folder);
  });

  return folders;
}

export function readLinks(value: unknown, collector: ReadCollector): SavedLink[] {
  const rows = readCollection(value, 'links', collector, { required: true });
  const reader = new Row(collector);
  const links: SavedLink[] = [];
  const seen = new Set<string>();

  rows.forEach((entry, index) => {
    const label = `link #${index + 1}`;
    if (!isRow(entry)) {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not an object.`);
      return;
    }
    const id = reader.id(entry, label);
    if (!id) return;
    if (seen.has(id)) {
      collector.errors.push(`Two links share the id "${id}".`);
      return;
    }
    seen.add(id);

    const enc = readPayload(entry, collector, `${label} (${id})`);
    const sealed = Boolean(enc);

    let url = '';
    if (sealed) {
      url = '';
    } else if (typeof entry.url === 'string' && entry.url.length > 0) {
      url = entry.url;
    } else {
      collector.errors.push(`${label} (${id}): "url" is required.`);
    }

    const link: SavedLink = {
      id,
      folderId: reader.parentRef(entry, 'folderId'),
      url,
      normalizedUrl: sealed
        ? ''
        : typeof entry.normalizedUrl === 'string' && entry.normalizedUrl.length > 0
          ? entry.normalizedUrl
          : (normalizeUrl(url) ?? url),
      createdAt: reader.count(entry, 'createdAt', 0),
      updatedAt: reader.count(entry, 'updatedAt', 0),
      isFavorite: reader.flag(entry, 'isFavorite', false),
      isArchived: reader.flag(entry, 'isArchived', false),
      isLocked: sealed ? true : reader.flag(entry, 'isLocked', false),
    };

    if (!sealed) {
      const title = reader.optionalText(entry, 'title');
      if (title) link.title = title;
      const description = reader.optionalText(entry, 'description');
      if (description) link.description = description;
      const userNote = reader.optionalText(entry, 'userNote');
      if (userNote) link.userNote = userNote;
      const rawText = reader.optionalText(entry, 'rawText');
      if (rawText) link.rawText = rawText;
      const source = reader.optionalText(entry, 'source') ?? domainOf(url);
      if (source) link.source = source;
    }
    // Provenance is not content, so it survives sealing on purpose.
    const sourcePackage = reader.optionalText(entry, 'sourcePackage');
    if (sourcePackage) link.sourcePackage = sourcePackage;
    const lastOpenedAt = reader.optionalCount(entry, 'lastOpenedAt');
    if (lastOpenedAt !== undefined) link.lastOpenedAt = lastOpenedAt;
    // Link health is a note the user made about the address, not part of the
    // address, so it travels sealed or unsealed: losing it on restore would be
    // losing a judgement the user made by hand, with no way to re-derive it.
    if (reader.flag(entry, 'isUnavailable', false)) {
      link.isUnavailable = true;
      const unavailableAt = reader.optionalCount(entry, 'unavailableAt');
      if (unavailableAt !== undefined) link.unavailableAt = unavailableAt;
    }
    if (enc) link.enc = enc;

    links.push(link);
  });

  return links;
}

export function readNotes(value: unknown, collector: ReadCollector): Note[] {
  const rows = readCollection(value, 'notes', collector);
  const reader = new Row(collector);
  const notes: Note[] = [];
  const seen = new Set<string>();

  rows.forEach((entry, index) => {
    const label = `note #${index + 1}`;
    if (!isRow(entry)) {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not an object.`);
      return;
    }
    const id = reader.id(entry, label);
    if (!id) return;
    if (seen.has(id)) {
      collector.errors.push(`Two notes share the id "${id}".`);
      return;
    }
    seen.add(id);

    const enc = readPayload(entry, collector, `${label} (${id})`);
    const sealed = Boolean(enc);

    let content = '';
    let title = '';
    if (!sealed) {
      if (typeof entry.content === 'string') {
        content = entry.content;
      } else if (entry.content !== undefined) {
        collector.coerced += 1;
      }
      // A note whose title went missing is recoverable: derive it from the body,
      // exactly as the editor would. That is the one repair worth making here,
      // because the body is the real content.
      title = sanitizeNoteTitle(typeof entry.title === 'string' ? entry.title : '');
      if (title.length === 0) title = deriveNoteTitle(content);
    }

    const note: Note = {
      id,
      parentNoteId: reader.parentRef(entry, 'parentNoteId'),
      title,
      content,
      createdAt: reader.count(entry, 'createdAt', 0),
      updatedAt: reader.count(entry, 'updatedAt', 0),
      sortOrder: reader.count(entry, 'sortOrder', index),
      isFavorite: reader.flag(entry, 'isFavorite', false),
      isArchived: reader.flag(entry, 'isArchived', false),
      isLocked: sealed ? true : reader.flag(entry, 'isLocked', false),
    };
    if (enc) note.enc = enc;
    notes.push(note);
  });

  return notes;
}

export function readTags(value: unknown, collector: ReadCollector): Tag[] {
  const rows = readCollection(value, 'tags', collector);
  const seen = new Set<string>();
  const tags: Tag[] = [];

  rows.forEach((entry, index) => {
    const label = `tag #${index + 1}`;
    if (!isRow(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not a valid tag.`);
      return;
    }
    if (seen.has(entry.id)) {
      collector.errors.push(`Two tags share the id "${entry.id}".`);
      return;
    }
    seen.add(entry.id);
    tags.push({ id: entry.id, name: entry.name });
  });

  return tags;
}

export function readLinkTags(value: unknown, collector: ReadCollector): LinkTag[] {
  const rows = readCollection(value, 'linkTags', collector);
  const seen = new Set<string>();
  const linkTags: LinkTag[] = [];

  rows.forEach((entry, index) => {
    const label = `link tag #${index + 1}`;
    if (!isRow(entry) || typeof entry.linkId !== 'string' || typeof entry.tagId !== 'string') {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not a valid link-tag pair.`);
      return;
    }
    // The compound key is the identity: a repeated pair is a duplicate row, not
    // a reason to refuse the file.
    const key = `${entry.linkId}\u0000${entry.tagId}`;
    if (seen.has(key)) {
      collector.coerced += 1;
      return;
    }
    seen.add(key);
    linkTags.push({ linkId: entry.linkId, tagId: entry.tagId });
  });

  return linkTags;
}

export function readNoteLinks(value: unknown, collector: ReadCollector): NoteLink[] {
  const rows = readCollection(value, 'noteLinks', collector);
  const seen = new Set<string>();
  const noteLinks: NoteLink[] = [];

  rows.forEach((entry, index) => {
    const label = `note link #${index + 1}`;
    if (!isRow(entry) || typeof entry.noteId !== 'string' || typeof entry.linkId !== 'string') {
      collector.corrupt.push(label);
      collector.errors.push(`${label} is not a valid note-link pair.`);
      return;
    }
    const key = `${entry.noteId}\u0000${entry.linkId}`;
    if (seen.has(key)) {
      collector.coerced += 1;
      return;
    }
    seen.add(key);

    const origin = entry.origin === 'created-from' ? 'created-from' : 'attached';
    noteLinks.push({
      noteId: entry.noteId,
      linkId: entry.linkId,
      origin,
      createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      sortOrder: typeof entry.sortOrder === 'number' && Number.isFinite(entry.sortOrder) ? entry.sortOrder : index,
    });
  });

  return noteLinks;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
