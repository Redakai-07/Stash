'use client';

import * as React from 'react';
import { ChevronRight, Loader2, Lock } from 'lucide-react';
import type { RevealKind } from '@/stores/privacy-store';
import { usePrivacyStore } from '@/stores/privacy-store';
import { cn } from '@/lib/utils';

/**
 * A locked item, still in its list.
 *
 * The row keeps its place, its shape on screen and its position in the tree, and
 * gives up everything else: the icon is the same for every locked item, the title
 * is the word "Locked", and the only metadata is when it was touched. Nothing
 * here is derived from the ciphertext, because there is nothing readable in it —
 * a locked folder's name was never stored, so it cannot be shown even by
 * accident.
 *
 * The second line says "Tap to unlock" rather than "unlock to read": the row is
 * asking for a gesture, and it is the only row in the app that does.
 *
 * Tapping is what raises the system prompt: the device lock where one is armed, and
 * (for a vault made by an older build) the passcode where it is not. That is the
 * point of keeping the row rather than filtering it out — the lock is an
 * interaction on the item, not a screen in front of the app.
 */

export interface LockedRowProps {
  kind: RevealKind;
  /** Only ever non-sensitive: timestamps survive locking by design. */
  subtitle?: string;
  onReveal: () => void;
  busy?: boolean;
  className?: string;
}

const NOUNS: Record<RevealKind, string> = {
  folder: 'Locked folder',
  note: 'Locked note',
  link: 'Locked link',
};

export function LockedRow({ kind, subtitle, onReveal, busy = false, className }: LockedRowProps) {
  return (
    <div className={cn('flex items-stretch', className)}>
      <button
        type="button"
        onClick={onReveal}
        disabled={busy}
        aria-label={`${NOUNS[kind]} — unlock to open`}
        className="tap flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2"
      >
        {/* The accent tile is the one visual difference between a locked row and
            an open one, and it is the same treatment folders get: a row with an
            identity, not a row with content. */}
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden />
          ) : (
            <Lock size={18} strokeWidth={2} aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-row block truncate font-medium text-fg">{NOUNS[kind]}</span>
          <span className="text-meta mt-0.5 block truncate text-subtle">
            {subtitle ? `${subtitle} · ` : ''}Tap to unlock
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Ask for a locked item.
 *
 * Returns whether the vault came back unlocked. Callers pass the thing they were
 * about to do and have it run only on success, so a tap on a locked row either
 * opens the item or raises the prompt — never silently does nothing.
 */
export function useRevealLocked() {
  const [busy, setBusy] = React.useState(false);
  const requestReveal = usePrivacyStore((state) => state.requestReveal);

  const reveal = React.useCallback(
    async (kind: RevealKind, id: string, next?: () => void) => {
      setBusy(true);
      // `requestReveal` resolves `ok` only when the vault is already unlocked —
      // the device prompt answered yes. Otherwise it has queued the request so the
      // prompt can explain itself, and the caller's `next` waits for the next tap
      // rather than opening something that is still unreadable.
      const result = await requestReveal(kind, id);
      setBusy(false);
      if (result.ok) next?.();
      return result.ok;
    },
    [requestReveal],
  );

  return { reveal, busy };
}
