import { domainOf } from '@/lib/url/extract';
import { normalizeUrl } from '@/lib/url/normalize';
import { descendantIdsOf, folderPathLabel } from '@/lib/tree';
import { newId } from '../id';
import { db, type SavedLink } from '../index';

/**
 * Link persistence.
 *
 * Note on `folderId === null`: IndexedDB cannot index `null`, so "Inbox" rows
 * are fetched with a filter rather than an index lookup. That is handled once
 * here so callers never have to know.
 */

export interface CreateLinkInput {
  url: string;
  folderId: string | null;
  title?: string;
  description?: string;
  userNote?: string;
  source?: string;
  sourcePackage?: string;
  rawText?: string;
  isFavorite?: boolean;
}

export function buildLinkRecord(input: CreateLinkInput): SavedLink {
  const now = Date.now();
  const normalized = normalizeUrl(input.url) ?? input.url.trim();
  const record: SavedLink = {
    id: newId(),
    folderId: input.folderId,
    url: input.url.trim(),
    normalizedUrl: normalized,
    createdAt: now,
    updatedAt: now,
    isFavorite: input.isFavorite ?? false,
    isArchived: false,
  };
  if (input.title?.trim()) record.title = input.title.trim();
  if (input.description?.trim()) record.description = input.description.trim();
  if (input.userNote?.trim()) record.userNote = input.userNote.trim();
  const source = input.source?.trim() || domainOf(input.url);
  if (source) record.source = source;
  if (input.sourcePackage) record.sourcePackage = input.sourcePackage;
  if (input.rawText?.trim()) record.rawText = input.rawText.trim();
  return record;
}

export async function createLink(input: CreateLinkInput): Promise<SavedLink> {
  const record = buildLinkRecord(input);
  await db.links.add(record);
  return record;
}

/** All non-archived links in a folder, newest first. `null` means the Inbox. */
export async function listLinksInFolder(
  folderId: string | null,
  options: { includeNested?: boolean; includeArchived?: boolean } = {},
): Promise<SavedLink[]> {
  const { includeNested = false, includeArchived = false } = options;

  let scope: SavedLink[];
  if (folderId === null) {
    scope = await db.links.filter((link) => link.folderId === null).toArray();
  } else if (includeNested) {
    const folders = await db.folders.toArray();
    const ids = [folderId, ...descendantIdsOf(folders, folderId)];
    scope = await db.links.where('folderId').anyOf(ids).toArray();
  } else {
    scope = await db.links.where('folderId').equals(folderId).toArray();
  }

  return scope
    .filter((link) => includeArchived || !link.isArchived)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAllLinks(): Promise<SavedLink[]> {
  return db.links.toArray();
}

export async function listActiveLinks(): Promise<SavedLink[]> {
  const links = await db.links.toArray();
  return links.filter((link) => !link.isArchived);
}

/** IndexedDB cannot index booleans, so favorites are a filter, not a lookup. */
export async function listFavoriteLinks(): Promise<SavedLink[]> {
  const links = await db.links.toArray();
  return links
    .filter((link) => link.isFavorite && !link.isArchived)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRecentLinks(limit = 8): Promise<SavedLink[]> {
  const links = await db.links.toArray();
  return links
    .filter((link) => !link.isArchived)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function getLink(id: string): Promise<SavedLink | undefined> {
  return db.links.get(id);
}

export interface DuplicateMatch {
  link: SavedLink;
  /** `Development → React`, or `Inbox`. */
  folderPath: string;
  /** True when the normalized forms match exactly rather than merely sharing a host. */
  exact: boolean;
}

/**
 * Find links that already represent the same resource.
 *
 * Only normalized equality counts as a duplicate. Anything weaker would
 * produce false alarms, and a false "already saved" is worse than a rare
 * duplicate link.
 */
export async function findDuplicates(url: string, options: { excludeId?: string } = {}): Promise<DuplicateMatch[]> {
  const normalized = normalizeUrl(url) ?? url.trim();
  const [candidates, folders] = await Promise.all([
    db.links.where('normalizedUrl').equals(normalized).toArray(),
    db.folders.toArray(),
  ]);

  return candidates
    .filter((link) => !link.isArchived && link.id !== options.excludeId)
    .map((link) => ({
      link,
      folderPath: link.folderId ? folderPathLabel(folders, link.folderId) : 'Inbox',
      exact: true,
    }))
    .sort((a, b) => b.link.createdAt - a.link.createdAt);
}

export interface UpdateLinkInput {
  title?: string;
  description?: string;
  userNote?: string;
  folderId?: string | null;
}

export async function updateLink(id: string, patch: UpdateLinkInput): Promise<SavedLink | null> {
  return db.transaction('rw', db.links, async () => {
    const link = await db.links.get(id);
    if (!link) return null;
    const updated: SavedLink = { ...link, updatedAt: Date.now() };
    if (patch.title !== undefined) {
      if (patch.title.trim()) updated.title = patch.title.trim();
      else delete updated.title;
    }
    if (patch.description !== undefined) {
      if (patch.description.trim()) updated.description = patch.description.trim();
      else delete updated.description;
    }
    if (patch.userNote !== undefined) {
      if (patch.userNote.trim()) updated.userNote = patch.userNote.trim();
      else delete updated.userNote;
    }
    if (patch.folderId !== undefined) updated.folderId = patch.folderId;
    await db.links.put(updated);
    return updated;
  });
}

export async function moveLink(id: string, folderId: string | null): Promise<void> {
  await db.links.update(id, { folderId, updatedAt: Date.now() });
}

export async function setLinkFavorite(id: string, isFavorite: boolean): Promise<void> {
  await db.links.update(id, { isFavorite, updatedAt: Date.now() });
}

export async function setLinkArchived(id: string, isArchived: boolean): Promise<void> {
  await db.links.update(id, { isArchived, updatedAt: Date.now() });
}

export async function touchLinkOpened(id: string): Promise<void> {
  await db.links.update(id, { lastOpenedAt: Date.now() });
}

/**
 * Delete a saved link.
 *
 * Notes that referenced it are not touched -- they simply stop referencing it.
 * Deleting a link must never delete the thinking that pointed at it.
 */
export async function deleteLink(id: string): Promise<void> {
  await db.transaction('rw', db.links, db.noteLinks, async () => {
    await db.noteLinks.where('linkId').equals(id).delete();
    await db.links.delete(id);
  });
}

export async function countActiveLinks(): Promise<number> {
  return db.links.filter((link) => !link.isArchived).count();
}

/**
 * A conservative same-site hint used only when a normalized match failed.
 * Surfaced as a soft "similar link already saved" notice, never as a block.
 */
export async function findSameHostMatches(url: string, limit = 3): Promise<SavedLink[]> {
  const host = domainOf(url);
  if (!host) return [];
  const links = await db.links.toArray();
  return links
    .filter((link) => !link.isArchived && link.source === host)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
