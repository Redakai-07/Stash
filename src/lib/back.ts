/**
 * What the hardware back button does.
 *
 * Split out from the component that listens, because this is the part with
 * opinions in it: back closes what is on top, then walks the screen hierarchy,
 * and only leaves the app from the top of it — on the second press, because a
 * single press should never drop someone out of a half-written note.
 */

export type BackAction =
  /** A sheet, a dialog or the capture surface was on top: it is now closed. */
  | 'dismiss-overlay'
  /** Previous screen. */
  | 'go-back'
  /** No history to walk (a cold start into a deep screen): go to Home instead. */
  | 'go-home'
  /** Nothing left to walk: say that one more press leaves. */
  | 'confirm-exit'
  /** The hint was already given: leave. */
  | 'exit';

/** How long the "press back again" hint stays good for. */
export const EXIT_WINDOW_MS = 2000;

export interface BackContext {
  /** Current route. `/` is the top of the hierarchy. */
  pathname: string;
  /** Whether the WebView has a previous entry to return to. */
  canGoBack: boolean;
  /** Whether any overlay is currently open. */
  overlayOpen: boolean;
  /**
   * Milliseconds since the exit hint was shown, or `Infinity` if it never was.
   */
  msSinceExitPrompt: number;
}

export function decideBack(context: BackContext): BackAction {
  if (context.overlayOpen) return 'dismiss-overlay';
  if (context.pathname !== '/') return context.canGoBack ? 'go-back' : 'go-home';
  return context.msSinceExitPrompt < EXIT_WINDOW_MS ? 'exit' : 'confirm-exit';
}
