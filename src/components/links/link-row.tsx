'use client';

import { Link2Off, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { SavedLink } from '@/db/types';
import { displayUrl, formatRelative, tintForId } from '@/lib/format';
import { useLongPress } from '@/hooks/use-long-press';
import { useVaultStore, selectTagsForLink } from '@/stores/vault-store';
import { cn } from '@/lib/utils';

/**
 * A saved link, sized for scanning.
 *
 * Deliberately not a social preview card: no thumbnails, no oversized title, no
 * metadata blocks. A title, its origin, and when it landed is enough to
 * recognise a link, and it means twenty of them fit on a phone screen.
 */

const TINT_CLASS: Record<string, string> = {
  accent: 'bg-accent-soft text-accent',
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/14 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  rose: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
};

export interface LinkRowProps {
  link: SavedLink;
  /** Shown as the secondary line when the row is not inside its folder. */
  context?: string;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onShowActions: () => void;
  /** Highlighted because it matched the current search. */
  highlight?: boolean;
  className?: string;
}

export function LinkRow({
  link,
  context,
  onOpen,
  onToggleFavorite,
  onShowActions,
  highlight = false,
  className,
}: LinkRowProps) {
  // The row subscribes to the lock set rather than taking a prop, so a new list
  // cannot forget to mark a locked item.
  const locked = useVaultStore((state) => state.protection.links.has(link.id));
  // Same reason: tags ride along with the row instead of every caller having to
  // thread them through, so a list added later shows them for free.
  const tags = useVaultStore((state) => selectTagsForLink(state, link.id));
  const tint = TINT_CLASS[tintForId(link.source ?? link.id)] ?? TINT_CLASS.accent;
  const initial = (link.source ?? 'link').replace(/^www\./, '').slice(0, 1).toUpperCase();

  // Long press is a shortcut to the same sheet the ⋯ button opens, for anyone
  // who reaches for it; the visible button keeps it discoverable.
  const { handlers, consumeLongPress } = useLongPress(onShowActions);

  const handleOpen = () => {
    if (consumeLongPress()) return;
    onOpen();
  };

  return (
    <div
      className={cn(
        'group flex items-stretch gap-1 rounded-xl',
        highlight && 'ring-1 ring-accent/30 ring-inset',
        className,
      )}
    >
      <button
        type="button"
        onClick={handleOpen}
        {...handlers}
        className="tap flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl text-[0.8125rem] font-bold', tint)}>
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[0.9375rem] leading-tight font-medium text-fg">
              {link.title?.trim() || displayUrl(link.url, 54)}
            </span>
            {locked ? (
              <Lock
                size={12}
                strokeWidth={2.4}
                className="shrink-0 text-accent"
                aria-label="Locked"
              />
            ) : null}
            {link.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="shrink-0 text-warning" aria-label="Favorite" />
            ) : null}
            {link.isUnavailable ? (
              <Link2Off
                size={12}
                strokeWidth={2.4}
                className="shrink-0 text-danger"
                aria-label="Marked as no longer working"
              />
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
            <span className="truncate">{link.source ?? displayUrl(link.url, 32)}</span>
            {/*
              Tags ride on the metadata line rather than their own row. A list is
              for scanning, and a second line of chips on tagged items would make
              the rows uneven for the sake of something the ⋯ sheet shows in full.
            */}
            {tags.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 truncate text-accent">
                  {tags.slice(0, 2).join(', ')}
                  {tags.length > 2 ? ` +${tags.length - 2}` : ''}
                </span>
              </>
            ) : null}
            {context ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{context}</span>
              </>
            ) : null}
            {link.userNote ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">note</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatRelative(link.createdAt)}</span>
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={link.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={link.isFavorite}
          className="tap flex size-9 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Star
            size={17}
            strokeWidth={1.9}
            className={cn('transition-colors', link.isFavorite ? 'fill-warning text-warning' : 'text-subtle')}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={onShowActions}
          aria-label="Link actions"
          className="tap mr-0.5 flex size-9 items-center justify-center rounded-full text-subtle active:bg-surface-2"
        >
          <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
