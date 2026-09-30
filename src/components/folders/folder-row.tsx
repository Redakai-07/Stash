'use client';

import { ChevronRight, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { Folder } from '@/db/types';
import { pluralize } from '@/lib/format';
import { isSealed } from '@/lib/privacy/protection';
import { useLongPress } from '@/hooks/use-long-press';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';
import { Icon, isIconName } from '@/components/ui/icon';
import { LockedRow, useRevealLocked } from '@/components/privacy/locked-row';

/**
 * A folder in a list.
 *
 * The icon the user chose is information architecture — it is the little
 * differentiator between "Android" and "Machine Learning" at a glance — so it
 * gets a soft tile of its own, and it is the only row in the app that does. A
 * folder is an object with an identity the user gave it; a link or a note is
 * content, which is why those rows stay bare. The tile is the quiet surface
 * step, not the accent: twenty folders on a screen should not be twenty green
 * squares.
 */
export interface FolderRowProps {
  folder: Folder;
  /** Secondary line, e.g. the full path when shown out of context. */
  subtitle?: string;
  linkCount?: number;
  childCount?: number;
  onOpen: () => void;
  onShowActions: () => void;
  className?: string;
}

export function FolderRow({
  folder,
  subtitle,
  linkCount = 0,
  childCount = 0,
  onOpen,
  onShowActions,
  className,
}: FolderRowProps) {
  const locked = useVaultStore((state) => state.protection.folders.has(folder.id));
  // Hold a folder for the same sheet its ⋯ button opens, so every list in the
  // app answers to the same gesture.
  const { handlers, consumeLongPress } = useLongPress(onShowActions);
  // A sealed folder has no name to show — it was never stored — so the row
  // becomes the placeholder and the tap asks for the device prompt.
  const { reveal, busy } = useRevealLocked();
  const meta: string[] = [];
  if (linkCount > 0) meta.push(pluralize(linkCount, 'link'));
  if (childCount > 0) meta.push(pluralize(childCount, 'folder'));

  if (isSealed(folder)) {
    return (
      <LockedRow
        kind="folder"
        subtitle={meta.length > 0 ? meta.join(' · ') : undefined}
        busy={busy}
        onReveal={() => void reveal('folder', folder.id, onOpen)}
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex items-stretch', className)}>
      <button
        type="button"
        onClick={() => {
          if (consumeLongPress()) return;
          onOpen();
        }}
        {...handlers}
        className="tap flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
          {isIconName(folder.icon) ? (
            <Icon name={folder.icon} size={19} strokeWidth={1.8} />
          ) : (
            <Icon name="folder" size={19} strokeWidth={1.8} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-row min-w-0 truncate font-medium text-fg">{folder.name}</span>
            {locked ? (
              <Lock size={12} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Locked folder" />
            ) : null}
            {folder.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="shrink-0 text-warning" aria-label="Favorite folder" />
            ) : null}
          </span>
          <span className="text-meta mt-0.5 block truncate text-subtle">
            {subtitle ?? (meta.length > 0 ? meta.join(' · ') : 'Empty')}
          </span>
        </span>
        <ChevronRight size={17} strokeWidth={2} className="shrink-0 text-subtle/70" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onShowActions}
        aria-label={`${folder.name} actions`}
        className="tap mr-1 flex w-10 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
      >
        <MoreHorizontal size={19} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
