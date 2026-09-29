'use client';

import { ChevronRight, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { Folder } from '@/db/types';
import { pluralize } from '@/lib/format';
import { useLongPress } from '@/hooks/use-long-press';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';
import { Icon, isIconName } from '@/components/ui/icon';

/**
 * A folder in a list.
 *
 * The icon the user chose is shown inline and in one colour, because it is
 * information architecture — it is the little differentiator between "Android"
 * and "Machine Learning" at a glance. It is *not* shown inside a rounded tile
 * with its own background: that would turn every row into a card whose loudest
 * element is decoration.
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
  const meta: string[] = [];
  if (linkCount > 0) meta.push(pluralize(linkCount, 'link'));
  if (childCount > 0) meta.push(pluralize(childCount, 'folder'));

  return (
    <div className={cn('flex items-stretch', className)}>
      <button
        type="button"
        onClick={() => {
          if (consumeLongPress()) return;
          onOpen();
        }}
        {...handlers}
        className="tap flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
      >
        <span className="shrink-0 text-subtle">
          {isIconName(folder.icon) ? (
            <Icon name={folder.icon} size={19} strokeWidth={1.7} />
          ) : (
            <Icon name="folder" size={19} strokeWidth={1.7} />
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
        className="tap mr-1 flex w-10 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2"
      >
        <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
