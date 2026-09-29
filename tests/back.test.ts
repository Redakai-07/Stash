import { describe, expect, it } from 'vitest';
import { decideBack, EXIT_WINDOW_MS } from '@/lib/back';
import { dismissTopOverlay, overlayDepth, pushOverlay, removeOverlay } from '@/lib/overlays';

/**
 * The hardware back button.
 *
 * These are the rules the app promises: back closes what is on top, then walks
 * the hierarchy, and only leaves the app from the top of it — twice. The old
 * behaviour (close the app from anywhere) is exactly what must not come back.
 */
describe('decideBack', () => {
  const base = { pathname: '/library', canGoBack: true, overlayOpen: false, msSinceExitPrompt: Number.POSITIVE_INFINITY };

  it('closes an open overlay before anything else, wherever it was opened from', () => {
    expect(decideBack({ ...base, overlayOpen: true })).toBe('dismiss-overlay');
    expect(decideBack({ ...base, overlayOpen: true, pathname: '/' })).toBe('dismiss-overlay');
  });

  it('walks the screen hierarchy when there is history', () => {
    expect(decideBack(base)).toBe('go-back');
    expect(decideBack({ ...base, pathname: '/settings' })).toBe('go-back');
    expect(decideBack({ ...base, pathname: '/notes' })).toBe('go-back');
  });

  it('falls back to Home when a deep screen was opened cold, with no history', () => {
    // This is the incoming-share case: the app starts straight into a screen.
    expect(decideBack({ ...base, canGoBack: false })).toBe('go-home');
  });

  it('never leaves the app from a screen inside it', () => {
    const actions = [
      decideBack({ ...base, pathname: '/library', canGoBack: true }),
      decideBack({ ...base, pathname: '/library', canGoBack: false }),
      decideBack({ ...base, pathname: '/trash', canGoBack: true }),
    ];
    expect(actions).not.toContain('exit');
    expect(actions).not.toContain('confirm-exit');
  });

  it('asks before leaving from Home, then leaves on the second press', () => {
    const home = { ...base, pathname: '/', canGoBack: false };
    expect(decideBack(home)).toBe('confirm-exit');
    expect(decideBack({ ...home, msSinceExitPrompt: 0 })).toBe('exit');
    expect(decideBack({ ...home, msSinceExitPrompt: EXIT_WINDOW_MS - 1 })).toBe('exit');
  });

  it('forgets the exit hint once the window has passed', () => {
    expect(decideBack({ ...base, pathname: '/', msSinceExitPrompt: EXIT_WINDOW_MS })).toBe('confirm-exit');
    expect(decideBack({ ...base, pathname: '/', msSinceExitPrompt: 60_000 })).toBe('confirm-exit');
  });

  it('treats a missing hint as an infinitely old one', () => {
    expect(decideBack({ ...base, pathname: '/', msSinceExitPrompt: Number.POSITIVE_INFINITY })).toBe('confirm-exit');
  });
});

describe('overlay stack', () => {
  it('dismisses the most recently opened overlay first', () => {
    const order: string[] = [];
    const first = pushOverlay(() => order.push('first'));
    const second = pushOverlay(() => order.push('second'));

    expect(overlayDepth()).toBe(2);
    expect(dismissTopOverlay()).toBe(true);
    expect(dismissTopOverlay()).toBe(true);
    expect(order).toEqual(['second', 'first']);

    removeOverlay(first);
    removeOverlay(second);
    expect(overlayDepth()).toBe(0);
  });

  it('reports nothing to dismiss when the stack is empty', () => {
    expect(dismissTopOverlay()).toBe(false);
    expect(overlayDepth()).toBe(0);
  });

  it('survives an overlay unregistering itself while it is being dismissed', () => {
    // The real shape: closing a sheet re-runs its effect cleanup, which removes
    // the entry the handler is in the middle of calling.
    const entry = pushOverlay(() => removeOverlay(entry));
    expect(dismissTopOverlay()).toBe(true);
    expect(overlayDepth()).toBe(0);
  });

  it('ignores a double removal', () => {
    const entry = pushOverlay(() => undefined);
    removeOverlay(entry);
    removeOverlay(entry);
    expect(overlayDepth()).toBe(0);
  });
});
