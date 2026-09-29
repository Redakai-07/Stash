'use client';

import { create } from 'zustand';
import { DEFAULT_PRIVACY_SETTINGS, type PrivacySettings } from '@/db/types';
import { getPrivacySettings, setPrivacySettings } from '@/db/repos/settings';
import { getDeviceAuthenticator } from '@/lib/privacy/auth';
import {
  addPasscode as addPasscodeRepo,
  changePasscode as changePasscodeRepo,
  createKeyring,
  createKeyringWithDevice,
  destroyKeyring,
  disableDeviceUnlock,
  enableDeviceUnlock,
  forgetVaultKey,
  hasKeyring,
  hasPasscodeWrap,
  isDeviceUnlockReady,
  isSessionLocked,
  unlockWithDevice,
  unlockWithPasscode,
} from '@/lib/privacy/keyring';
import { getSecureStore } from '@/lib/privacy/secure-store';
import { unsealEverything } from '@/lib/privacy/reconcile';
import { applyScreenPrivacy } from '@/lib/privacy/screen';
import { shouldLockOnBackground, shouldRelock } from '@/lib/privacy/session';

/**
 * The privacy session.
 *
 * Everything here is a *statement about the current process*, never persisted:
 * whether a keyring exists, whether the vault key is currently in memory, when
 * the app was last backgrounded. The key itself is not in this store — it lives
 * inside `keyring.ts`, module-scoped, so a state dump or a devtools snapshot
 * cannot reach it. `unlocked` here is a mirror for rendering, and the authority
 * is always `isSessionLocked()`.
 *
 * A locked session means: locked items are missing from every listing, and the
 * lock gate covers the app if the user asked for that. Locking is cheap and
 * idempotent, and it can never destroy data — the keyring is untouched.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type DeviceStoreKind = 'native' | 'web' | 'unavailable';
export type RevealKind = 'folder' | 'note' | 'link';

export interface RevealRequest {
  kind: RevealKind;
  id: string;
}

export interface PrivacyState {
  ready: boolean;
  settings: PrivacySettings;
  /** True once a keyring row exists, i.e. privacy has been set up. */
  keyringPresent: boolean;
  /**
   * Whether a Stash passcode exists. `false` on a vault set up with the device
   * lock alone, which is a supported setup: the system prompt is the way in and
   * there is nothing to type. The UI says what that costs before it is chosen.
   */
  passcodeSet: boolean;
  /** Where the device key lives, so the copy can be specific rather than vague. */
  deviceStoreKind: DeviceStoreKind;
  unlocked: boolean;
  /** Whether this device can prompt for biometric or device-credential auth. */
  deviceAuthAvailable: boolean;
  /** Whether the biometric fast path is armed and its device key is present. */
  deviceUnlockReady: boolean;
  /** When the app went to the background, for the re-lock policy. */
  backgroundedAt: number | null;
  /** Explanation of the last failed unlock, shown on the gate. */
  message: string | null;
  /**
   * Something the user tapped while it was locked.
   *
   * Set by `requestReveal` so the gate can be raised for *this* reason — "open
   * the locked thing you tapped" — even when locking is configured not to cover
   * the whole app, which is the case where nothing else would prompt.
   */
  revealRequest: RevealRequest | null;
  busy: boolean;

  initialize: () => Promise<void>;
  /**
   * Re-read everything after the vault changed underneath us — an import that
   * replaced the keyring, or installed a locked subtree. Starts locked.
   */
  reload: () => Promise<void>;
  /** Re-read capabilities after they could have changed (resume, settings). */
  refreshCapabilities: () => Promise<void>;
  createPasscode: (passcode: string) => Promise<ActionResult>;
  /**
   * Set up locking with the device prompt only — no passcode to invent.
   * Refuses when this platform cannot prompt, rather than locking the vault with
   * no way in.
   */
  createWithDevice: () => Promise<ActionResult>;
  /** Add a passcode to a device-locked vault, making it portable again. */
  addPasscode: (passcode: string) => Promise<ActionResult>;
  /**
   * Turn privacy off: opens everything, then removes the keyring. On a vault
   * with no passcode the `passcode` argument is unused and the device prompt is
   * what authorises the change.
   */
  disable: (passcode: string) => Promise<ActionResult>;
  unlock: (passcode: string) => Promise<ActionResult>;
  unlockWithBiometrics: () => Promise<ActionResult>;
  /**
   * Ask to see a locked item: prompt the device if it can, otherwise queue the
   * request so the gate opens for it. Resolves `ok` when the vault came back
   * unlocked, which is the caller's signal to continue with what it was doing.
   */
  requestReveal: (kind: RevealKind, id: string) => Promise<ActionResult>;
  clearReveal: () => void;
  lock: () => void;
  handleBackground: (now?: number) => void;
  /** Returns true when the policy expired the session on the way back in. */
  handleForeground: (now?: number) => boolean;
  changePasscode: (current: string, next: string) => Promise<ActionResult>;
  /**
   * Remove the lock without unlocking: the keyring is destroyed and anything
   * sealed stays sealed and permanently unreadable. Offered only as a described,
   * deliberate last resort so a forgotten passcode cannot brick the app.
   */
  abandonLock: () => Promise<void>;
  armBiometrics: () => Promise<ActionResult>;
  disarmBiometrics: () => Promise<void>;
  update: (patch: Partial<PrivacySettings>) => Promise<void>;
  clearMessage: () => void;
}

