'use client';

import * as React from 'react';
import { getActiveShareBridge } from '@/lib/share/bridge';
import { useCaptureStore } from '@/stores/capture-store';
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

  React.useEffect(() => {
    void initializeTheme();
    void initialize();
  }, [initialize, initializeTheme]);

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
      <div className="animate-pop-in flex size-14 items-center justify-center rounded-2xl bg-accent-soft">
        <svg viewBox="0 0 24 24" className="size-7 text-accent" aria-hidden>
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
      <p className="text-sm text-subtle">Opening your vault…</p>
    </div>
  );
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const status = useVaultStore((state) => state.status);
  const error = useVaultStore((state) => state.error);

  if (status === 'error') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <p className="text-base font-semibold text-fg">Could not open the local vault</p>
        <p className="text-sm text-muted">{error}</p>
        <p className="text-xs text-subtle">
          Stash stores everything on this device. Check that storage is not full and try again.
        </p>
      </div>
    );
  }

  if (status === 'booting') return <BootSplash />;
  return <>{children}</>;
}
