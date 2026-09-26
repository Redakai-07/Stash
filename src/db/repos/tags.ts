import { newId } from '../id';
import { db, type LinkTag, type Tag } from '../index';

/**
 * Tags are modelled and persisted in Phase 1 so the schema never has to change
 * later, but the UI keeps them lightweight. Nothing here depends on the network
 * or on a taxonomy the user has to maintain up front.
 */

export function normalizeTagName(raw: string): string {
  return raw.replace(/^#+/, '').replace(/\s+/g, '-').trim().toLowerCase().slice(0, 40);
}

export async function listTags(): Promise<Tag[]> {
  const tags = await db.tags.toArray();
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

export async function ensureTag(rawName: string): Promise<Tag | null> {
  const name = normalizeTagName(rawName);
  if (name.length === 0) return null;
  const existing = await db.tags.where('name').equals(name).first();
  if (existing) return existing;
  const tag: Tag = { id: newId(), name };
  await db.tags.add(tag);
  return tag;
}

export async function setLinkTags(linkId: string, tagNames: readonly string[]): Promise<void> {
  await db.transaction('rw', db.tags, db.linkTags, async () => {
    const wanted: Tag[] = [];
    for (const rawName of tagNames) {
      const tag = await ensureTag(rawName);
      if (tag) wanted.push(tag);
    }
    const existing = await db.linkTags.where('linkId').equals(linkId).toArray();
    const wantedIds = new Set(wanted.map((tag) => tag.id));
    const toRemove = existing.filter((linkTag: LinkTag) => !wantedIds.has(linkTag.tagId));
    if (toRemove.length > 0) {
      await db.linkTags.bulkDelete(toRemove.map((linkTag) => [linkTag.linkId, linkTag.tagId] as [string, string]));
    }
    const existingIds = new Set(existing.map((linkTag) => linkTag.tagId));
    const toAdd: LinkTag[] = wanted
      .filter((tag) => !existingIds.has(tag.id))
      .map((tag) => ({ linkId, tagId: tag.id }));
    if (toAdd.length > 0) await db.linkTags.bulkAdd(toAdd);

    // Drop tags that are no longer attached to anything so the tag list stays clean.
    const orphans = (await db.tags.toArray()).filter((tag) => wantedIds.has(tag.id));
    for (const tag of orphans) {
      const usage = await db.linkTags.where('tagId').equals(tag.id).count();
      if (usage === 0) await db.tags.delete(tag.id);
    }
  });
}

export async function tagsForLink(linkId: string): Promise<string[]> {
  const linkTags = await db.linkTags.where('linkId').equals(linkId).toArray();
  if (linkTags.length === 0) return [];
  const ids = linkTags.map((linkTag) => linkTag.tagId);
  const tags = await db.tags.where('id').anyOf(ids).toArray();
  return tags.map((tag) => tag.name).sort();
}
