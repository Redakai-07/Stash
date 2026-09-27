/**
 * Device authentication: fingerprint, face, iris, or the device PIN/pattern/
 * password.
 *
 * Stash does not verify a biometric itself — it cannot, and it must not try. It
 * hands the request to Android's `BiometricPrompt` (via the Capacitor plugin) and
 * reacts to the outcome. That is why the plugin is configured with
 * `allowDeviceCredential`, so a device without enrolled biometry still has a
 * usable path rather than a dead end.
 *
 * The result of a successful prompt is used as an *authorisation to unseal*, not
 * as a key. The vault key is unwrapped from Keystore-backed storage afterwards,
 * so the security of the data still rests on the platform keystore rather than on
 * a boolean this code returns.
 *
 * Failure is always recoverable: every outcome below simply leaves the vault
 * locked and the passcode available. Nothing here can delete or corrupt data.
 */
export type AuthFailureReason =
  | 'cancelled'
  | 'unavailable'
  | 'failed'
  /** Too many attempts: the OS has temporarily suspended biometry. */
  | 'lockout';

export interface AuthOutcome {
  ok: boolean;
  reason?: AuthFailureReason;
  /** Short, human-readable explanation for the lock screen. */
  message?: string;
}

export interface DeviceAuthenticator {
  readonly kind: 'native' | 'web';
  /** Whether device authentication could ever succeed on this device. */
  isAvailable(): Promise<boolean>;
  /** Prompt, and report what happened. Never throws. */
  authenticate(reason: string): Promise<AuthOutcome>;
}

const WEB_AUTHENTICATOR: DeviceAuthenticator = {
  kind: 'web',
  isAvailable: async () => false,
  authenticate: async () => ({
    ok: false,
    reason: 'unavailable',
    message: 'Device authentication is only available in the Android app.',
  }),
};

function mapErrorCode(code: string | undefined): AuthFailureReason {
  switch (code) {
    case 'userCancel':
    case 'appCancel':
    case 'systemCancel':
    case 'userFallback':
      return 'cancelled';
    case 'biometryLockout':
      return 'lockout';
    case 'biometryNotAvailable':
    case 'biometryNotEnrolled':
    case 'noDeviceCredential':
    case 'passcodeNotSet':
      return 'unavailable';
    default:
      return 'failed';
  }
}

function messageFor(reason: AuthFailureReason): string {
  switch (reason) {
    case 'cancelled':
      return 'Authentication was cancelled. Your vault is still locked.';
    case 'unavailable':
      return 'This device has no biometric or screen lock set up. Use your Stash passcode.';
    case 'lockout':
      return 'Too many attempts. Biometrics are paused — use your Stash passcode.';
    case 'failed':
    default:
      return 'That did not match. Use your Stash passcode.';
  }
}

function createNativeAuthenticator(module: {
  BiometricAuth: {
    checkBiometry(): Promise<{ isAvailable: boolean; deviceIsSecure: boolean }>;
    authenticate(options: Record<string, unknown>): Promise<void>;
  };
}): DeviceAuthenticator {
  const { BiometricAuth } = module;

  return {
    kind: 'native',
    isAvailable: async () => {
      try {
        const info = await BiometricAuth.checkBiometry();
        // Either enrolled biometry, or a device credential we can fall back to.
        return Boolean(info.isAvailable || info.deviceIsSecure);
      } catch {
        return false;
      }
    },
    authenticate: async (reason) => {
      try {
        // The plugin requires `checkBiometry()` to have run at least once before
        // `authenticate()`, so the prompt is always preceded by a capability read.
        await BiometricAuth.checkBiometry();
        await BiometricAuth.authenticate({
          reason,
          cancelTitle: 'Cancel',
          // The device PIN/pattern/password is offered inside the system dialog,
          // which is the "device credential integration" path.
          allowDeviceCredential: true,
          androidTitle: 'Unlock Stash',
          androidSubtitle: reason,
        });
        return { ok: true };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : undefined;
        const mapped = mapErrorCode(code === '' ? undefined : code);
        return { ok: false, reason: mapped, message: messageFor(mapped) };
      }
    },
  };
}

let cached: DeviceAuthenticator | null = null;

export async function getDeviceAuthenticator(): Promise<DeviceAuthenticator> {
  if (cached) return cached;

  if (typeof window !== 'undefined') {
    try {
      const core = await import('@capacitor/core');
      if (core.Capacitor.isNativePlatform()) {
        const biometric = await import('@aparajita/capacitor-biometric-auth');
        cached = createNativeAuthenticator(biometric);
        return cached;
      }
    } catch (error) {
      console.warn('[stash] device authentication unavailable', error);
    }
  }

  cached = WEB_AUTHENTICATOR;
  return cached;
}

/** Test seam. */
export function setDeviceAuthenticator(authenticator: DeviceAuthenticator | null): void {
  cached = authenticator;
}

/** Build a fake authenticator, used by tests to model success and failure. */
export function createStaticAuthenticator(
  outcome: AuthOutcome,
  options: { available?: boolean } = {},
): DeviceAuthenticator {
  return {
    kind: 'native',
    isAvailable: async () => options.available ?? true,
    authenticate: async () => outcome,
  };
}
