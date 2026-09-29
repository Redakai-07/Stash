import { db, SECURITY_KEYS, type ExportedKeyring, type KeyringRecord } from '@/db';
import {
  decryptString,
  deriveWrappingKey,
  encryptString,
  exportKeyBytes,
  fromBase64,
  generateVaultKey,
  importKeyBytes,
  isEncryptedPayload,
  newSalt,
  PBKDF2_ITERATIONS,
  randomBytes,
  toBase64,
} from './crypto';
import { getSecureStore } from './secure-store';
import { enrollDeviceCredential, forgetDeviceCredential, hasDeviceCredential } from './webauthn';

/**
 * The keyring: where the vault key lives, and how it is protected.
 *
 * Design, in one paragraph. A single random 256-bit AES key — the **vault key**
 * — encrypts every protected field. That key is never derived from a passcode
 * and never written anywhere in the clear. Instead it is *wrapped* (encrypted)
 * under one or two wrapping keys, and the resulting ciphertext is the only thing
 * persisted. Unwrapping is what "unlock" means. This is standard envelope
 * encryption: it keeps the data key's strength independent of any human secret,
 * and it makes changing a passcode a 32-byte re-wrap rather than a full-vault
 * re-encryption.
 *
 * **Two wraps, and they are alternatives.**
 *
 *  - `wrappedByPasscode` — a key derived from a Stash passcode via
 *    PBKDF2-SHA256. Portable: this is the wrap that travels in a backup, and the
 *    one that survives losing the device.
 *  - `wrappedByDevice` — a random 256-bit key held in platform storage, released
 *    only after the OS has verified the person holding the device (fingerprint,
 *    face, phone PIN, Windows Hello). Convenient: nothing to remember, nothing to
 *    type. Device-bound: never exported.
 *
 * A vault may have either, or both. **Device lock alone is a supported setup**
 * — locking that asks for the system prompt instead of a passcode you had to
 * invent — and its one cost is stated plainly wherever it is offered: with no
 * passcode wrap, a wiped device or a lost phone means the locked items are gone,
 * because nothing on earth can unwrap them. Adding a passcode later is a
 * Settings action, and it is what makes the vault portable again.
 *
 * Where keys live:
 *
 *  - the **vault key**, unwrapped: only in this module's memory, for the length
 *    of an unlocked session. It is never put in IndexedDB, localStorage, a
 *    Zustand snapshot, a log line or the DOM.
 *  - the **passcode**, as typed: never stored, never cached, never hashed for
 *    storage. It exists for the duration of one function call, and only its
 *    PBKDF2 output is used.
 *  - the **wrapped** vault key: in the `security` table, which is excluded from
 *    export, from import and from the in-memory snapshot by construction.
 *  - the **device key**: a random 256-bit key in platform storage — the Android
 *    Keystore on a phone, the app's own `security` table on a desktop (see
 *    `secure-store.ts`, which is explicit about the difference).
 */

const DEVICE_KEY_NAME = 'stash.privacy.deviceKey';

/**
 * The unwrapped vault key, in memory only.
 *
 * Module scope rather than a store so that nothing serialises it by accident: a
 * Zustand devtools snapshot or a React state dump cannot reach it.
 */
let vaultKey: CryptoKey | null = null;

export function getVaultKey(): CryptoKey | null {
  return vaultKey;
}

/** Clears the key. Called on lock, and on sign-out of the session. */
export function forgetVaultKey(): void {
  vaultKey = null;
}

/**
 * Whether the vault is currently unreadable.
 *
 * This is the app-wide "is the session locked" test, and it is deliberately a
 * statement about the key rather than about a flag someone could forget to
 * update: if we cannot decrypt, we are locked.
 */
export function isSessionLocked(): boolean {
  return vaultKey === null;
}

export async function readKeyring(): Promise<KeyringRecord | null> {
  const row = await db.security.get(SECURITY_KEYS.keyring);
  const value = row?.value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<KeyringRecord>;
  if (record.version !== 1) return null;
  // A keyring with no wrap at all would be a promise to unlock that nothing can
  // keep, so it is treated as absent rather than as a broken lock.
  const hasPasscodeWrap = Boolean(record.kdf) && isEncryptedPayload(record.wrappedByPasscode);
  const hasDeviceWrap = isEncryptedPayload(record.wrappedByDevice);
  if (!hasPasscodeWrap && !hasDeviceWrap) return null;
  return record as KeyringRecord;
}

/** Whether this vault can be opened without the device it was locked on. */
export async function hasPasscodeWrap(): Promise<boolean> {
  const keyring = await readKeyring();
  return Boolean(keyring?.wrappedByPasscode && keyring.kdf);
}

async function writeKeyring(record: KeyringRecord): Promise<void> {
  await db.security.put({ key: SECURITY_KEYS.keyring, value: record });
}

export async function hasKeyring(): Promise<boolean> {
  return (await readKeyring()) !== null;
}

/** Wrap `bytes` with `wrappingKey`, returning ciphertext only. */
async function wrapBytes(wrappingKey: CryptoKey, bytes: Uint8Array) {
  // The plaintext here is a base64 rendering of exactly 32 random bytes. It is
  // never derived from anything human, and it never leaves this function.
  return encryptString(wrappingKey, toBase64(bytes));
}

