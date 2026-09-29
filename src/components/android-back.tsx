'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { decideBack } from '@/lib/back';
import { dismissTopOverlay, overlayDepth } from '@/lib/overlays';
import { toast } from './ui/toast';

/**
 * The Android back button, in one place.
 *
 * Left alone, back is a WebView history lookup: with nothing to go back to it
 * either does nothing or — when no plugin has claimed the button — finishes the
 * Activity, which is how a single tap used to close the app from the middle of
 * a folder tree or a half-written note.
 *
 * Registering a listener here is what claims the button: Capacitor's App plugin
 * defers to the web layer as soon as one exists, so from this point on back
 * means whatever `decideBack` says it means (see `src/lib/back.ts`).
 *
 * The listener is registered once for the life of the app; the route is read
 * through a ref so navigating does not tear it down and rebuild it. On the web
 * this component does nothing at all — the browser's own back is already right,
 * and the sheets handle it through the history sentinel in `useBackDismiss`.
 */

export function AndroidBack(): null {
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  const pathRef = React.useRef(pathname);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    let detach: (() => void) | null = null;
    let cancelled = false;
    let exitPromptedAt = 0;

    void (async () => {
      const core = await import('@capacitor/core');
      if (!core.Capacitor.isNativePlatform()) return;

      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', ({ canGoBack }) => {
        const action = decideBack({
          pathname: pathRef.current,
          canGoBack,
          // Reading the stack here rather than tracking it in state keeps this
          // handler independent of React's render cycle: the answer is only
          // ever needed at the moment the button is pressed.
          overlayOpen: overlayDepth() > 0,
          msSinceExitPrompt: exitPromptedAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - exitPromptedAt,
        });

        switch (action) {
          case 'dismiss-overlay':
            dismissTopOverlay();
            return;
          case 'go-back':
            router.back();
            return;
          case 'go-home':
            router.push('/');
            return;
          case 'exit':
            void App.exitApp();
            return;
          case 'confirm-exit':
            exitPromptedAt = Date.now();
            toast('Press back again to leave Stash');
            return;
        }
      });

      if (cancelled) void handle.remove();
      else detach = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      if (detach) detach();
    };
  }, [router]);

  return null;
}
