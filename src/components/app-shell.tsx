'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FilePlus2, Plus } from 'lucide-react';
import { BottomNav } from './bottom-nav';
import { AndroidBack } from './android-back';
import { CaptureSheet } from './capture/capture-sheet';
import { LockGate } from './privacy/lock-gate';
import { Toaster, toast } from './ui/toast';
import { useCaptureStore } from '@/stores/capture-store';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useVaultStore } from '@/stores/vault-store';
import { cn } from '@/lib/utils';

/**
 * The top-level section a route belongs to.
 *
 * `/` is Home; anything else is its first segment. Used to tell "the user moved
 * to another tab" from "the user went deeper into this one", which is the whole
 * difference between ending an unlocked session and getting in the way.
 */
function sectionOf(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

/**
 * The one-handed shell.
 *
 * The page never scrolls as a whole; the main region does. That keeps the tab
 * bar pinned, makes the gesture bar behave, and means a sheet can take over the
 * screen without the underlying page shifting behind it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const captureStatus = useCaptureStore((state) => state.status);
  const captureMode = useCaptureStore((state) => state.mode);
  const pathname = usePathname() ?? '/';
  const lockOnTabChange = usePrivacyStore((state) => state.lockOnTabChange);

  /*
   * An unlock lasts for the session, and the session is the tab.
   *
   * Opening a folder or a note does not leave the section, so walking around
   * inside one does not re-lock anything. Moving to a different top-level screen
   * does — and the one navigation that is exempt is the one a reveal caused, which
   * `lockOnTabChange` recognises by having just happened (see `session.ts`).
   */
  const section = sectionOf(pathname);
  const previousSection = React.useRef(section);
  React.useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    lockOnTabChange();
  }, [section, lockOnTabChange]);

  /*
   * While an incoming share is being handled the chrome is not drawn at all.
   * The capture surface covers the screen, so the tab bar and the action button
   * would only ever be a flash of somebody else's screen behind the fade-in.
   */
  const shareTakeover = captureStatus !== 'idle' && captureMode === 'share';

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg px-safe pt-safe">
      <main id="main" className="scroll-area relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>

      {shareTakeover ? null : <React.Suspense fallback={null}>{<ContextAction />}</React.Suspense>}

      {shareTakeover ? null : <BottomNav />}
      <CaptureSheet />
      <Toaster />
      {/* Registered once, above every screen: the hardware back button. */}
      <AndroidBack />
      {/* Last so it paints over the shell, the sheets and the toasts alike. */}
      <LockGate />
    </div>
  );
}

/**
 * The floating action, wherever the user is.
 *
 * One button that is always the action the current screen is for: on Notes it
 * creates a note, anywhere else it captures a link. Two cases make it step
 * aside, and both are about the button being wrong rather than ugly:
 *
 *  - **A note is open in the editor.** The editor owns the bottom of the screen
 *    with its formatting bar, which sits in exactly the space this button
 *    occupies. A floating button on top of a toolbar is a button nobody can tap,
 *    and creating a *new* note is not what anyone is doing mid-sentence.
 *  - **A share is being handled**, because the capture surface is the whole
 *    screen by then.
 *
 * This is a child of the shell, and wrapped in Suspense, for one reason:
 * `useSearchParams` has to suspend during prerendering, and the shell is in the
 * root layout where there is no boundary above it.
 */
function ContextAction() {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const router = useRouter();
  const openManual = useCaptureStore((state) => state.openManual);
  const [busy, setBusy] = React.useState(false);

  const onNotes = pathname === '/notes' || pathname.startsWith('/notes/');
  const onSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  const editingNote = onNotes && params.has('note');

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

  if (onSettings || editingNote) return null;

  return (
    <button
      type="button"
      onClick={() => void handleAction()}
      disabled={busy}
      aria-label={onNotes ? 'New note' : 'Add a link'}
      className={cn(
        // `bottom-20 mb-safe` sits it one clear step above the tab bar, and adds
        // the system inset through the same variable the bar itself uses.
        'tap tap-scale absolute right-4 bottom-20 z-30 mb-safe',
        'flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-raised',
        'disabled:opacity-60',
      )}
    >
      {onNotes ? <FilePlus2 size={25} strokeWidth={2.1} aria-hidden /> : <Plus size={26} strokeWidth={2.2} aria-hidden />}
    </button>
  );
}
