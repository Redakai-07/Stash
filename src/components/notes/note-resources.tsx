'use client';

import * as React from 'react';
import { Link2, Plus, X } from 'lucide-react';
import type { SavedLink } from '@/db/types';
import { displayUrl, tintForId } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The links a note refers to.
 *
 * Rows point at the one canonical SavedLink record rather than a copy, so a
 * resource keeps its real title and folder, and detaching it here removes only
 * the reference -- never the saved link.
 */

const TINT_CLASS: Record<string, string> = {
  accent: 'bg-accent-soft text-accent',
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/14 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  rose: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
};

export interface NoteResourcesProps {
  links: readonly SavedLink[];
  onOpenLink: (link: SavedLink) => void;
  onDetach: (linkId: string) => void;
  onAttach: () => void;
  /** Hidden while the note is locked. */
  readOnly?: boolean;
  className?: string;
}

export function NoteResources({
  links,
  onOpenLink,
  onDetach,
  onAttach,
  readOnly = false,
  className,
}: NoteResourcesProps) {
  return (
    <section className={cn('mt-6', className)}>
      <div className="flex items-baseline justify-between px-4 pb-1.5">
        <h2 className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">
          <Link2 size={12} strokeWidth={2.2} aria-hidden />
          Resources
          {links.length > 0 ? <span className="text-subtle/70">{links.length}</span> : null}
        </h2>
      </div>

      {links.length > 0 ? (
        <ul className="flex flex-col gap-0.5 px-2">
          {links.map((link) => {
            const tint = TINT_CLASS[tintForId(link.source ?? link.id)] ?? TINT_CLASS.accent;
            return (
              <li key={link.id} className="flex items-stretch gap-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => onOpenLink(link)}
                  className="tap flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-xl text-[0.8125rem] font-bold',
                      tint,
                    )}
                  >
                    {(link.source ?? 'link').replace(/^www\./, '').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] leading-tight font-medium text-fg">
                      {link.title?.trim() || displayUrl(link.url, 48)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-subtle">
                      {link.source ?? displayUrl(link.url, 32)}
                    </span>
                  </span>
                </button>
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onDetach(link.id)}
                    aria-label={`Detach ${link.title ?? 'link'}`}
                    className="tap mr-0.5 flex w-9 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2"
                  >
                    <X size={16} strokeWidth={2.2} aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 pb-1 text-[0.8125rem] leading-relaxed text-subtle">
          No links attached. Attach a saved link to keep the source of a thought next to it.
        </p>
      )}

      {readOnly ? null : (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={onAttach}
            className="tap flex w-full items-center gap-3 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-left active:bg-surface-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent">
              <Plus size={17} strokeWidth={2.1} aria-hidden />
            </span>
            <span className="text-[0.9375rem] font-medium text-accent">Attach a saved link</span>
          </button>
        </div>
      )}
    </section>
  );
}
