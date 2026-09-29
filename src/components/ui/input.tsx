import * as React from 'react';
import { cn } from '@/lib/utils';

/** 16px is the smallest font iOS/Android will not zoom on focus. */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-12 w-full rounded-xl border border-border bg-surface-2 px-3.5 text-title text-fg',
          'placeholder:text-subtle transition-colors',
          'focus:border-accent focus:bg-surface focus:outline-none',
          'disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-title text-fg',
          'placeholder:text-subtle transition-colors',
          'focus:border-accent focus:bg-surface focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-label font-medium text-muted', className)}
      {...props}
    />
  );
}
