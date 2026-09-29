'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

/**
 * Centred alert dialog. Reserved for decisions that need a deliberate answer
 * (destructive confirmations, conflict resolution) rather than everyday input,
 * which belongs in a bottom sheet within thumb reach.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { describedBy?: string }
>(function DialogContent({ className, children, describedBy, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-overlay',
          'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        aria-describedby={describedBy}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[min(24rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl border border-border bg-surface p-5 shadow-raised',
          'data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-title font-semibold tracking-tight text-fg', className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('mt-2 text-body leading-relaxed text-muted', className)}
      {...props}
    />
  );
});
