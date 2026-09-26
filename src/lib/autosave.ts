/**
 * Autosave.
 *
 * Kept as a plain class rather than a hook so the timing rules -- debounce,
 * maximum wait while typing continuously, single in-flight write, retry after a
 * failure -- are deterministic and testable without rendering anything.
 *
 * The two guarantees that matter for a note editor:
 *  - Typing is never blocked by a save. `schedule` only records the newest
 *    value; the write happens off the keystroke path.
 *  - A save is never lost to an unmount. `flush()` completes any in-flight write
 *    and then persists the newest value, so closing the editor or the whole app
 *    mid-sentence keeps the sentence.
 */

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveStatusDetail {
  savedAt?: number;
  error?: unknown;
}

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<void>;
  /** Quiet period before writing. Long enough to batch typing, short enough to feel instant. */
  delayMs?: number;
  /**
   * Upper bound on how long unsaved work may sit while the user keeps typing.
   * Without this, a continuous typist could go minutes with nothing persisted.
   */
  maxDelayMs?: number;
  onStatus?: (status: AutosaveStatus, detail: AutosaveStatusDetail) => void;
}

export const DEFAULT_AUTOSAVE_DELAY_MS = 700;
export const DEFAULT_AUTOSAVE_MAX_DELAY_MS = 5000;

interface TimerHost {
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  now: () => number;
}

export class AutosaveController<T> {
  private readonly options: Required<Pick<AutosaveOptions<T>, 'save'>> & {
    delayMs: number;
    maxDelayMs: number;
    onStatus?: (status: AutosaveStatus, detail: AutosaveStatusDetail) => void;
  };

  private readonly timers: TimerHost;

  private pendingValue: T | null = null;
  private pendingSince = 0;
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  private status: AutosaveStatus = 'idle';
  private lastSavedAt: number | null = null;

  constructor(options: AutosaveOptions<T>, timers: Partial<TimerHost> = {}) {
    this.options = {
      save: options.save,
      delayMs: options.delayMs ?? DEFAULT_AUTOSAVE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_AUTOSAVE_MAX_DELAY_MS,
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    };
    this.timers = {
      setTimer:
        timers.setTimer ??
        ((handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number),
      clearTimer: timers.clearTimer ?? ((handle) => globalThis.clearTimeout(handle)),
      now: timers.now ?? (() => Date.now()),
    };
  }

  getStatus(): AutosaveStatus {
    return this.status;
  }

  getLastSavedAt(): number | null {
    return this.lastSavedAt;
  }

  /** True when there is a value that has not reached storage yet. */
  hasPendingWork(): boolean {
    return this.pendingValue !== null || this.inFlight !== null;
  }

  /**
   * Record the newest value and (re)arm the debounce.
   *
   * The timer is capped so a user who types without pausing for five seconds
   * still gets an intermediate save.
   */
  schedule(value: T): void {
    if (this.disposed) return;

    if (this.pendingValue === null) this.pendingSince = this.timers.now();
    this.pendingValue = value;

    const waited = this.timers.now() - this.pendingSince;
    const budget = Math.max(0, this.options.maxDelayMs - waited);
    const wait = Math.min(this.options.delayMs, budget);

    this.cancelTimer();
    if (wait <= 0) {
      void this.flush();
      return;
    }
    this.setStatus('pending');
    this.timer = this.timers.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /**
   * Persist immediately and wait until the newest value has been written.
   * Safe to call when there is nothing to do.
   */
  async flush(): Promise<void> {
    if (this.disposed) return;
    this.cancelTimer();

    // Loop rather than recurse: a value that arrives *during* a write still gets
    // written. A FAILED write is the one place the loop must not continue: the
    // value stays pending for a later retry, and re-attempting it immediately
    // would spin forever against a persistently failing store. So after a
    // failure flush returns, leaving the value queued and the status at `error`.
    while (true) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      if (this.pendingValue === null) return;

      const value = this.pendingValue;
      this.pendingValue = null;
      this.pendingSince = 0;
      this.setStatus('saving');

      let succeeded = false;
      const run = (async () => {
        try {
          await this.options.save(value);
          this.lastSavedAt = this.timers.now();
          this.setStatus('saved', { savedAt: this.lastSavedAt });
          succeeded = true;
        } catch (error) {
          this.setStatus('error', { error });
        } finally {
          this.inFlight = null;
        }
      })();

      this.inFlight = run;
      await run;

      if (!succeeded) {
        // Queue the value again -- but never on top of a newer one that arrived
        // while the failed write was in flight.
        if (this.pendingValue === null) {
          this.pendingValue = value;
          this.pendingSince = this.timers.now();
        }
        return;
      }
    }
  }

  /**
   * Stop scheduling. Does not save: callers flush first, which makes the
   * "we are being torn down" path explicit rather than implicit.
   */
  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private setStatus(status: AutosaveStatus, detail: AutosaveStatusDetail = {}): void {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }
}

/** Human label for the save indicator. Deliberately quiet. */
export function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case 'pending':
      return 'Saving…';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Not saved';
    case 'idle':
    default:
      return '';
  }
}
