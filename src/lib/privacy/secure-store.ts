import { db } from '@/db';

/**
 * Keystore-backed storage for the one secret that must outlive the session: the
 * device wrapping key.
 *
 * Why a seam instead of calling the plugin directly: the platform storage is the
 * only part of the privacy design that is not pure cryptography, so it is behind
 * an interface that tests can substitute. Everything above it — the wrapping,
 * the keyring, the policy — is real cryptography and is tested for real.
 *
 * What is stored here is *never* a passcode and never raw vault content: it is a
 * random 256-bit key that exists only to seal the vault key for the device-unlock
 * fast path.
 *
 * **Two kinds of storage, and they are not equally strong.** On Android the
 * plugin writes through `EncryptedSharedPreferences`, whose master key lives in
 * the Android Keystore, so the bytes are not readable by pulling the app's data
 * directory off a locked device. On a desktop there is no keystore to reach for,
 * so the key is kept in the app's own `security` table and the strength of the
 * device lock is the strength of the OS user account behind it — which is why
 * the desktop store reports `kind: 'web'`, the UI says so, and a Stash passcode
 * remains the portable secret wherever one is set.
 */
export interface SecureStore {
  readonly kind: 'native' | 'web' | 'unavailable';
  isAvailable(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Stand-in for platforms with no secure storage (a desktop browser, or a native
 * platform where the plugin failed to load).
 *
 * `set` deliberately does nothing rather than falling back to localStorage. A
 * silent downgrade to plaintext storage is exactly the failure mode this whole
 * design exists to avoid, so the biometry path simply becomes unavailable and
 * the passcode remains the only way in.
 */
export const UNAVAILABLE_SECURE_STORE: SecureStore = {
  kind: 'unavailable',
  isAvailable: async () => false,
  get: async () => null,
  set: async () => undefined,
  remove: async () => undefined,
};

function createNativeSecureStore(plugin: {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(options: { key: string }): Promise<{ value: boolean }>;
}): SecureStore {
  return {
    kind: 'native',
    isAvailable: async () => true,
    get: async (key) => {
      try {
        const result = await plugin.get({ key });
        return typeof result?.value === 'string' ? result.value : null;
      } catch {
        // A missing key rejects on Android. That is "no value", not an error.
        return null;
      }
    },
    set: async (key, value) => {
      await plugin.set({ key, value });
    },
    remove: async (key) => {
      try {
        await plugin.remove({ key });
      } catch {
        /* removing something absent is not a failure */
      }
    },
  };
}

let cached: SecureStore | null = null;

/**
 * The desktop store: the app's own `security` table.
 *
 * No encryption beyond the database itself, and that is stated rather than
 * implied — the table is excluded from export, import and the snapshot, exactly
 * like the keyring, so the key never travels. It is only ever written *after* a
 * platform prompt has enrolled a credential, so reaching it in short order means
 * unlocking the machine, and then the vault prompt on top.
 */
function createWebSecureStore(): SecureStore {
  const prefix = 'secure.';
  return {
    kind: 'web',
    // A browser always has IndexedDB here — the vault itself is in it.
    isAvailable: async () => typeof indexedDB !== 'undefined',
    get: async (key) => {
      try {
        const row = await db.security.get(`${prefix}${key}`);
        return typeof row?.value === 'string' ? row.value : null;
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      await db.security.put({ key: `${prefix}${key}`, value });
    },
    remove: async (key) => {
      try {
        await db.security.delete(`${prefix}${key}`);
      } catch {
        /* removing something absent is not a failure */
      }
    },
  };
}

/**
 * Resolve the secure store for this platform.
 *
 * Capacitor is imported lazily for the same reason the share bridge does it: the
 * web build must not pay for the native runtime, and a missing plugin has to
 * degrade to "biometrics unavailable" rather than a crash.
 *
 * A native platform whose plugin failed to load stays `unavailable` instead of
 * falling back to the web store: on a phone the Keystore is the whole point, and
 * silently substituting weaker storage would be a downgrade nobody asked for.
 */
export async function getSecureStore(): Promise<SecureStore> {
  if (cached) return cached;

  if (typeof window !== 'undefined') {
    try {
      const core = await import('@capacitor/core');
      if (core.Capacitor.isNativePlatform()) {
        try {
          const secureStorage = await import('capacitor-secure-storage-plugin');
          cached = createNativeSecureStore(secureStorage.SecureStoragePlugin);
        } catch (error) {
          console.warn('[stash] secure storage unavailable', error);
          cached = UNAVAILABLE_SECURE_STORE;
        }
        return cached;
      }
    } catch {
      /* no Capacitor runtime: this is a browser */
    }
    cached = createWebSecureStore();
    return cached;
  }

  cached = UNAVAILABLE_SECURE_STORE;
  return cached;
}

/** Test seam, mirroring `setActiveShareBridge`. */
export function setSecureStore(store: SecureStore | null): void {
  cached = store;
}
