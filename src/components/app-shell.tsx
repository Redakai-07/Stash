'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FilePlus2, Plus } from 'lucide-react';
import { BottomNav } from './bottom-nav';
import { CaptureSheet } from './capture/capture-sheet';
import { LockGate } from './privacy/lock-gate';
import { Toaster, toast } from './ui/toast';
import { useCaptureStore } from '@/stores/capture-store';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';

/**
 * The one-handed shell.
 *
 * The page never scrolls as a whole; the main region does. That keeps the tab
 * bar pinned, makes the gesture bar behave, and means a sheet can take over the
 * screen without the underlying page shifting behind it.
 *
 * The floating action follows the context: on Notes it creates a note, anywhere
 * else it captures a link. One button, but always the action that screen is for.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const openManual = useCaptureStore((state) => state.openManual);

  const onNotes = pathname === '/notes' || pathname.startsWith('/notes/');
  const onSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  const showFab = !onSettings;
  const [busy, setBusy] = React.useState(false);

  const handleAction = React.useCallback(async () => {
    if (!onNotes) {
      openManual();
      return;
    }
    setBusy(true);
    const result = await useVaultStore.getState().createNote({ title: 'New note', content: '', parentNoteId: null });
    setBusy(false);
    if (!result.ok) {
      toast(result.message, { tone: 'danger' });
      return;
    }
    router.push(`/notes?note=${result.note.id}`);
  }, [onNotes, openManual, router]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg pt-safe">
      <main id="main" className="scroll-area relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>

      {showFab ? (
        <button
          type="button"
          onClick={() => void handleAction()}
          disabled={busy}
          aria-label={onNotes ? 'New note' : 'Add a link'}
          className={cn(
            'tap tap-scale absolute right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30',
            'flex size-13 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-raised',
            'disabled:opacity-60',
          )}
        >
          {onNotes ? (
            <FilePlus2 size={23} strokeWidth={2.1} aria-hidden />
          ) : (
            <Plus size={24} strokeWidth={2.2} aria-hidden />
          )}
        </button>
      ) : null}

      <BottomNav />
      <CaptureSheet />
      <Toaster />
      {/* Last so it paints over the shell, the sheets and the toasts alike. */}
      <LockGate />
    </div>
  );
}
