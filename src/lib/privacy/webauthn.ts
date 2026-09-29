'use client';

import { db, SECURITY_KEYS } from '@/db';

/**
 * The desktop equivalent of a fingerprint.
 *
 * On Android, "unlock with your device" means Android's own `BiometricPrompt`,
 * which can fall back to the phone's PIN, pattern or password. A browser has no
 * such thing — but it does have **WebAuthn with a platform authenticator**,
 * which is the same idea expressed portably: Windows Hello (face, fingerprint or
 * the Windows PIN), Touch ID on a Mac, and the equivalent on Linux with a
 * configured authenticator. Chrome and Edge raise that prompt for
 * `navigator.credentials.get()` with `userVerification: 'required'`.
 *
 * What this is not: a second cryptographic tier. WebAuthn does not hand out a
 * symmetric secret, so the device key that actually unwraps the vault key is
 * stored locally (see `secure-store.ts`) and the WebAuthn check is the *gate*
 * in front of it — the same shape as the phone path, where the prompt authorises
 * the unwrap rather than being the key. On a phone the bytes behind that gate sit
 * in the Android Keystore; on a desktop they sit in the app's own storage, so the
 * honest description is "as strong as your OS user account". A Stash passcode,
 * where one is set, remains the portable secret.
 *
 * Nothing here is enrolled until the user asks for device unlock, and everything
 * degrades to "the passcode still works" if the platform cannot do it.
 */

const RP_NAME = 'Stash';
const RP_DISPLAY_NAME = 'Your Stash vault';
/** Long enough for a human to read the dialog, short enough not to hang the UI. */
const TIMEOUT_MS = 60_000;

interface StoredCredential {
  /** Base64url of `rawId`. The public half lives in the authenticator. */
  id: string;
  createdAt: number;
}

interface CredentialContainer {
  readonly id: string;
  readonly rawId: ArrayBuffer;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// `Uint8Array<ArrayBuffer>` rather than the default `Uint8Array<ArrayBufferLike>`:
// WebAuthn's buffer types reject a view that might be backed by a shared buffer.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A fresh challenge every time. It is never verified here — see the note below. */
function newChallenge(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Whether this platform can prompt at all.
 *
 * Two conditions and neither is negotiable: WebAuthn needs a secure context
 * (`https` or `localhost`) and the device needs an enrolled platform
 * authenticator. A machine without Windows Hello or a PIN configured correctly
 * reports `false`, and Stash then simply does not offer the device path.
 */
export async function isDevicePromptSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext) return false;
  if (typeof window.PublicKeyCredential !== 'function') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function readStoredCredential(): Promise<StoredCredential | null> {
  try {
    const row = await db.security.get(SECURITY_KEYS.deviceCredential);
    const value = row?.value as Partial<StoredCredential> | undefined;
    if (!value || typeof value.id !== 'string' || value.id.length === 0) return null;
    return { id: value.id, createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0 };
  } catch {
    return null;
  }
}

export async function hasDeviceCredential(): Promise<boolean> {
  return (await readStoredCredential()) !== null;
}

export async function forgetDeviceCredential(): Promise<void> {
  try {
    await db.security.delete(SECURITY_KEYS.deviceCredential);
  } catch {
    /* nothing enrolled is not a failure */
  }
}

/**
 * Enrol this device.
 *
 * Called once, while the vault is unlocked and the user has just accepted the
 * prompt, so the credential is created by the same act that arms the fast path.
 * Returns the credential id, or `null` when the platform declined (no
 * authenticator, user cancelled, or credentials unsupported on the RP id).
 */
export async function enrollDeviceCredential(): Promise<string | null> {
  if (!(await isDevicePromptSupported())) return null;

  // The user handle is random and meaningless: this credential never leaves the
  // machine and identifies nobody. Resident keys are preferred so the credential
  // is discoverable, but not required — the id is stored here anyway.
  const userId = newChallenge();

  try {
    const created = (await navigator.credentials.create({
      publicKey: {
        challenge: newChallenge(),
        rp: { name: RP_NAME },
        user: { id: userId, name: 'stash-device', displayName: RP_DISPLAY_NAME },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: TIMEOUT_MS,
        attestation: 'none',
      },
    })) as CredentialContainer | null;

    if (!created) return null;
    const id = toBase64Url(created.rawId);
    await db.security.put({
      key: SECURITY_KEYS.deviceCredential,
      value: { id, createdAt: Date.now() } satisfies StoredCredential,
    });
    return id;
  } catch (error) {
    console.warn('[stash] could not enrol a device credential', error);
    return null;
  }
}

export type DevicePromptOutcome = 'ok' | 'cancelled' | 'unavailable' | 'failed';

/**
 * Raise the platform prompt.
 *
 * The assertion is **not cryptographically verified**, and it cannot be without
 * a server to check the signature against. What it proves is what it needs to:
 * the person holding the device satisfied the OS's own user-verification
 * requirement a moment ago, and the OS only releases that answer for this
 * origin. The data's actual protection stays where it was — behind the wrapping
 * key — which is why an unverified assertion is an acceptable gate here and
 * would not be acceptable as an authentication factor anywhere else.
 */
export async function promptDeviceCredential(): Promise<DevicePromptOutcome> {
  const stored = await readStoredCredential();
  if (!stored) return 'unavailable';
  if (!(await isDevicePromptSupported())) return 'unavailable';

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: newChallenge(),
        allowCredentials: [
          { type: 'public-key', id: fromBase64Url(stored.id), transports: ['internal'] },
        ],
        userVerification: 'required',
        timeout: TIMEOUT_MS,
      },
    });
    return assertion ? 'ok' : 'cancelled';
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    switch (name) {
      case 'NotAllowedError':
        // Covers both "user dismissed" and "timed out"; the OS does not
        // distinguish them, so neither does this.
        return 'cancelled';
      case 'SecurityError':
      case 'NotSupportedError':
      case 'InvalidStateError':
        return 'unavailable';
      default:
        return 'failed';
    }
  }
}
