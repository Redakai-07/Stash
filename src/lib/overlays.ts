/**
 * The overlay stack.
 *
 * Sheets and the capture surface register a dismiss callback while they are
 * open; the hardware back button asks this stack who is on top, which is what
 * makes "back closes what is on top" work without every sheet having to know
 * anything about Android.
 *
 * Deliberately plain module state rather than a store: only the back handler
 * reads it, and nothing re-renders when it changes. Order is registration order,
 * and the last in is the one on screen.
 */

export type OverlayDismiss = () => void;

const stack: OverlayDismiss[] = [];

/** Put an overlay on top of the stack. Returns the handle that takes it off. */
export function pushOverlay(dismiss: OverlayDismiss): OverlayDismiss {
  stack.push(dismiss);
  return dismiss;
}

/** Take an overlay off the stack. A no-op if it is already gone. */
export function removeOverlay(dismiss: OverlayDismiss): void {
  const index = stack.lastIndexOf(dismiss);
  if (index !== -1) stack.splice(index, 1);
}

/**
 * Dismiss the topmost overlay.
 *
 * The boolean is the whole point: it tells the back handler whether back was
 * consumed by an overlay or whether it should keep walking — a screen further
 * out, or out of the app entirely.
 */
export function dismissTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  // Pop first: the dismiss callback closes a sheet, whose cleanup calls
  // `removeOverlay` — doing it here as well keeps that from mattering.
  stack.pop();
  top();
  return true;
}

/** How many overlays are open. Exists for tests and debugging. */
export function overlayDepth(): number {
  return stack.length;
}
