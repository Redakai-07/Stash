import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, openDatabase } from '@/db';
import { createFolder, setFolderLocked } from '@/db/repos/folders';
import { createLink } from '@/db/repos/links';
import { createStaticAuthenticator, setDeviceAuthenticator } from '@/lib/privacy/auth';
import {
  createKeyring,
  enableDeviceUnlock,
  forgetVaultKey,
  isSessionLocked,
} from '@/lib/privacy/keyring';
import { isSealed } from '@/lib/privacy/protection';
import { setSecureStore, type SecureStore } from '@/lib/privacy/secure-store';
import { searchVault } from '@/lib/search';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useVaultStore } from '@/stores/vault-store';

/**
 * Locked items stay in the list, and tapping one asks for the prompt.
 *
 * That is a deliberate product choice with a privacy consequence, so both halves
 * are pinned here: the row survives with its shape intact, and *nothing* about
 * its content does — no title, no name, no address, and no match in search.
 */

const PASSCODE = 'open sesame 42';

function memorySecureStore(): SecureStore {
  const values = new Map<string, string>();
  return {
    kind: 'native',
    isAvailable: async () => true,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

const PRISTINE_VAULT = useVaultStore.getState();
const PRISTINE_PRIVACY = usePrivacyStore.getState();

async function resetDatabase() {
  db.close();
  await Dexie.delete(db.name);
  await openDatabase();
}

/** A locked folder with a link and a sibling folder that stays open. */
async function arrangeLockedFolder() {
  const parent = await createFolder({ name: 'Personal', parentId: null });
  if (!parent.ok) throw new Error('folder');
  const secret = await createFolder({ name: 'Divorce', parentId: parent.folder.id });
  if (!secret.ok) throw new Error('folder');
  const inside = await createLink({
    url: 'https://example.com/lawyer',
    folderId: secret.folder.id,
    title: 'Family lawyer — first consultation',
  });
  const open = await createFolder({ name: 'Development', parentId: null });
  if (!open.ok) throw new Error('folder');

  await setFolderLocked(secret.folder.id, true);
  return { parent: parent.folder.id, secret: secret.folder.id, inside: inside.id, open: open.folder.id };
}

beforeEach(async () => {
  await resetDatabase();
  forgetVaultKey();
  useVaultStore.setState({ ...PRISTINE_VAULT }, true);
  usePrivacyStore.setState({ ...PRISTINE_PRIVACY }, true);
  setDeviceAuthenticator(createStaticAuthenticator({ ok: true }, { available: true }));
  setSecureStore(memorySecureStore());
  await createKeyring(PASSCODE);
});

describe('a locked folder in the tree', () => {
  it('keeps its place in the list and loses every readable field', async () => {
    const ids = await arrangeLockedFolder();
    forgetVaultKey();
    await useVaultStore.getState().refresh();

    const state = useVaultStore.getState();
    const locked = state.folders.find((folder) => folder.id === ids.secret);
    expect(locked).toBeDefined();
    expect(locked?.name).toBe('');
    expect(isSealed(locked ?? {})).toBe(true);
    // And it is still published as hidden, so content surfaces skip it.
    expect(state.hidden.folders.has(ids.secret)).toBe(true);
    // The row on disk is what an attacker would read: no name anywhere.
    expect(JSON.stringify(await db.folders.get(ids.secret))).not.toContain('Divorce');

    // Unlocked items are untouched beside it.
    expect(state.folders.find((folder) => folder.id === ids.open)?.name).toBe('Development');
  });

  it('keeps its links listed as placeholders too', async () => {
    const ids = await arrangeLockedFolder();
    forgetVaultKey();
    await useVaultStore.getState().refresh();

    const state = useVaultStore.getState();
    const link = state.links.find((candidate) => candidate.id === ids.inside);
    expect(link).toBeDefined();
    expect(link?.title).toBeUndefined();
    expect(link?.url).toBe('');
    expect(isSealed(link ?? {})).toBe(true);
    expect(state.hidden.links.has(ids.inside)).toBe(true);
  });

  it('is counted, because the row is on screen', async () => {
    const ids = await arrangeLockedFolder();
    forgetVaultKey();
    await useVaultStore.getState().refresh();

    const stats = useVaultStore.getState().folderStats.get(ids.secret);
    expect(stats?.directLinks).toBe(1);
  });

  it('never appears in search, locked or not', async () => {
    await arrangeLockedFolder();
    forgetVaultKey();
    await useVaultStore.getState().refresh();

    const state = useVaultStore.getState();
    const outcome = searchVault(
      {
        folders: state.folders,
        links: state.links,
        tags: state.tags,
        linkTags: state.linkTags,
        notes: state.notes,
        noteLinks: state.noteLinks,
      },
      { query: 'lawyer', hidden: state.hidden },
    );
    expect(outcome.links).toHaveLength(0);
    expect(outcome.folders).toHaveLength(0);

    const byName = searchVault(
      {
        folders: state.folders,
        links: state.links,
        tags: state.tags,
        linkTags: state.linkTags,
        notes: state.notes,
        noteLinks: state.noteLinks,
      },
      { query: 'Divorce', hidden: state.hidden },
    );
    expect(byName.folders).toHaveLength(0);
  });

  it('becomes readable again after unlocking, with nothing re-fetched by hand', async () => {
    const ids = await arrangeLockedFolder();
    forgetVaultKey();
    await useVaultStore.getState().refresh();
    expect(isSessionLocked()).toBe(true);

    const unlocked = await usePrivacyStore.getState().unlock(PASSCODE);
    expect(unlocked.ok).toBe(true);
    await useVaultStore.getState().refresh();

    const state = useVaultStore.getState();
    expect(state.folders.find((folder) => folder.id === ids.secret)?.name).toBe('Divorce');
    expect(state.hidden.folders.size).toBe(0);
  });
});

describe('tapping a locked row', () => {
  it('runs the device prompt and reports success when it answers', async () => {
    const ids = await arrangeLockedFolder();
    // Arm the device path while the vault is still open, then lock it.
    expect(await enableDeviceUnlock()).toBe(true);
    forgetVaultKey();
    await useVaultStore.getState().refresh();

    const result = await usePrivacyStore.getState().requestReveal('folder', ids.secret);
    expect(result.ok).toBe(true);
    expect(isSessionLocked()).toBe(false);
    expect(usePrivacyStore.getState().revealRequest).toBeNull();
  });

  it('queues the request when there is no device path, so the gate can ask', async () => {
    const ids = await arrangeLockedFolder();
    forgetVaultKey();
    // No device wrap was armed, so the prompt is the passcode.
    const result = await usePrivacyStore.getState().requestReveal('folder', ids.secret);

    expect(result.ok).toBe(false);
    expect(isSessionLocked()).toBe(true);
    expect(usePrivacyStore.getState().revealRequest).toEqual({ kind: 'folder', id: ids.secret });

    // Using the passcode satisfies it: the queued request goes away with it.
    expect((await usePrivacyStore.getState().unlock(PASSCODE)).ok).toBe(true);
    expect(usePrivacyStore.getState().revealRequest).toBeNull();
  });

  it('does not queue anything for a vault that is already open', async () => {
    const ids = await arrangeLockedFolder();
    const result = await usePrivacyStore.getState().requestReveal('link', ids.inside);
    expect(result.ok).toBe(true);
    expect(usePrivacyStore.getState().revealRequest).toBeNull();
  });
});
