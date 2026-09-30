'use client';

import * as React from 'react';
import { ChevronRight, Link2, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { Note } from '@/db/types';
import { checklistProgress } from '@/lib/markdown';
import { formatRelative, pluralize } from '@/lib/format';
import { notePlainText } from '@/lib/notes';
import { isSealed } from '@/lib/privacy/protection';
import { useLongPress } from '@/hooks/use-long-press';
import { useVaultStore } from '@/stores/vault-store';
import { LockedRow, useRevealLocked } from '@/components/privacy/locked-row';
import { cn } from '@/lib/utils';

/**
 * A note in a list.
 *
 * Shows what distinguishes one note from another — how many subnotes it holds,
 * whether it has a checklist and how far through it is, how many links are
 * attached — without becoming a card. A note that is a container reads as a
 * container; a note with content shows its opening line.
 *
 * There is no leading tile. The title and the metadata are the row; a rounded
 * square with an initial in it is the single most recognisable generated-UI
 * flourish and it told the user nothing they were not already reading.
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
  // Hold a note for the same sheet its ⋯ button opens, so every list in the app
  // answers to the same gesture.
  const { handlers, consumeLongPress } = useLongPress(onShowActions);
  // See `LockedRow`: a sealed note is a placeholder that asks for the prompt.
  const { reveal, busy: revealing } = useRevealLocked();
  const checklist = React.useMemo(() => checklistProgress(note.content), [note.content]);
  const preview = React.useMemo(() => notePlainText(note.content, 80), [note.content]);

  const meta: string[] = [];
  if (childCount > 0) meta.push(pluralize(childCount, 'subnote'));
  if (linkCount > 0) meta.push(pluralize(linkCount, 'link'));
  if (checklist) meta.push(`${checklist.done}/${checklist.total}`);
  meta.push(formatRelative(note.updatedAt));

  if (isSealed(note)) {
    return (
      <LockedRow
        kind="note"
        subtitle={formatRelative(note.updatedAt)}
        busy={revealing}
        onReveal={() => void reveal('note', note.id, onOpen)}
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex items-stretch', highlight && 'bg-accent-soft/40', className)}>
      <button
        type="button"
        onClick={() => {
          if (consumeLongPress()) return;
          onOpen();
        }}
        {...handlers}
        className="tap flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-row min-w-0 truncate font-medium text-fg">{note.title}</span>
            {locked ? <Lock size={12} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Locked note" /> : null}
            {note.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="shrink-0 fill-warning text-warning" aria-label="Favorite" />
            ) : null}
          </span>
          <span className="text-meta mt-0.5 block truncate text-subtle">{subtitle ?? meta.join(' · ')}</span>
          {!subtitle && preview.length > 0 && childCount === 0 ? (
            <span className="text-meta mt-0.5 line-clamp-2 block text-muted">{preview}</span>
          ) : null}
        </span>
        {childCount > 0 ? (
          <span className="text-meta flex shrink-0 items-center gap-1 text-subtle">
            {childCount}
            <ChevronRight size={15} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
      </button>

      <div className="flex shrink-0 items-center pr-1">
        {linkCount > 0 ? (
          <span
            className="text-meta flex items-center gap-1 pr-1 text-subtle"
            aria-label={pluralize(linkCount, 'linked resource')}
          >
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
            className="tap flex size-10 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Star
              size={18}
              strokeWidth={1.9}
              className={cn('transition-colors', note.isFavorite ? 'fill-warning text-warning' : 'text-muted')}
              aria-hidden
            />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onShowActions}
          aria-label={`${note.title} actions`}
          className="tap flex size-10 items-center justify-center rounded-full text-muted active:bg-surface-2"
        >
          <MoreHorizontal size={19} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