async function unwrapBytes(wrappingKey: CryptoKey, payload: Parameters<typeof decryptString>[1]) {
  return fromBase64(await decryptString(wrappingKey, payload));
}

export interface KeySetupResult {
  ok: boolean;
  message?: string;
}

/**
 * Create a keyring whose only wrap is a passcode.
 *
 * **Legacy / interop only.** The app no longer offers a passcode, because the
 * system prompt is a stronger gate and a second secret was one more thing to
 * lose. This exists for two reasons, both about not destroying old data:
 *
 *  - a vault created by an earlier build is opened by its passcode wrap, so the
 *    shape that writes it has to stay readable;
 *  - a backup file from an earlier build carries the same wrap, and adopting it
 *    has to produce a keyring this code can open.
 *
 * Nothing in the app calls it to set up locking any more; `createKeyringWithDevice`
 * is the only setup path. Refuses if a keyring already exists: replacing one
 * would make every currently-sealed item permanently unreadable, so there is no
 * code path that does it implicitly.
 */
export async function createKeyring(passcode: string): Promise<KeySetupResult> {
  if (await hasKeyring()) {
    return { ok: false, message: 'This vault is already locked.' };
  }
  const vault = await generateVaultKey();
  const salt = newSalt();
  const wrappingKey = await deriveWrappingKey(passcode, salt);
  const wrappedByPasscode = await wrapBytes(wrappingKey, await exportKeyBytes(vault));

  const now = Date.now();
  const record: KeyringRecord = {
    version: 1,
    kdf: { algorithm: 'PBKDF2-SHA256', salt: toBase64(salt), iterations: PBKDF2_ITERATIONS },
    wrappedByPasscode,
    createdAt: now,
    updatedAt: now,
  };
  await writeKeyring(record);
  vaultKey = vault;
  return { ok: true };
}

/**
 * Turn locking on using the device alone, with no passcode to invent.
 *
 * The vault key is wrapped under a device key and nothing else, which is what
 * makes "unlock" a system prompt instead of a text field. The cost is real and
 * is stated in the UI before this is called: there is no second way in, so
 * clearing the app's data, losing the device, or restoring onto a new one makes
 * the locked items permanently unreadable. That is the deliberate trade — a
 * person who cannot pass the system prompt should not be reading them anyway —
 * and it is why the screen that turns locking on says so in those words.
 */
export async function createKeyringWithDevice(): Promise<KeySetupResult> {
  if (await hasKeyring()) {
    return { ok: false, message: 'Locking is already set up for this vault.' };
  }

  const store = await getSecureStore();
  if (!(await store.isAvailable())) {
    return { ok: false, message: 'This device cannot store a key for a device lock.' };
  }

  const vault = await generateVaultKey();
  const deviceBytes = randomBytes(32);
  const deviceKey = await importKeyBytes(deviceBytes);
  const wrappedByDevice = await wrapBytes(deviceKey, await exportKeyBytes(vault));

  const now = Date.now();
  // Key first, then the record that refers to it: the other order could leave a
  // keyring promising a device unlock with no key behind it.
  await store.set(DEVICE_KEY_NAME, toBase64(deviceBytes));
  await writeKeyring({ version: 1, wrappedByDevice, createdAt: now, updatedAt: now });
  vaultKey = vault;
  return { ok: true };
}

/**
 * Unlock with the passcode.
 *
 * A wrong passcode produces `null` rather than an exception: the AES-GCM tag is
 * what tells us, and a failed tag is a routine outcome here, not an error. Data
 * is untouched either way — this function writes nothing. A vault with no
 * passcode wrap answers `null` for the same reason a wrong passcode does: this
 * way in is not available.
 */
export async function unlockWithPasscode(passcode: string): Promise<CryptoKey | null> {
  const keyring = await readKeyring();
  if (!keyring?.wrappedByPasscode || !keyring.kdf) return null;

  try {
    const wrappingKey = await deriveWrappingKey(
      passcode,
      fromBase64(keyring.kdf.salt),
      keyring.kdf.iterations,
    );
    const bytes = await unwrapBytes(wrappingKey, keyring.wrappedByPasscode);
    const vault = await importKeyBytes(bytes);
    vaultKey = vault;
    return vault;
  } catch {
    return null;
  }
}

/**
 * Unlock through the device key.
 *
 * This is convenience, not a second security tier: the device key sits in
 * platform storage, and reaching it already requires an unlocked device. The
 * system prompt — `BiometricPrompt` on a phone, Windows Hello on a desktop — is
 * what turns that into a deliberate act. If the device key is gone (app data
 * cleared, restore on a new device, keystore entry invalidated) this returns
 * `null` and the passcode is the way in. Nothing is destroyed by its absence,
 * and a vault that was set up device-only says so before the user relies on it.
 */