/**
 * The two facts the privacy UI needs to be specific about: is there a passcode,
 * and where does the device key live.
 *
 * Asked as a pair because they are read together and both answer "what would it
 * take to open this vault somewhere else".
 */
async function describeDevicePath(keyring: boolean): Promise<[boolean, DeviceStoreKind]> {
  const store = await getSecureStore();
  if (!keyring) return [false, store.kind];
  return [await hasPasscodeWrap(), store.kind];
}

/**
 * Screen privacy follows the session: always on while locked, and on while
 * unlocked only when the user asked for it.
 */
function syncScreenPrivacy(secureWhileUnlocked: boolean, unlocked: boolean): void {
  void applyScreenPrivacy(!unlocked || secureWhileUnlocked);
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_PRIVACY_SETTINGS },
  keyringPresent: false,
  passcodeSet: false,
  deviceStoreKind: 'unavailable',
  // Starts locked. On a cold start nothing is unlocked until the user says so,
  // which is what makes "after app restart the vault is locked" true by default
  // rather than by remembering to set a flag.
  unlocked: false,
  deviceAuthAvailable: false,
  deviceUnlockReady: false,
  backgroundedAt: null,
  message: null,
  revealRequest: null,
  busy: false,

  initialize: async () => {
    if (get().ready) return;
    let settings: PrivacySettings;
    let keyring: boolean;
    try {
      [settings, keyring] = await Promise.all([getPrivacySettings(), hasKeyring()]);
    } catch (error) {
      // The vault itself could not be read; `BootGate` is already reporting that.
      // Marking the session ready keeps the boot from waiting on a promise that
      // will never resolve. Defaults are the safe ones: no keyring is assumed,
      // but the vault read decided what is visible, not this flag.
      console.warn('[stash] privacy settings unavailable', error);
      set({ ready: true, settings: { ...DEFAULT_PRIVACY_SETTINGS } });
      return;
    }

    const authenticator = await getDeviceAuthenticator();
    const deviceAuthAvailable = settings.biometric ? await authenticator.isAvailable() : false;
    const deviceUnlockReady = keyring ? await isDeviceUnlockReady() : false;
    const [passcodeSet, deviceStoreKind] = await describeDevicePath(keyring);

    // With no keyring there is nothing to protect, so the session starts open.
    // With one, it starts locked: a cold start never inherits the last session's
    // key, which is what makes "locked after a restart" be the default rather
    // than something remembered.
    const unlocked = !keyring;

    set({
      ready: true,
      settings,
      keyringPresent: keyring,
      passcodeSet,
      deviceStoreKind,
      deviceAuthAvailable,
      deviceUnlockReady,
      unlocked,
    });
    syncScreenPrivacy(settings.secureScreen, unlocked);
  },

  reload: async () => {
    // The bytes that were encrypted in memory belong to the vault that was just
    // replaced, so they are dropped before anything is re-read. Starting locked
    // is the conservative direction: the worst case is one extra unlock.
    forgetVaultKey();

    const [settings, keyring] = await Promise.all([getPrivacySettings(), hasKeyring()]);
    const authenticator = await getDeviceAuthenticator();
    const deviceAuthAvailable = settings.biometric ? await authenticator.isAvailable() : false;
    const deviceUnlockReady = keyring ? await isDeviceUnlockReady() : false;
    const [passcodeSet, deviceStoreKind] = await describeDevicePath(keyring);

    set({
      ready: true,
      settings,
      keyringPresent: keyring,
      passcodeSet,
      deviceStoreKind,
      deviceAuthAvailable,
      deviceUnlockReady,
      unlocked: !keyring,
      backgroundedAt: null,
      message: null,
    });
    syncScreenPrivacy(settings.secureScreen, !keyring);
  },

  refreshCapabilities: async () => {
    const settings = get().settings;
    const authenticator = await getDeviceAuthenticator();
    const deviceAuthAvailable = settings.biometric ? await authenticator.isAvailable() : false;
    const [passcodeSet, deviceStoreKind] = await describeDevicePath(get().keyringPresent);
    set({ deviceAuthAvailable, deviceUnlockReady: await isDeviceUnlockReady(), passcodeSet, deviceStoreKind });
  },

  createPasscode: async (passcode) => {
    set({ busy: true });
    const result = await createKeyring(passcode);
    if (!result.ok) {
      set({ busy: false, message: result.message ?? null });
      return { ok: false, message: result.message };
    }

    // Offer the device fast path straight away when it can work — that is the
    // difference between locking being usable and being resented.
    let deviceUnlockReady = false;
    if (get().settings.biometric) {
      const authenticator = await getDeviceAuthenticator();
      if (await authenticator.isAvailable()) deviceUnlockReady = await enableDeviceUnlock();
    }

    const settings = await setPrivacySettings({ enabled: true });
    set({
      busy: false,
      settings,
      keyringPresent: true,
      passcodeSet: true,
      deviceUnlockReady,
      unlocked: true,
      message: null,
    });
    syncScreenPrivacy(settings.secureScreen, true);
    return { ok: true };
  },

  createWithDevice: async () => {
    set({ busy: true, message: null });

    // The prompt runs *first*, and the keyring is only written once it has
    // succeeded. The other order would leave a vault locked by a device key that
    // was never actually armed — a vault with no way in.
    const authenticator = await getDeviceAuthenticator();
    if (!(await authenticator.isAvailable())) {
      const message =
        'This device cannot prompt for a device unlock yet. Set up a screen lock or Windows Hello, or use a Stash passcode.';
      set({ busy: false, message });
      return { ok: false, message };
    }

    const outcome = await authenticator.authenticate('Lock your Stash vault with this device');
    if (!outcome.ok) {
      set({ busy: false, message: outcome.message ?? 'That did not succeed.' });
      return { ok: false, message: outcome.message };
    }

    const result = await createKeyringWithDevice();
    if (!result.ok) {
      set({ busy: false, message: result.message ?? null });
      return { ok: false, message: result.message };
    }

    const settings = await setPrivacySettings({ enabled: true, biometric: true });
    const [passcodeSet, deviceStoreKind] = await describeDevicePath(true);
    set({
      busy: false,
      settings,
      keyringPresent: true,
      passcodeSet,
      deviceStoreKind,
      deviceUnlockReady: true,
      deviceAuthAvailable: true,
      unlocked: true,
      message: null,
    });
    syncScreenPrivacy(settings.secureScreen, true);
    return { ok: true };
  },

  addPasscode: async (passcode) => {
    set({ busy: true, message: null });
    const result = await addPasscodeRepo(passcode);
    if (!result.ok) {
      set({ busy: false, message: result.message ?? null });
      return { ok: false, message: result.message };
    }
    set({ busy: false, passcodeSet: true, message: null });
    return { ok: true };
  },

  disable: async (passcode) => {
    set({ busy: true, message: null });

    // Verify first: turning privacy off opens everything, and that must not be
    // something a passer-by can trigger on an unlocked phone. A vault with no
    // passcode proves presence the same way it opens every other time — with the
    // device prompt — so there is no path where "turn locking off" is a single
    // unauthenticated tap.
    if (!(await hasPasscodeWrap())) {
      const authenticator = await getDeviceAuthenticator();
      const outcome = await authenticator.authenticate('Turn off locking for your Stash vault');
      if (!outcome.ok) {
        set({ busy: false, message: outcome.message ?? 'That did not succeed.' });
        return { ok: false, message: outcome.message };
      }
      const deviceKey = await unlockWithDevice();
      if (!deviceKey) {
        const message = 'This device can no longer open the vault. Use a passcode, if one was added.';
        set({ busy: false, message });
        return { ok: false, message };
      }
    } else {
      const key = await unlockWithPasscode(passcode);
      if (!key) {
        set({ busy: false, message: 'That passcode did not match.' });
        return { ok: false, message: 'That passcode did not match.' };
      }
    }

    // Open every sealed row before the keyring goes, so nothing is left
    // ciphertext with no key in existence.
    await unsealEverything();
    await destroyKeyring();
    const settings = await setPrivacySettings({ enabled: false });

    set({
      busy: false,
      settings,
      keyringPresent: false,
      passcodeSet: false,
      unlocked: true,
      deviceUnlockReady: false,
      message: null,
    });
    syncScreenPrivacy(settings.secureScreen, true);
    return { ok: true };
  },

  unlock: async (passcode) => {
    set({ busy: true, message: null });
    // Asked of the keyring rather than of the cached flag: an import can adopt
    // a keyring underneath us, and the answer that matters is what is on disk.
    if (!(await hasPasscodeWrap())) {
      const message = 'This vault opens with your device lock. Use that, or add a passcode in Settings.';
      set({ busy: false, passcodeSet: false, message });
      return { ok: false, message };
    }
    // `null` covers both "no keyring" and "the GCM tag did not verify", which are
    // the same answer to the user: this passcode does not open this vault.
    const key = await unlockWithPasscode(passcode);
    if (!key) {
      set({ busy: false, message: 'That passcode did not match.' });
      return { ok: false, message: 'That passcode did not match.' };
    }
    const settings = get().settings;
    // The passcode path clears a queued reveal too, so the gate steps aside the
    // moment the item behind it becomes readable.
    set({ busy: false, unlocked: true, backgroundedAt: null, message: null, revealRequest: null });
    syncScreenPrivacy(settings.secureScreen, true);
    return { ok: true };
  },

  requestReveal: async (kind, id) => {
    // Asked of the session and of the keyring rather than of the cached flags:
    // an import can replace the keyring underneath us, and "is there anything to
    // unlock" is a fact about the key, not about the last render.
    if (!isSessionLocked() || !(await hasKeyring())) return { ok: true };

    // The device prompt first, because it is one deliberate act with nothing to
    // type. A cancelled prompt is *not* an error here: it just means the gate
    // takes over, with the passcode field already open.
    if (await isDeviceUnlockReady()) {
      const authenticator = await getDeviceAuthenticator();
      if (await authenticator.isAvailable()) {
        const result = await get().unlockWithBiometrics();
        if (result.ok) return result;
      }
    }

    set({ revealRequest: { kind, id } });
    return { ok: false, message: 'Unlock to open the locked item you tapped.' };
  },

  clearReveal: () => set({ revealRequest: null }),

  unlockWithBiometrics: async () => {
    set({ busy: true, message: null });
    const authenticator = await getDeviceAuthenticator();

    const outcome = await authenticator.authenticate('Unlock your Stash vault');
    if (!outcome.ok) {
      // A failed or cancelled prompt changes nothing: the vault stays locked and
      // the passcode field is still there. This is the whole failure-safety
      // story — there is no path from an auth failure to data loss.
      set({ busy: false, message: outcome.message ?? 'Authentication did not succeed.' });
      return { ok: false, message: outcome.message };
    }

    const key = await unlockWithDevice();
    if (!key) {
      // The prompt succeeded but the device key is gone (data cleared, restore
      // on a new phone, keystore entry invalidated). Fall back, do not damage.
      const deviceUnlockReady = await isDeviceUnlockReady();
      const message = (await hasPasscodeWrap())
        ? 'Your passcode is needed to open the vault on this device.'
        : 'This device can no longer open the vault, and no passcode was ever added. Locked items are unreadable.';
      set({ busy: false, deviceUnlockReady, message });
      return { ok: false, message };
    }

    const settings = get().settings;
    // A queued reveal is satisfied by the unlock it was waiting for: whatever
    // asked for it re-renders with real data one refresh later.
    set({ busy: false, unlocked: true, backgroundedAt: null, message: null, revealRequest: null });
    syncScreenPrivacy(settings.secureScreen, true);
    return { ok: true };
  },

  lock: () => {
    // Without a keyring there is nothing to lock: no key exists, so there is no
    // session to end, and locking would only produce a gate with no way through.
    if (!get().keyringPresent) return;
    // Drop the key. That is the entire mechanism — no plaintext is hidden behind
    // a boolean, the material to decrypt simply stops existing in this process.
    forgetVaultKey();
    const settings = get().settings;
    set({ unlocked: false, backgroundedAt: null, message: null });
    syncScreenPrivacy(settings.secureScreen, false);
  },

  handleBackground: (now = Date.now()) => {
    if (!get().unlocked) return;
    set({ backgroundedAt: now });
    // With `immediate`, lock now rather than on resume: Android may kill the
    // process while it is backgrounded, and a promise kept only on resume would
    // not survive that.
    if (shouldLockOnBackground(get().settings.relockPolicy)) get().lock();
  },

  handleForeground: (now = Date.now()) => {
    const state = get();
    if (!state.unlocked || state.backgroundedAt === null) return false;
    if (!shouldRelock(state.settings.relockPolicy, state.backgroundedAt, now)) {
      set({ backgroundedAt: null });
      return false;
    }
    get().lock();
    return true;
  },

  changePasscode: async (current, next) => {
    set({ busy: true, message: null });
    const result = await changePasscodeRepo(current, next);
    set({ busy: false, message: result.ok ? null : (result.message ?? null) });
    return result;
  },

  abandonLock: async () => {
    // No unsealing, no verification: this is the path for a forgotten passcode.
    // Locked items are not deleted — they become ciphertext nobody holds a key
    // for. That is data loss, which is why the UI says so in those words.
    await destroyKeyring();
    const settings = await setPrivacySettings({ enabled: false });
    set({
      settings,
      keyringPresent: false,
      passcodeSet: false,
      unlocked: true,
      deviceUnlockReady: false,
      message: null,
    });
    syncScreenPrivacy(settings.secureScreen, true);
  },

  armBiometrics: async () => {
    const ok = await enableDeviceUnlock();
    if (!ok) {
      return { ok: false, message: 'This device could not set up the unlock prompt, so nothing was armed.' };
    }
    const settings = await setPrivacySettings({ biometric: true });
    set({ settings, deviceUnlockReady: true });
    return { ok: true };
  },

  disarmBiometrics: async () => {
    await disableDeviceUnlock();
    const settings = await setPrivacySettings({ biometric: false });
    set({ settings, deviceUnlockReady: false });
  },

  update: async (patch) => {
    const settings = await setPrivacySettings(patch);
    set({ settings });
    syncScreenPrivacy(settings.secureScreen, get().unlocked);
  },

  clearMessage: () => set({ message: null }),
}));
