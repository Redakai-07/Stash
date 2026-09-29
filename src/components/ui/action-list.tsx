'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The action list inside a sheet.
 *
 * One implementation for links, folders and notes, because the three menus are
 * the same object: a list of things you can do to one item. Previously each
 * action was its own bordered card, which turned a five-item menu into five
 * floating boxes — the exact "everything in a container" tell, and a lot of
 * vertical space spent on nothing.
 *
 * Now the list is rows and hairlines. The only colour is the icon (muted, or
 * danger for the destructive row), so the destructive action is the one thing
 * that stands out, which is the correct hierarchy for a menu.
 */

export function ActionList({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  /** Optional group label, sentence case. */
  label?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      {label ? <p className="text-label px-4 pt-3 pb-1 text-subtle">{label}</p> : null}
      <div className="flex flex-col divide-y divide-hairline">{children}</div>
    </div>
  );
}

export interface ActionRowProps {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Rendered after the label, right-aligned — e.g. a count or current value. */
  hint?: string;
}

export function ActionRow({ icon, label, onClick, tone = 'default', disabled = false, hint }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'tap flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2 disabled:opacity-45',
        tone === 'danger' && 'text-danger',
      )}
    >
      {icon ? (
        <span className={cn('shrink-0', tone === 'danger' ? 'text-danger' : 'text-subtle')}>{icon}</span>
      ) : null}
      <span className="text-row min-w-0 flex-1 truncate font-medium">{label}</span>
      {hint ? <span className="text-meta shrink-0 text-subtle">{hint}</span> : null}
    </button>
  );
}