export async function unlockWithDevice(): Promise<CryptoKey | null> {
  const keyring = await readKeyring();
  if (!keyring?.wrappedByDevice) return null;

  const store = await getSecureStore();
  if (!(await store.isAvailable())) return null;
  const stored = await store.get(DEVICE_KEY_NAME);
  if (!stored) return null;

  try {
    const deviceKey = await importKeyBytes(fromBase64(stored));
    const bytes = await unwrapBytes(deviceKey, keyring.wrappedByDevice);
    const vault = await importKeyBytes(bytes);
    vaultKey = vault;
    return vault;
  } catch {
    // A stale device key (for example after a passcode reset elsewhere) is
    // useless, not dangerous. Drop it so the next attempt goes straight to the
    // passcode instead of failing twice.
    await store.remove(DEVICE_KEY_NAME);
    return null;
  }
}

/**
 * Whether the device fast path is currently usable here.
 *
 * Three things have to hold, and each of them can fail independently: there is a
 * device wrap in the keyring, the platform storage still has the key that opens
 * it, and — on a desktop — this machine still has the credential to prompt with.
 * A `true` from less than all three would put a button on the lock screen that
 * cannot work.
 */
export async function isDeviceUnlockReady(): Promise<boolean> {
  const store = await getSecureStore();
  if (!(await store.isAvailable())) return false;
  const keyring = await readKeyring();
  if (!keyring?.wrappedByDevice) return false;
  if ((await store.get(DEVICE_KEY_NAME)) === null) return false;
  if (store.kind === 'web') return hasDeviceCredential();
  return true;
}

/**
 * Arm the biometric fast path. Requires an unlocked session, since the vault key
 * has to be re-wrapped for the device.
 */
export async function enableDeviceUnlock(): Promise<boolean> {
  const keyring = await readKeyring();
  if (!keyring || !vaultKey) return false;

  const store = await getSecureStore();
  if (!(await store.isAvailable())) return false;

  const deviceBytes = randomBytes(32);
  const deviceKey = await importKeyBytes(deviceBytes);
  const wrappedByDevice = await wrapBytes(deviceKey, await exportKeyBytes(vaultKey));

  // Store the device key before recording the wrap: the reverse order could
  // leave a keyring promising a fast path that has no key behind it.
  await store.set(DEVICE_KEY_NAME, toBase64(deviceBytes));
  await writeKeyring({ ...keyring, wrappedByDevice, updatedAt: Date.now() });

  // On a desktop the prompt is a WebAuthn credential, and enrolling it is part
  // of arming the fast path: without it there is nothing for the OS to ask
  // about. A platform that cannot enrol leaves the device path unarmed, which
  // the passcode covers.
  if (store.kind === 'web') {
    const credential = await enrollDeviceCredential();
    if (!credential) {
      await store.remove(DEVICE_KEY_NAME);
      const current = await readKeyring();
      if (current) {
        const next: KeyringRecord = { ...current, updatedAt: Date.now() };
        delete next.wrappedByDevice;
        await writeKeyring(next);
      }
      return false;
    }
  }

  return true;
}

export async function disableDeviceUnlock(): Promise<void> {
  const store = await getSecureStore();
  await store.remove(DEVICE_KEY_NAME);
  await forgetDeviceCredential();
  const keyring = await readKeyring();
  if (!keyring) return;
  const next: KeyringRecord = { ...keyring, updatedAt: Date.now() };
  delete next.wrappedByDevice;
  await writeKeyring(next);
}

/** Remove the keyring. Only valid once every sealed row has been opened. */
export async function destroyKeyring(): Promise<void> {
  const store = await getSecureStore();
  await store.remove(DEVICE_KEY_NAME);
  // The enrolled WebAuthn credential goes with it: leaving it behind would keep
  // a prompt on this machine that unlocks nothing.
  await forgetDeviceCredential();
  await db.security.delete(SECURITY_KEYS.keyring);
  vaultKey = null;
}

/**
 * The exportable envelope: the passcode wrap only, never the device wrap.
 *
 * `null` when there is no passcode wrap — a device-locked vault has nothing
 * portable to hand over, and exporting a keyring without a key would promise the
 * receiving device an unlock it cannot perform. The import side already treats
 * sealed rows it cannot open as "locked", so the file stays honest either way;
 * the export screen says so before writing it.
 */
export function toExportedKeyring(keyring: KeyringRecord): ExportedKeyring | null {
  if (!keyring.kdf || !keyring.wrappedByPasscode) return null;
  return {
    version: 1,
    kdf: keyring.kdf,
    wrappedByPasscode: keyring.wrappedByPasscode,
  };
}

/**
 * Adopt a keyring that arrived in a backup.
 *
 * Only ever called when this device has none — taking over an existing keyring
 * would orphan everything already sealed here. The passcode from the original
 * device is what unlocks the adopted vault, and Stash says so before doing it.
 */
export async function adoptExportedKeyring(exported: ExportedKeyring | undefined): Promise<boolean> {
  if (!exported || !isEncryptedPayload(exported.wrappedByPasscode)) return false;
  if (await hasKeyring()) return false;

  const now = Date.now();
  await writeKeyring({
    version: 1,
    kdf: exported.kdf,
    wrappedByPasscode: exported.wrappedByPasscode,
    createdAt: now,
    updatedAt: now,
  });
  return true;
}
