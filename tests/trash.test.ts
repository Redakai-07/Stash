import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, openDatabase } from '@/db';
import { createFolder, deleteFolder, listFolders, moveFolder } from '@/db/repos/folders';
import { createLink, listAllLinks, setLinkFavorite, setLinkUnavailable } from '@/db/repos/links';
import { attachLinkToNote, createNote, listNoteLinks } from '@/db/repos/notes';
import { setLinkTags } from '@/db/repos/tags';
import {
  countTrashed,
  emptyTrash,
  listTrashGroups,
  purgeBatch,
  restoreAll,
  restoreBatch,
  trashLink,
  trashNote,
} from '@/db/repos/trash';
import { getSnapshot } from '@/db/repos/vault';
import { isTrashed, liveOnly } from '@/lib/trash';

/**
 * The trash, over a real database.
 *
 * Every test here is ultimately checking one promise: **deleting is not
 * destroying**. So the assertions are made twice — once that the row is gone
 * from what the app can see, and once that it is still on the device, exactly as
 * it was, and can be put back.
 *
 * The granularity under test is the *batch*, not the row: throwing away a folder
 * with ninety links in it is one decision, and it has to come back as one, with
 * the same names, the same nesting and the same links in the same places.
 */

async function resetDatabase() {
  db.close();
  await Dexie.delete(db.name);
  await openDatabase();
}

beforeEach(async () => {
  await resetDatabase();
});

async function mustFolder(name: string, parentId: string | null = null): Promise<string> {
  const result = await createFolder({ name, parentId });
  if (!result.ok) throw new Error(`createFolder("${name}") failed: ${result.reason}`);
  return result.folder.id;
}

async function mustLink(url: string, folderId: string | null = null, title?: string): Promise<string> {
  const link = await createLink({ url, folderId, ...(title ? { title } : {}) });
  return link.id;
}

async function mustNote(title: string, parentNoteId: string | null = null): Promise<string> {
  const result = await createNote({ title, content: '', parentNoteId });
  if (!result.ok) throw new Error(`createNote("${title}") failed: ${result.message}`);
  return result.note.id;
}

describe('the pure rules', () => {
  it('treats a row as live unless it says it was thrown away', () => {
    // This is why the trash needed no migration: a row that predates it has no
    // `deletedAt` at all, and \"absent\" has to mean live rather than unknown.
    expect(isTrashed({})).toBe(false);
    expect(isTrashed({ deletedAt: undefined })).toBe(false);
    expect(isTrashed({ deletedAt: 0 })).toBe(false);
    expect(isTrashed({ deletedAt: 1 })).toBe(true);
    expect(liveOnly([{ deletedAt: 1 }, {}, { deletedAt: 5 }])).toEqual([{}]);
  });
});

describe('a link', () => {
  it('is thrown away without losing what the user put on it', async () => {
    const linkId = await mustLink('https://example.com/a', null, 'Example');
    await setLinkFavorite(linkId, true);
    await setLinkUnavailable(linkId, true);
    await setLinkTags(linkId, ['programming']);
    const noteId = (await createNote({ title: 'About that', content: 'x' })).ok
      ? (await db.notes.toArray())[0]!.id
      : '';
    await attachLinkToNote(noteId, linkId, 'attached');

    await trashLink(linkId);

    const snapshot = await getSnapshot();
    expect(snapshot.links.some((link) => link.id === linkId)).toBe(false);
    // A reference to a link nobody can reach describes nothing, so it is not in
    // the snapshot either…
    expect(snapshot.noteLinks.some((row) => row.linkId === linkId)).toBe(false);

    // …but it is still in the database, which is what makes the restore exact.
    expect(await db.noteLinks.where('linkId').equals(linkId).count()).toBe(1);

    const groups = await listTrashGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'link', linkCount: 1, folderCount: 0, noteCount: 0 });

    await restoreBatch(groups[0]!.batch);

    const restored = await db.links.get(linkId);
    expect(restored).toBeDefined();
    expect(restored!.isFavorite).toBe(true);
    expect(restored!.isUnavailable).toBe(true);
    expect(restored!.title).toBe('Example');
    expect(restored!.deletedAt).toBeUndefined();
    expect(await db.linkTags.where('linkId').equals(linkId).count()).toBe(1);
    expect(await listNoteLinks()).toHaveLength(1);
  });

  it('is only unlinked from notes when it is purged for good', async () => {
    const linkId = await mustLink('https://example.com/b');
    const note = await createNote({ title: 'Note', content: '' });
    const noteId = note.ok ? note.note.id : '';
    await attachLinkToNote(noteId, linkId, 'attached');

    await trashLink(linkId);
    const [entry] = await listTrashGroups();
    await purgeBatch(entry!.batch);

    expect(await db.links.get(linkId)).toBeUndefined();
    expect(await listNoteLinks()).toHaveLength(0);
    // The note itself is untouched: deleting a link must never delete the
    // thinking that pointed at it.
    expect(await db.notes.get(noteId)).toBeDefined();
  });
});

