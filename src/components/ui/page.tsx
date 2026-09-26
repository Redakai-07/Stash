'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Page scaffolding.
 *
 * One sticky header pattern for every screen keeps the scroll position obvious
 * and avoids the "huge hero heading" habit -- the title is small, the content is
 * the point.
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
        'z-20 border-b border-border/60 bg-bg/85 px-4 pt-3 pb-3 backdrop-blur-xl',
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
      <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-tight text-fg">{children}</h1>
      {subtitle ? <p className="mt-0.5 truncate text-[0.8125rem] text-muted">{subtitle}</p> : null}
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
    <section className={cn('mt-5 first:mt-2', className)}>
      <div className="flex items-baseline justify-between px-4 pb-1.5">
        <h2 className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">{title}</h2>
        {action && actionHref ? (
          <Link
            href={actionHref}
            className="tap flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[0.8125rem] font-medium text-accent active:bg-accent-soft"
          >
            {action}
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
          </Link>
        ) : action && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="tap flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[0.8125rem] font-medium text-accent active:bg-accent-soft"
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
    <div className={cn('flex flex-col items-center gap-2 px-8 py-10 text-center', className)}>
      {icon ? (
        <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-subtle">
          {icon}
        </span>
      ) : null}
      <p className="text-[0.9375rem] font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-xs text-[0.8125rem] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** List container that keeps rows aligned to a consistent gutter. */
export function ListSurface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-0.5 px-2', className)}>{children}</div>;
}
