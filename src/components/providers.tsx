'use client';

import * as React from 'react';
import { getActiveShareBridge } from '@/lib/share/bridge';
import { useCaptureStore } from '@/stores/capture-store';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useThemeStore } from '@/stores/theme-store';
import { useVaultStore } from '@/stores/vault-store';

/**
 * Boot sequence.
 *
 * Order matters: IndexedDB opens and seeds first, the theme is applied before
 * anything is painted so there is no light flash on a dark device, and only
 * then is a share from Android consumed -- by which point the folder list is in
 * memory and the Save Sheet can render fully populated on its first frame.
 */
export function AppBoot({ children }: { children: React.ReactNode }) {
  const initialize = useVaultStore((state) => state.initialize);
  const refresh = useVaultStore((state) => state.refresh);
  const initializeTheme = useThemeStore((state) => state.initialize);
  const initializePrivacy = usePrivacyStore((state) => state.initialize);

  React.useEffect(() => {
    // Sequential because the privacy session has to be resolved *before* the
    // vault is read: the read decides what is decryptable, and reading first
    // would either show locked items or blank ones depending on timing.
    void (async () => {
      await initializeTheme();
      await initialize();
      await initializePrivacy();
    })();
  }, [initialize, initializePrivacy, initializeTheme]);

  // Re-read the vault when the app comes back to the foreground: Android may
  // have killed and restored the process while another app was on screen.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && useVaultStore.getState().status === 'ready') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return <>{children}</>;
}

/**
 * Keeps the vault in step with the privacy session.
 *
 * Two jobs, and both are about the session, not about the UI:
 *
 *  1. when the session locks or unlocks, the vault is re-read — which is what
 *     removes locked items from every screen, because they are filtered out of
 *     the store rather than hidden by a component;
 *  2. when the app leaves the foreground, the re-lock policy is applied.
 *
 * Android may also kill the process while backgrounded, so the app state
 * listener and the web `visibilitychange` event are both wired: the native event
 * is authoritative when it fires, and the web one covers the PWA and desktop
 * builds where there is no Capacitor runtime.
 */
export function PrivacySession() {
  React.useEffect(() => {
    return usePrivacyStore.subscribe((state, previous) => {
      if (state.unlocked === previous.unlocked) return;
      void useVaultStore.getState().refresh();
    });
  }, []);

  React.useEffect(() => {
    const privacy = () => usePrivacyStore.getState();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') privacy().handleBackground();
      else privacy().handleForeground();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let detach: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const core = await import('@capacitor/core');
        if (!core.Capacitor.isNativePlatform()) return;
        const app = await import('@capacitor/app');
        const handle = await app.App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            privacy().handleForeground();
            void privacy().refreshCapabilities();
          } else {
            privacy().handleBackground();
          }
        });
        if (cancelled) void handle.remove();
        else detach = () => void handle.remove();
      } catch {
        /* no native app state: the web listener is enough */
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (detach) detach();
    };
  }, []);

  return null;
}

/**
 * Turns an incoming Android share into the capture flow.
 *
 * `receivedAt` on the normalized share lets us ignore a payload that is being
 * replayed from a stale process restoration.
 */
const MAX_SHARE_AGE_MS = 4 * 60 * 1000;

export function ShareListener() {
  const status = useVaultStore((state) => state.status);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (status !== 'ready' || started.current) return;
    started.current = true;

    let unsubscribe: () => void = () => undefined;
    let cancelled = false;

    void (async () => {
      const bridge = await getActiveShareBridge();
      if (cancelled) return;

      unsubscribe = bridge.subscribe((share) => {
        // Warm start: the app is already running behind another app.
        void useCaptureStore.getState().openFromShare(share);
      });

      const pending = await bridge.getPendingShare();
      if (cancelled || !pending) return;

      const age = Date.now() - pending.receivedAt;
      if (age < MAX_SHARE_AGE_MS) {
        await useCaptureStore.getState().openFromShare(pending);
      }
      // Consume it either way so a restart does not replay a stale share.
      await bridge.clearPendingShare();
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [status]);

  return null;
}

/** Shown while IndexedDB opens. Kept to a mark and a pulse: never a spinner wall. */
export function BootSplash() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg">
      {/* The mark alone, with no tinted tile behind it: on a screen that shows
          nothing else, a coloured rounded square would be the loudest object in
          the app and would say nothing. */}
      <div className="animate-pop-in">
        <svg viewBox="0 0 24 24" className="size-9 text-accent" aria-hidden>
          <path
            d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M13 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-body text-subtle">Opening your vault…</p>
    </div>
  );
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const status = useVaultStore((state) => state.status);
  const error = useVaultStore((state) => state.error);
  // The vault is readable before the privacy session is resolved, but rendering
  // then would flash the shell for a frame before the lock gate covers it. On a
  // cold start with a passcode set, the very first painted frame should already
  // be the lock screen.
  const privacyReady = usePrivacyStore((state) => state.ready);

  if (status === 'error') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <p className="text-title font-semibold text-fg">Could not open the local vault</p>
        <p className="text-body text-muted">{error}</p>
        <p className="text-meta text-subtle">
          Stash stores everything on this device. Check that storage is not full and try again.
        </p>
      </div>
    );
  }

  if (status === 'booting' || !privacyReady) return <BootSplash />;
  return <>{children}</>;
}