describe('a folder', () => {
  it('takes its subfolders and links with it, in one recoverable act', async () => {
    const dev = await mustFolder('Development');
    const react = await mustFolder('React', dev);
    const hooks = await mustFolder('Hooks', react);
    const a = await mustLink('https://example.com/a', dev);
    const b = await mustLink('https://example.com/b', react);
    const c = await mustLink('https://example.com/c', hooks);
    const outside = await mustLink('https://example.com/outside', null);

    const result = await deleteFolder(dev, 'delete-everything');
    expect(result.ok).toBe(true);
    expect(result.removedFolderCount).toBe(3);
    expect(result.removedLinkCount).toBe(3);

    const snapshot = await getSnapshot();
    expect(snapshot.folders).toHaveLength(0);
    expect(snapshot.links.map((link) => link.id)).toEqual([outside]);
    expect(await countTrashed()).toEqual({ folders: 3, links: 3, notes: 0 });

    const groups = await listTrashGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'folder', label: 'Development', folderCount: 3, linkCount: 3 });

    const impact = await restoreBatch(groups[0]!.batch);
    expect(impact).toMatchObject({ folders: 3, links: 3, rehomed: 0 });

    // Restoring is exact: the same nesting, the same order, the same folders.
    const after = await getSnapshot();
    expect(new Set(after.links.map((link) => link.id))).toEqual(new Set([a, b, c, outside]));
    const byId = new Map(after.folders.map((folder) => [folder.id, folder]));
    expect(byId.get(react)!.parentId).toBe(dev);
    expect(byId.get(hooks)!.parentId).toBe(react);
    expect(after.links.find((link) => link.id === b)!.folderId).toBe(react);
    expect(await countTrashed()).toEqual({ folders: 0, links: 0, notes: 0 });
  });

  it('comes back at the top level when its parent was thrown away separately', async () => {
    const parent = await mustFolder('Parent');
    const child = await mustFolder('Child', parent);

    // Two separate acts, so two separate batches: deleting the child and then
    // deleting the parent is not the same as deleting the parent.
    await deleteFolder(child, 'delete-everything');
    const childEntry = (await listTrashGroups()).find((entry) => entry.label === 'Child');
    await deleteFolder(parent, 'delete-everything');

    // Restoring just the child cannot put it back inside a folder that is still
    // in the trash, so it is re-homed and the move is reported.
    const impact = await restoreBatch(childEntry!.batch);
    expect(impact.folders).toBe(1);
    expect(impact.rehomed).toBe(1);

    const restored = (await listFolders()).find((folder) => folder.id === child);
    expect(restored).toBeDefined();
    expect(restored!.parentId).toBeNull();
  });

  it('keeps the folder name even in the "keep the links" removal', async () => {
    const root = await mustFolder('Root');
    const sub = await mustFolder('Sub', root);
    const linkId = await mustLink('https://example.com/a', root);

    const result = await deleteFolder(root, 'move-contents-up');
    expect(result).toMatchObject({ ok: true, removedFolderCount: 1, removedLinkCount: 0, movedLinkCount: 1 });

    const snapshot = await getSnapshot();
    // Nothing is destroyed: the link survives at the top level and the subfolder
    // is promoted to where its parent sat.
    expect(snapshot.links.map((link) => link.id)).toEqual([linkId]);
    expect(snapshot.links[0]!.folderId).toBeNull();
    expect(snapshot.folders.map((folder) => folder.id)).toEqual([sub]);
    expect(snapshot.folders[0]!.parentId).toBeNull();

    // The folder itself is recoverable too — one name the user typed, got back.
    const groups = await listTrashGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'folder', label: 'Root' });
    await restoreBatch(groups[0]!.batch);
    expect((await listFolders()).map((folder) => folder.name).sort()).toEqual(['Root', 'Sub']);
  });
});

