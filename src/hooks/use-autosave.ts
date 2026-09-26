'use client';

import * as React from 'react';
import { AutosaveController, type AutosaveStatus } from '@/lib/autosave';

/**
 * Binds the autosave controller to a React value.
 *
 * Three flush points beyond the debounce matter on Android:
 *  - `visibilitychange` fires when the app is backgrounded, which is the last
 *    moment we are guaranteed to run before the WebView can be frozen.
 *  - `pagehide` covers tab/app teardown.
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
  /** Construction options. Changing them remounts the editor; keep them stable. */
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

  // Latest-value refs, updated in an effect rather than during render: the
  // React Compiler forbids writing refs while rendering. The controller reads
  // them only when a timer fires or a flush runs, so being one commit behind
  // is harmless.
  const saveRef = React.useRef(save);
  const isEqualRef = React.useRef(isEqual);
  const persistedRef = React.useRef(persisted);

  React.useEffect(() => {
    saveRef.current = save;
    isEqualRef.current = isEqual;
    // The comparison strategy intentionally cannot re-trigger a save on its own.
  });

  React.useEffect(() => {
    persistedRef.current = persisted;
  }, [persisted]);

  // The controller lives in a ref and is created exactly once, with its own
  // teardown. Construction happens in an effect, so the closure below that
  // reads `saveRef` runs outside render -- which is both compiler-legal and
  // the honest description of when it executes.
  const controllerRef = React.useRef<AutosaveController<T> | null>(null);

  React.useEffect(() => {
    const instance = new AutosaveController<T>({
      save: (next) => saveRef.current(next),
      onStatus: (next, detail) => {
        setStatus(next);
        if (typeof detail.savedAt === 'number') setLastSavedAt(detail.savedAt);
      },
      ...(delayMs !== undefined ? { delayMs } : {}),
      ...(maxDelayMs !== undefined ? { maxDelayMs } : {}),
    });
    controllerRef.current = instance;

    return () => {
      // Flush first, then stop scheduling: the write is already in flight by
      // the time `dispose` runs, so it is not interrupted.
      void instance.flush();
      instance.dispose();
      if (controllerRef.current === instance) controllerRef.current = null;
    };
    // Construction options are mount-stable by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `useEffectEvent` keeps these stable without deps: each always sees the
  // latest refs and controller, and neither belongs in a dependency array.
  const scheduleIfChanged = React.useEffectEvent((next: T) => {
    const instance = controllerRef.current;
    if (!instance) return;
    const equal = isEqualRef.current ?? Object.is;
    if (equal(next, persistedRef.current)) return;
    instance.schedule(next);
  });

  React.useEffect(() => {
    if (!enabled) return;
    scheduleIfChanged(value);
  }, [enabled, value]);

  const flushNow = React.useEffectEvent(() => {
    void controllerRef.current?.flush();
  });

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushNow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushNow);
    };
  }, []);

  const flush = React.useCallback(
    () => controllerRef.current?.flush() ?? Promise.resolve(),
    [],
  );

  return { status, lastSavedAt, flush };
}
