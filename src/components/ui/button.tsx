'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Buttons are tuned for thumbs: a 44px minimum hit target, a soft pressed state,
 * and no reliance on hover, which does not exist on a phone.
 *
 * The primary button is the accent and 48px tall wherever there is room for it,
 * because the action a screen exists for should be the easiest thing on it to
 * hit — not a 36px pill tucked into a corner.
 */
const buttonVariants = cva(
  'tap tap-scale inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium outline-none disabled:pointer-events-none disabled:opacity-45 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg active:bg-accent-hover',
        surface: 'bg-surface-2 text-fg border border-border active:bg-surface-3',
        ghost: 'text-fg active:bg-surface-2',
        quiet: 'text-muted active:bg-surface-2',
        danger: 'bg-danger text-white active:opacity-90',
        'danger-soft': 'bg-danger-soft text-danger active:opacity-85',
        accentSoft: 'bg-accent-soft text-accent active:opacity-85',
      },
      size: {
        sm: 'h-10 min-h-10 px-3.5 text-body',
        md: 'h-11 min-h-11 px-4 text-row',
        lg: 'h-12 min-h-12 px-5 text-row font-semibold',
        icon: 'h-11 w-11 min-h-11',
        'icon-sm': 'h-10 w-10 min-h-10',
      },
    },
    defaultVariants: { variant: 'surface', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
});

export { buttonVariants };
