/**
 * Keystore-backed storage for the one secret that must outlive the session: the
 * device wrapping key.
 *
 * Why a seam instead of calling the plugin directly: the platform storage is the
 * only part of the privacy design that cannot be exercised on a desktop, so it
 * is behind an interface that tests can substitute. Everything above it — the
 * wrapping, the keyring, the policy — is real cryptography and is tested for
 * real.
 *
 * What is stored here is *never* a passcode and never raw vault content: it is a
 * random 256-bit key that exists only to seal the vault key for the biometric
 * fast path. On Android the plugin writes through `EncryptedSharedPreferences`,
 * whose master key lives in the Android Keystore, so the bytes are not readable
 * by pulling the app's data directory off a locked device.
 */
export interface SecureStore {
  readonly kind: 'native' | 'unavailable';
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
 * Resolve the secure store for this platform.
 *
 * Capacitor is imported lazily for the same reason the share bridge does it: the
 * web build must not pay for the native runtime, and a missing plugin has to
 * degrade to "biometrics unavailable" rather than a crash.
 */
export async function getSecureStore(): Promise<SecureStore> {
  if (cached) return cached;

  if (typeof window !== 'undefined') {
    try {
      const core = await import('@capacitor/core');
      if (core.Capacitor.isNativePlatform()) {
        const secureStorage = await import('capacitor-secure-storage-plugin');
        cached = createNativeSecureStore(secureStorage.SecureStoragePlugin);
        return cached;
      }
    } catch (error) {
      console.warn('[stash] secure storage unavailable', error);
    }
  }

  cached = UNAVAILABLE_SECURE_STORE;
  return cached;
}

/** Test seam, mirroring `setActiveShareBridge`. */
export function setSecureStore(store: SecureStore | null): void {
  cached = store;
}