describe('a note', () => {
  it('takes its whole subtree away and brings it back whole', async () => {
    const root = await mustNote('Root');
    const child = await mustNote('Child', root);
    const grandchild = await mustNote('Grandchild', child);

    const impact = await trashNote(root, 'delete-subtree');
    expect(impact.notes).toBe(3);
    expect((await getSnapshot()).notes).toHaveLength(0);

    const [entry] = await listTrashGroups();
    expect(entry).toMatchObject({ kind: 'note', label: 'Root', noteCount: 3 });

    await restoreBatch(entry!.batch);
    const notes = await db.notes.toArray();
    expect(notes.every((note) => !isTrashed(note))).toBe(true);
    expect(notes.find((note) => note.id === grandchild)!.parentNoteId).toBe(child);
  });

  it('promotes its subnotes instead of throwing them away with it', async () => {
    const parent = await mustNote('Parent');
    const child = await mustNote('Child', parent);

    await trashNote(child, 'keep-children');

    // Nothing was thrown away except the note itself, so the subnotes need no
    // recovering — they were never at risk.
    const snapshot = await getSnapshot();
    expect(snapshot.notes.map((note) => note.id)).toEqual([parent]);
    expect(await countTrashed()).toEqual({ folders: 0, links: 0, notes: 1 });
  });
});

describe('emptying', () => {
  it('restores everything at once, and purges everything at once', async () => {
    const folderId = await mustFolder('Folder');
    const linkId = await mustLink('https://example.com/a', folderId);
    const note = await createNote({ title: 'Note', content: '' });
    await trashLink(linkId);
    await trashNote(note.ok ? note.note.id : '', 'delete-subtree');
    await deleteFolder(folderId, 'delete-everything');

    const impact = await restoreAll();
    expect(impact.folders).toBe(1);
    expect(impact.links).toBe(1);
    expect(impact.notes).toBe(1);
    expect(await countTrashed()).toEqual({ folders: 0, links: 0, notes: 0 });

    // Now throw it all away again and destroy it, which is the only irreversible
    // operation in the product.
    await trashLink(linkId);
    await trashNote(note.ok ? note.note.id : '', 'delete-subtree');
    await deleteFolder(folderId, 'delete-everything');
    const destroyed = await emptyTrash();

    expect(destroyed.folders).toBe(1);
    expect(destroyed.links).toBe(1);
    expect(destroyed.notes).toBe(1);
    expect(await db.folders.count()).toBe(0);
    expect(await db.links.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
    expect(await listAllLinks()).toHaveLength(0);
  });

  it('reports nothing to do rather than pretending', async () => {
    expect(await emptyTrash()).toMatchObject({ folders: 0, links: 0, notes: 0 });
    expect(await restoreAll()).toMatchObject({ folders: 0, links: 0, notes: 0 });
    expect(await listTrashGroups()).toEqual([]);
  });
});

describe('the trash as a listing', () => {
  it('groups by the act, newest first, and names each entry after what was deleted', async () => {
    const folderId = await mustFolder('Recipes');
    await mustLink('https://example.com/pasta', folderId, 'Pasta');

    await deleteFolder(folderId, 'delete-everything');
    const linkId = await mustLink('https://example.com/later');
    await trashLink(linkId);

    const groups = await listTrashGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0]!.deletedAt).toBeGreaterThanOrEqual(groups[1]!.deletedAt);
    expect(groups.map((entry) => entry.label)).toContain('Recipes');
  });

  it('re-homes a restored link to the Inbox when its folder is gone for good', async () => {
    const folderId = await mustFolder('Doomed');
    const linkId = await mustLink('https://example.com/a', folderId);
    await trashLink(linkId);
    const linkEntry = (await listTrashGroups()).find((entry) => entry.kind === 'link');

    await deleteFolder(folderId, 'delete-everything');
    const folderEntry = (await listTrashGroups()).find((entry) => entry.kind === 'folder');
    await purgeBatch(folderEntry!.batch);

    const impact = await restoreBatch(linkEntry!.batch);
    expect(impact.rehomed).toBe(1);
    // Landing in the Inbox is better than pointing at a folder nobody can open.
    expect((await db.links.get(linkId))!.folderId).toBeNull();
  });
});

describe('moving', () => {
  it('never puts anything in the trash', async () => {
    const a = await mustFolder('A');
    const b = await mustFolder('B');
    const linkId = await mustLink('https://example.com/a', a);

    const result = await moveFolder(a, b);
    expect(result.ok).toBe(true);
    const snapshot = await getSnapshot();
    expect(snapshot.folders).toHaveLength(2);
    expect(snapshot.links[0]!.id).toBe(linkId);
    expect(await countTrashed()).toEqual({ folders: 0, links: 0, notes: 0 });
  });
});
