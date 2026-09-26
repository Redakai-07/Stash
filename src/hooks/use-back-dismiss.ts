'use client';

import { useEffect } from 'react';

/**
 * Android hardware back inside a sheet.
 *
 * Capacitor's WebView maps the hardware back button to history navigation, and
 * falls through to "exit the app" when there is nothing to go back to. By
 * pushing a sentinel history entry while a sheet is open, the back button
 * produces a `popstate` we can intercept and turn into "close the sheet" --
 * which is what every Android user expects. No extra native plugin required.
 */
export function useBackDismiss(open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    let handledByPop = false;
    window.history.pushState({ stashOverlay: true }, '');

    const onPop = () => {
      handledByPop = true;
      onDismiss();
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!handledByPop) {
        // The sheet was closed by the UI: consume the sentinel entry so the
        // next back press does not reopen the sheet.
        window.history.back();
      }
    };
  }, [open, onDismiss]);
}
