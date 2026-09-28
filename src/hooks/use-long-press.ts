'use client';

import * as React from 'react';

/**
 * Long press, as one implementation.
 *
 * A press-and-hold is a shortcut to the same action sheet the ⋯ button opens,
 * for anyone who reaches for it; the visible button stays so the action is still
 * discoverable. Three different rows want it — links, folders and notes — and
 * three copies of a timer would be three chances for one of them to behave
 * slightly differently on a slow Android device.
 *
 * Two details are load-bearing:
 *
 *  - the pending timer is cleared on pointer-up, pointer-cancel *and*
 *    pointer-leave, so dragging a thumb off a row does not open a sheet;
 *  - a fired long press swallows the `click` that follows it, because otherwise
 *    every long press would also navigate — the sheet would open over the screen
 *    you had just been taken to.
 */
const DEFAULT_LONG_PRESS_MS = 480;

export interface LongPressHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

export interface LongPress {
  /** Spread onto the pressable element. */
  handlers: LongPressHandlers;
  /**
   * Call from `onClick` and bail out when it returns true. True exactly once,
   * for the click produced by the press that fired the long press.
   */
  consumeLongPress: () => boolean;
}

export function useLongPress(onLongPress: () => void, delay = DEFAULT_LONG_PRESS_MS): LongPress {
  const timer = React.useRef<number | null>(null);
  const fired = React.useRef(false);
  // The latest callback is read at fire time rather than captured, so a row that
  // re-renders with a new closure mid-press still opens the right sheet. It is
  // synced in an effect because a ref must not be written during render.
  const callback = React.useRef(onLongPress);
  React.useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const clear = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A row scrolled out of the list while a press was pending must not leave a
  // timer behind to fire against an unmounted component.
  React.useEffect(() => clear, [clear]);

  const handlers = React.useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: () => {
        fired.current = false;
        clear();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          callback.current();
        }, delay);
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (event) => {
        event.preventDefault();
        callback.current();
      },
    }),
    [clear, delay],
  );

  const consumeLongPress = React.useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return { handlers, consumeLongPress };
}
