'use client';

import * as React from 'react';
import { ChevronRight, Lock, MoreHorizontal, Star } from 'lucide-react';
import type { Folder } from '@/db/types';
import { pluralize } from '@/lib/format';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';
import { Icon, isIconName } from '@/components/ui/icon';

/** A folder in a list: icon, name, and just enough count to orient. */
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
  const meta: string[] = [];
  if (linkCount > 0) meta.push(pluralize(linkCount, 'link'));
  if (childCount > 0) meta.push(pluralize(childCount, 'folder'));

  return (
    <div className={cn('flex items-stretch gap-1 rounded-xl', className)}>
      <button
        type="button"
        onClick={onOpen}
        className="tap flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-surface-2"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
          {isIconName(folder.icon) ? (
            <Icon name={folder.icon} size={17} strokeWidth={1.85} />
          ) : (
            <span className="text-[0.8125rem] font-bold">{folder.name.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[0.9375rem] leading-tight font-medium text-fg">
              {folder.name}
            </span>
            {locked ? (
              <Lock size={12} strokeWidth={2.4} className="shrink-0 text-accent" aria-label="Locked folder" />
            ) : null}
            {folder.isFavorite ? (
              <Star size={12} strokeWidth={2.4} className="shrink-0 text-warning" aria-label="Favorite folder" />
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-subtle">
            {subtitle ?? (meta.length > 0 ? meta.join(' · ') : 'Empty')}
          </span>
        </span>
        <ChevronRight size={17} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onShowActions}
        aria-label={`${folder.name} actions`}
        className="tap mr-0.5 flex w-9 shrink-0 items-center justify-center rounded-full text-subtle active:bg-surface-2"
      >
        <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
