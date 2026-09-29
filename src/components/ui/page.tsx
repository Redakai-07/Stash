'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Page scaffolding.
 *
 * One sticky header pattern for every screen keeps the scroll position obvious
 * and avoids the "huge hero heading" habit: the title is small, the content is
 * the point.
 *
 * The whole file is deliberately thin on containers. A list is a list — rows
 * separated by a hairline — not a stack of floating cards, and a section is a
 * label plus space, not a box. Structure comes from rhythm and rules; a box is
 * reserved for something that is genuinely raised off the page.
 */

export function PageHeader({
  children,
  className,
  sticky = true,
}: {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <header
      className={cn(
        'z-20 border-b border-hairline bg-bg/80 px-4 pt-3 pb-3 backdrop-blur-xl',
        sticky && 'sticky top-0',
        className,
      )}
    >
      {children}
    </header>
  );
}

export function PageTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="text-display truncate font-semibold text-fg">{children}</h1>
      {subtitle ? <p className="text-meta mt-0.5 truncate text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
  actionHref,
  onAction,
}: {
  title: string;
  action?: string;
  actionHref?: string;
  onAction?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mt-7 first:mt-3', className)}>
      <div className="flex items-baseline justify-between gap-3 px-4 pb-1">
        {/* Sentence case and no tracking: a section label is a signpost, not a
            decorative eyebrow. */}
        <h2 className="text-label truncate text-subtle">{title}</h2>
        {action && actionHref ? (
          <Link
            href={actionHref}
            className="tap text-meta flex shrink-0 items-center gap-0.5 rounded-tap px-1 py-0.5 font-medium text-accent active:bg-accent-soft"
          >
            {action}
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
          </Link>
        ) : action && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="tap text-meta flex shrink-0 items-center gap-0.5 rounded-tap px-1 py-0.5 font-medium text-accent active:bg-accent-soft"
          >
            {action}
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * An empty state, stated plainly.
 *
 * No illustration, no rounded icon tile above the words. An empty screen is a
 * chance to say one useful sentence, and a decorative box would be the loudest
 * thing on a screen that is empty *because there is nothing to show*.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-1.5 px-1 py-8', className)}>
      {icon ? <span className="mb-1 text-subtle">{icon}</span> : null}
      <p className="text-row font-semibold text-fg">{title}</p>
      {description ? (
        <p className="text-meta max-w-[42ch] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

/**
 * A list.
 *
 * Hairline-separated rows, full-bleed rules, no per-row background. This is the
 * single most common surface in the app, which is exactly why it must not be a
 * repeated rounded card: thirty of those is a template, and it also wastes
 * vertical space on a phone.
 */
export function ListSurface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col divide-y divide-hairline', className)}>{children}</div>;
}

/**
 * A grouped list with a surrounding edge — used for settings-style blocks,
 * where the group itself is the unit ("Your vault", "Appearance").
 *
 * This is the one place a container earns its border: it says "these rows are
 * one thing", which a bare list cannot say.
 */
export function GroupSurface({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col divide-y divide-hairline overflow-hidden rounded-control border border-hairline bg-surface',
        className,
      )}
    >
      {children}
    </div>
  );
}
