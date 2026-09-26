'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'tap inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent',
        'data-[state=unchecked]:bg-surface-3 data-[state=checked]:bg-accent',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-6 w-6 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-out',
          'data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
