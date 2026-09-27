'use client';

import * as React from 'react';
import { ChevronRight, FileText, Link2, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { Note } from '@/db/types';
import { checklistProgress } from '@/lib/markdown';
import { formatRelative, pluralize } from '@/lib/format';
import { notePlainText } from '@/lib/notes';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';

/**
 * A note in a list.
 *
 * Shows what distinguishes one note from another -- how many subnotes it holds,
 * whether it has a checklist and how far through it is, how many links are
 * attached -- without turning into a card. A note that is a container reads as a
 * container; a note with content shows its opening line.
 */
export interface NoteRowProps {
  note: Note;
  childCount?: number;
  linkCount?: number;
  /** Override the secondary line entirely, e.g. to show a full path in search. */
  subtitle?: string;
  onOpen: () => void;
  onShowActions: () => void;
  onToggleFavorite?: () => void;
  /** Marked because it matched the current query. */
  highlight?: boolean;
  className?: string;
}

export function NoteRow({
  note,
  childCount = 0,
  linkCount = 0,
  subtitle,
  onOpen,
  onShowActions,
  onToggleFavorite,
  highlight = false,
  className,
}: NoteRowProps) {
  const locked = useVaultStore((state) => state.protection.notes.has(note.id));
  const checklist = React.useMemo(() => checklistProgress(note.content), [note.content]);
  const preview = React.useMemo(() => notePlainText(note.content, 80), [note.content]);

  const meta: string[] = [];
  if (childCount > 0) meta.push(pluralize(childCount, 'subnote'));
  if (linkCount > 0) meta.push(pluralize(linkCount, 'link'));
  if (checklist) meta.push(`${checklist.done}/${checklist.total}`);
  meta.push(formatRelative(note.updatedAt));

  return (
    <div className={cn('flex items-stretch gap-1 rounded-xl', highlight && 'ring-1 ring-accent/30 ring-inset', className)}>
      <button
        type="button"
        onClick={onOpen}
        className="tap flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            childCount > 0 ? 'bg-surface-2 text-muted' : 'bg-surface-2 text-subtle',
          )}
        >
          {childCount > 0 ? (
            <span className="text-[0.8125rem] font-bold">{note.title.slice(0, 1).toUpperCase()}</span>
          ) : (
            <FileText size={16} strokeWidth={1.9} aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[0.9375rem] leading-tight font-medium text-fg">
              {note.title}
            </span>
            {locked ? (
              <Lock size={12} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Locked note" />
            ) : null}
            {note.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="shrink-0 fill-warning text-warning" aria-label="Favorite" />
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-subtle">
            {subtitle ?? meta.join(' · ')}
          </span>
          {!subtitle && preview.length > 0 && childCount === 0 ? (
            <span className="mt-0.5 block truncate text-xs text-subtle/80">{preview}</span>
          ) : null}
        </span>
        {childCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-subtle">
            {childCount}
            <ChevronRight size={15} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
      </button>

      <div className="flex shrink-0 items-center">
        {linkCount > 0 ? (
          <span className="flex items-center gap-1 pr-1 text-xs text-subtle" aria-label={pluralize(linkCount, 'linked resource')}>
            <Link2 size={13} strokeWidth={2} aria-hidden />
            {linkCount}
          </span>
        ) : null}
        {onToggleFavorite ? (
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={note.isFavorite}
            className="tap flex size-9 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Star
              size={17}
              strokeWidth={1.9}
              className={cn('transition-colors', note.isFavorite ? 'fill-warning text-warning' : 'text-subtle')}
              aria-hidden
            />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onShowActions}
          aria-label={`${note.title} actions`}
          className="tap mr-0.5 flex size-9 items-center justify-center rounded-full text-subtle active:bg-surface-2"
        >
          <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
