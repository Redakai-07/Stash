'use client';

import { Link2Off, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { SavedLink } from '@/db/types';
import { displayUrl, formatRelative } from '@/lib/format';
import { isSealed } from '@/lib/privacy/protection';
import { useLongPress } from '@/hooks/use-long-press';
import { useVaultStore, selectTagsForLink } from '@/stores/vault-store';
import { LockedRow, useRevealLocked } from '@/components/privacy/locked-row';
import { cn } from '@/lib/utils';

/**
 * A saved link, sized for scanning.
 *
 * No thumbnail, no preview card, no oversized title — and no leading icon tile.
 * A row is a title, where it came from, and when it landed. That is enough to
 * recognise a link and it means twenty of them fit on a phone screen.
 *
 * The row is also monochrome on purpose. Colouring each row by a hash of its
 * domain was variety for its own sake: it created a rainbow that carried no
 * information and made the list look decorative rather than scannable. The only
 * colour here is the accent on a lock, the warning on a favourite, and the
 * danger on a link the user themselves marked as dead.
 */

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

  // Long press is a shortcut to the same sheet the ⋯ button opens, for anyone
  // who reaches for it; the visible button keeps it discoverable.
  const { handlers, consumeLongPress } = useLongPress(onShowActions);
  // A sealed row is unreadable in this session: it renders as a placeholder that
  // asks for the device prompt, and the caller's `onOpen` runs only once the
  // vault is unlocked.
  const { reveal, busy } = useRevealLocked();

  const handleOpen = () => {
    if (consumeLongPress()) return;
    onOpen();
  };

  if (isSealed(link)) {
    return (
      <LockedRow
        kind="link"
        subtitle={formatRelative(link.createdAt)}
        busy={busy}
        onReveal={() => void reveal('link', link.id, onOpen)}
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex items-stretch', highlight && 'bg-accent-soft/40', className)}>
      <button
        type="button"
        onClick={handleOpen}
        {...handlers}
        className="tap flex min-w-0 flex-1 items-center px-4 py-3.5 text-left active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-row min-w-0 truncate font-medium text-fg">
              {link.title?.trim() || displayUrl(link.url, 54)}
            </span>
            {locked ? <Lock size={12} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Locked" /> : null}
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
          <span className="text-meta mt-0.5 flex items-center gap-1.5 text-subtle">
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

      <div className="flex shrink-0 items-center pr-1">
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={link.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={link.isFavorite}
          className="tap flex size-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Star
            size={18}
            strokeWidth={1.9}
            className={cn('transition-colors', link.isFavorite ? 'fill-warning text-warning' : 'text-muted')}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={onShowActions}
          aria-label="Link actions"
          className="tap flex size-10 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <MoreHorizontal size={19} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
