import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-label font-medium text-muted',
        className,
      )}
      {...props}
    />
  );
}
