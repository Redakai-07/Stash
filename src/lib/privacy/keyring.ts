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

/**
 * The keyring: where the vault key lives, and how it is protected.
 *
 * Design, in one paragraph. A single random 256-bit AES key — the **vault key**
 * — encrypts every protected field. That key is never derived from the passcode
 * and never written anywhere in the clear. Instead it is *wrapped* (encrypted)
 * under a key derived from the passcode via PBKDF2-SHA256, and the resulting
 * ciphertext is the only thing persisted. Unlocking means deriving the passcode
 * key again and unwrapping. This is standard envelope encryption: it keeps the
 * data key's strength independent of passcode strength, and it makes changing
 * the passcode a 32-byte re-wrap instead of a full-vault re-encryption.
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
 *  - the **device key** (biometric fast path): a random 256-bit key in Android
 *    Keystore-backed storage, never in IndexedDB.
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
  if (!record.kdf || !isEncryptedPayload(record.wrappedByPasscode)) return null;
  return record as KeyringRecord;
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
 * Turn privacy on for the first time.
 *
 * Generates a fresh vault key and records the passcode wrapping. Refuses if a
 * keyring already exists: replacing one would make every currently-sealed item
 * permanently unreadable, so there is no code path that does it implicitly.
 */
export async function createKeyring(passcode: string): Promise<KeySetupResult> {
  if (await hasKeyring()) {
    return { ok: false, message: 'A passcode is already set for this vault.' };
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
 * Unlock with the passcode.
 *
 * A wrong passcode produces `null` rather than an exception: the AES-GCM tag is
 * what tells us, and a failed tag is a routine outcome here, not an error. Data
 * is untouched either way — this function writes nothing.
 */
export async function unlockWithPasscode(passcode: string): Promise<CryptoKey | null> {
  const keyring = await readKeyring();
  if (!keyring) return null;

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
 * Keystore-backed storage, and reaching it already requires an unlocked device.
 * The system prompt is what turns that into a deliberate act. If the device key
 * is gone — app data cleared, restore on a new device, Keystore entry
 * invalidated — this returns `null` and the passcode is the way in. Nothing is
 * destroyed by its absence.
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

/** Whether the biometric fast path is currently usable on this device. */
export async function isDeviceUnlockReady(): Promise<boolean> {
  const store = await getSecureStore();
  if (!(await store.isAvailable())) return false;
  const keyring = await readKeyring();
  if (!keyring?.wrappedByDevice) return false;
  return (await store.get(DEVICE_KEY_NAME)) !== null;
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
  return true;
}

export async function disableDeviceUnlock(): Promise<void> {
  const store = await getSecureStore();
  await store.remove(DEVICE_KEY_NAME);
  const keyring = await readKeyring();
  if (!keyring) return;
  const next: KeyringRecord = { ...keyring, updatedAt: Date.now() };
  delete next.wrappedByDevice;
  await writeKeyring(next);
}

/**
 * Change the passcode.
 *
 * The vault key itself does not change, so no content is re-encrypted: the same
 * 32 bytes are simply re-wrapped under a new derived key with a fresh salt. A
 * wrong old passcode fails the GCM tag and nothing is written.
 */
export async function changePasscode(oldPasscode: string, nextPasscode: string): Promise<KeySetupResult> {
  const keyring = await readKeyring();
  if (!keyring) return { ok: false, message: 'No passcode is set for this vault.' };

  let vaultBytes: Uint8Array;
  try {
    const oldWrapping = await deriveWrappingKey(
      oldPasscode,
      fromBase64(keyring.kdf.salt),
      keyring.kdf.iterations,
    );
    vaultBytes = await unwrapBytes(oldWrapping, keyring.wrappedByPasscode);
  } catch {
    return { ok: false, message: 'That is not the current passcode.' };
  }

  const salt = newSalt();
  const wrappingKey = await deriveWrappingKey(nextPasscode, salt);
  const wrappedByPasscode = await wrapBytes(wrappingKey, vaultBytes);

  await writeKeyring({
    ...keyring,
    kdf: { algorithm: 'PBKDF2-SHA256', salt: toBase64(salt), iterations: PBKDF2_ITERATIONS },
    wrappedByPasscode,
    updatedAt: Date.now(),
  });
  return { ok: true };
}

/** Remove the keyring. Only valid once every sealed row has been opened. */
export async function destroyKeyring(): Promise<void> {
  const store = await getSecureStore();
  await store.remove(DEVICE_KEY_NAME);
  await db.security.delete(SECURITY_KEYS.keyring);
  vaultKey = null;
}

/** The exportable envelope: passcode wrap only, never the device wrap. */
export function toExportedKeyring(keyring: KeyringRecord): ExportedKeyring {
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
