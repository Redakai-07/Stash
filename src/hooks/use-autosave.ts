'use client';

import * as React from 'react';
import { AutosaveController, type AutosaveStatus } from '@/lib/autosave';

/**
 * Binds the autosave controller to a React value.
 *
 * Two flush points beyond the debounce matter on Android:
 *  - `visibilitychange` fires when the app is backgrounded, which is the last
 *    moment we are guaranteed to run before the WebView can be frozen.
 *  - Unmount, when the user navigates away from the note.
 * Together they mean "app killed while editing" loses at most the keystrokes
 * typed inside the current debounce window, and usually nothing at all.
 */

export interface UseAutosaveOptions<T> {
  /** The current editor value. */
  value: T;
  /** The value last known to be persisted; equality means there is nothing to do. */
  persisted: T;
  save: (value: T) => Promise<void>;
  /**
   * How to decide the draft already matches storage. Defaults to identity, which
   * is right for strings; object drafts pass a field comparison so a re-render
   * with an equal-but-not-identical object does not schedule a pointless write.
   */
  isEqual?: (a: T, b: T) => boolean;
  enabled?: boolean;
  delayMs?: number;
  maxDelayMs?: number;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  /** Force a write now. Resolves once the newest value has reached storage. */
  flush: () => Promise<void>;
}

export function useAutosave<T>({
  value,
  persisted,
  save,
  isEqual,
  enabled = true,
  delayMs,
  maxDelayMs,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = React.useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

  // Refs so that a new `save` closure never rebuilds the controller and resets
  // the debounce mid-sentence.
  const saveRef = React.useRef(save);
  saveRef.current = save;
  const persistedRef = React.useRef(persisted);
  persistedRef.current = persisted;

  const controller = React.useMemo(
    () =>
      new AutosaveController<T>({
        save: (next) => saveRef.current(next),
        onStatus: (next, detail) => {
          setStatus(next);
          if (typeof detail.savedAt === 'number') setLastSavedAt(detail.savedAt);
        },
        ...(delayMs !== undefined ? { delayMs } : {}),
        ...(maxDelayMs !== undefined ? { maxDelayMs } : {}),
      }),
    [delayMs, maxDelayMs],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const equal = isEqual ?? Object.is;
    if (equal(value, persistedRef.current)) return;
    controller.schedule(value);
    // `isEqual` is intentionally not a dependency: it is a comparison strategy,
    // and swapping it should not re-trigger a save of the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, enabled, value]);

  React.useEffect(() => {
    const flush = () => {
      void controller.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      // Flush first, then stop scheduling: the write is already in flight by the
      // time `dispose` runs, so it is not interrupted.
      void controller.flush();
      controller.dispose();
    };
  }, [controller]);

  const flush = React.useCallback(() => controller.flush(), [controller]);

  return { status, lastSavedAt, flush };
}
