'use client';

import * as React from 'react';
import { create } from 'zustand';
import { CircleCheck, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Confirmations and failures.
 *
 * Deliberately not a notification centre: one message at a time, auto-dismissed
 * except for undo-style actions, which get a longer window because the user has
 * to decide something.
 */

export type ToastTone = 'default' | 'success' | 'danger';

export interface ToastAction {
  label: string;
  onSelect: () => void;
}

interface ToastRecord {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  duration: number;
}

interface ToastStore {
  toasts: ToastRecord[];
  push: (toast: Omit<ToastRecord, 'id'>) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    counter += 1;
    const id = `toast-${counter}`;
    set((state) => ({ toasts: [...state.toasts.filter((item) => item.message !== toast.message), { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
}

export function toast(message: string, options: ToastOptions = {}): string {
  const duration = options.duration ?? (options.action ? 6000 : 2600);
  return useToastStore.getState().push({
    message,
    tone: options.tone ?? 'default',
    duration,
    ...(options.action ? { action: options.action } : {}),
  });
}

export function dismissToast(id: string): void {
  useToastStore.getState().dismiss(id);
}

const TONE_ICON = {
  default: Info,
  success: CircleCheck,
  danger: AlertTriangle,
} as const;

function ToastRow({ record }: { record: ToastRecord }) {
  const dismiss = useToastStore((state) => state.dismiss);

  React.useEffect(() => {
    const timer = window.setTimeout(() => dismiss(record.id), record.duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, record.duration, record.id]);

  const ToneIcon = TONE_ICON[record.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'animate-rise pointer-events-auto flex w-full items-center gap-3 rounded-xl',
        'border border-border bg-surface px-3.5 py-2.5 shadow-raised',
      )}
    >
      <ToneIcon
        size={18}
        strokeWidth={2}
        aria-hidden
        className={cn(
          record.tone === 'success' && 'text-success',
          record.tone === 'danger' && 'text-danger',
          record.tone === 'default' && 'text-accent',
        )}
      />
      <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug text-fg">{record.message}</p>
      {record.action ? (
        <button
          type="button"
          onClick={() => {
            record.action?.onSelect();
            dismiss(record.id);
          }}
          className="tap shrink-0 rounded-lg px-2 py-1 text-[0.9375rem] font-semibold text-accent active:bg-accent-soft"
        >
          {record.action.label}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => dismiss(record.id)}
          aria-label="Dismiss"
          className="tap -mr-1 shrink-0 rounded-lg p-1.5 text-subtle active:bg-surface-2"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Rendered once by the app shell. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {toasts.slice(-2).map((record) => (
        <ToastRow key={record.id} record={record} />
      ))}
    </div>
  );
}
