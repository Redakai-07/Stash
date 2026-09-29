'use client';

import { useEffect, useRef } from 'react';
import { pushOverlay, removeOverlay } from '@/lib/overlays';

/**
 * Android hardware back inside a sheet.
 *
 * Two mechanisms, because a WebView and a native app do not agree on what back
 * means:
 *
 *  - **On Android**, the app's own back handler owns the button (`AndroidBack`)
 *    and asks the overlay stack who is on top. That is more reliable than
 *    hoping the WebView's history matches what is on screen — which is exactly
 *    what used to make back close the app from anywhere.
 *  - **In a browser or as a PWA**, back *is* history navigation, so a sentinel
 *    entry is pushed while the sheet is open and the resulting `popstate` is
 *    read as "close the sheet".
 *
 * Both end in the same place: the sheet's dismiss callback, once.
 *
 * The sentinel is the delicate part. Consuming it means calling
 * `history.back()`, which is a real navigation if the sentinel is no longer on
 * top of the stack — so it is only ever called while the current entry is
 * verifiably ours, and only after a beat, because React in development
 * deliberately mounts, unmounts and remounts an effect. Without that beat, the
 * mount's own cleanup would go back and its remount would read the resulting
 * `popstate` as a back press, closing every sheet the moment it opened.
 */

/** Marks a history entry this hook pushed. Never set by anything else. */
interface SentinelState {
  stashOverlay?: boolean;
}

function isOurSentinel(): boolean {
  const state = window.history.state as SentinelState | null;
  return state !== null && state.stashOverlay === true;
}

export function useBackDismiss(open: boolean, onDismiss: () => void): void {
  // Latest callback without re-subscribing: the effect below is keyed on `open`
  // alone, because re-registering on every render would push a second history
  // entry and make one back press look like two.
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  }, [onDismiss]);

  // A pending "consume the sentinel" that a re-run of the effect cancels. React
  // in development mounts, unmounts and remounts an effect on purpose; without
  // this, the mount's own cleanup would go back and the remount would read the
  // resulting `popstate` as a back press, closing the sheet the moment it
  // opened.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }

    const entry = pushOverlay(() => latest.current());

    let handledByPop = false;
    window.history.pushState({ stashOverlay: true }, '');

    const onPop = () => {
      handledByPop = true;
      latest.current();
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      removeOverlay(entry);
      if (handledByPop) return;

      // The sheet was closed by the UI: consume the sentinel so the next back
      // press does not reopen it. Deferred by a beat so a remount can cancel it,
      // and guarded so it can never navigate away from a page that moved on.
      pending.current = window.setTimeout(() => {
        pending.current = null;
        if (isOurSentinel()) window.history.back();
      }, 0);
    };
  }, [open]);
}
