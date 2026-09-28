import { parseShare, type IncomingShare, type RawShareInput } from './parse';

/**
 * The seam between the operating system and the React application.
 *
 * Android's ACTION_SEND Intent is parsed in Java and handed over as a plain
 * object. Nothing in the component tree knows what an Intent extra is, so the
 * same capture flow works for a native share, a PWA share target, and a URL
 * opened during development.
 */
/** What Stash hands to another app. */
export interface SharePayload {
  text: string;
  /** Chooser heading. */
  title?: string;
  /** `EXTRA_SUBJECT`, used as the subject line by mail clients. */
  subject?: string;
}

export interface ShareBridge {
  readonly kind: 'capacitor' | 'web';
  /** Whether this bridge can ever deliver a share on the current platform. */
  isAvailable(): boolean;
  /** A share that launched the app and has not been consumed yet. */
  getPendingShare(): Promise<IncomingShare | null>;
  /** Mark the pending share consumed so it is not replayed on the next boot. */
  clearPendingShare(): Promise<void>;
  /** Shares that arrive while the app is already running. Returns an unsubscribe. */
  subscribe(listener: (share: IncomingShare) => void): () => void;
  /**
   * Hand content to the platform's share sheet. Resolves `false` when this
   * platform cannot, which is the signal for the caller to fall back to the
   * clipboard rather than a failure to report.
   */
  share(payload: SharePayload): Promise<boolean>;
}

/** Shape returned by the native Android plugin. */
interface NativeSharePayload {
  text?: string | null;
  subject?: string | null;
  sourcePackage?: string | null;
  receivedAt?: number | null;
}

const EMPTY_BRIDGE: ShareBridge = {
  kind: 'web',
  isAvailable: () => false,
  getPendingShare: async () => null,
  clearPendingShare: async () => undefined,
  subscribe: () => () => undefined,
  share: async () => false,
};

/**
 * The Web Share API, when the browser has it.
 *
 * Kept separate from the incoming-share bridge because the two are genuinely
 * different capabilities: a browser can be able to send shares and unable to
 * receive them, which is the normal case for the installable PWA.
 */
async function shareViaWebApi(payload: SharePayload): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({
      text: payload.text,
      ...(payload.title ? { title: payload.title } : {}),
    });
    return true;
  } catch {
    // `AbortError` means the user dismissed the sheet, which is a decision, not
    // a failure — either way the clipboard fallback is the wrong answer here, so
    // this reports "handled" and the caller stops.
    return true;
  }
}

/**
 * Bridges that are only meaningful in specific environments are registered
 * here. The application asks for *a* bridge and never for a platform.
 */
export function createWebShareBridge(search = typeof window === 'undefined' ? '' : window.location.search): ShareBridge {
  // The PWA share_target (and manual testing) delivers `?text=&title=&url=`.
  const params = new URLSearchParams(search);
  const rawText = params.get('text') ?? params.get('url') ?? '';
  const title = params.get('title') ?? '';
  if (!rawText && !title) return EMPTY_BRIDGE;

  const input: RawShareInput = {
    text: title && !rawText.includes(title) ? `${title} ${rawText}`.trim() : rawText,
    subject: title,
  };
  const share = parseShare(input);
  let pending: IncomingShare | null = share.urls.length > 0 || share.rawText ? share : null;

  return {
    kind: 'web',
    isAvailable: () => true,
    getPendingShare: async () => pending,
    clearPendingShare: async () => {
      pending = null;
      // Strip the payload from the address bar so a reload does not replay it.
      try {
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState(null, '', url.pathname);
      } catch {
        /* history is unavailable: nothing to clean up */
      }
    },
    subscribe: () => () => undefined,
    share: (payload) => shareViaWebApi(payload),
  };
}

/**
 * Resolve the bridge for the current platform. Capacitor is loaded lazily so
 * the web build never pays for it and a missing native plugin degrades to
 * "no incoming shares" instead of a crash.
 */
export async function getShareBridge(): Promise<ShareBridge> {
  if (typeof window === 'undefined') return EMPTY_BRIDGE;

  try {
    const core = await import('@capacitor/core');
    if (core.Capacitor.isNativePlatform()) {
      return createCapacitorShareBridge(core);
    }
  } catch {
    /* running on the web, or Capacitor failed to load */
  }

  return createWebShareBridge();
}

export interface NativeShareApi {
  getPendingShare(): Promise<{ share: NativeSharePayload | null }>;
  clearPendingShare(): Promise<void>;
  /** Opens Android's chooser. Rejects when no target can receive the content. */
  shareOut(payload: SharePayload): Promise<void>;
  addListener(
    eventName: 'shareReceived',
    listener: (payload: NativeSharePayload) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export function createCapacitorShareBridge(core: {
  registerPlugin: <T>(name: string) => T;
}): ShareBridge {
  const plugin = core.registerPlugin<NativeShareApi>('ShareReceiver');

  return {
    kind: 'capacitor',
    isAvailable: () => true,
    getPendingShare: async () => {
      try {
        const result = await plugin.getPendingShare();
        const payload = result?.share ?? null;
        if (!payload) return null;
        return parseShare(payload);
      } catch (error) {
        console.warn('[stash] could not read pending share', error);
        return null;
      }
    },
    clearPendingShare: async () => {
      try {
        await plugin.clearPendingShare();
      } catch (error) {
        console.warn('[stash] could not clear pending share', error);
      }
    },
    share: async (payload) => {
      try {
        await plugin.shareOut(payload);
        return true;
      } catch (error) {
        // A build whose native side predates `shareOut` lands here, as does a
        // device with nothing to share to. Either way the caller's clipboard
        // fallback is the better answer than an error message.
        console.warn('[stash] native share unavailable', error);
        return false;
      }
    },
    subscribe: (listener) => {
      let handle: { remove: () => Promise<void> } | null = null;
      let cancelled = false;

      void plugin
        .addListener('shareReceived', (payload) => {
          const share = parseShare(payload);
          if (share.urls.length > 0 || share.rawText.trim().length > 0) listener(share);
        })
        .then((registration) => {
          if (cancelled) void registration.remove();
          else handle = registration;
        })
        .catch((error) => {
          console.warn('[stash] could not subscribe to shares', error);
        });

      return () => {
        cancelled = true;
        if (handle) void handle.remove();
      };
    },
  };
}

/** The bridge instance used by the running app. */
let activeBridge: ShareBridge | null = null;

export async function getActiveShareBridge(): Promise<ShareBridge> {
  if (!activeBridge) activeBridge = await getShareBridge();
  return activeBridge;
}

/** Test seam. */
export function setActiveShareBridge(bridge: ShareBridge | null): void {
  activeBridge = bridge;
}
