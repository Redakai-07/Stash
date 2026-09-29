'use client';

import * as React from 'react';
import { Fingerprint, Loader2, Lock, Unlock } from 'lucide-react';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PasscodeInput } from './passcode-input';

/**
 * The lock gate.
 *
 * Shown when a passcode is set and the session is locked. It is deliberately
 * *not* the last line of defence — it is the explanation. The actual protection
 * is that locked content is ciphertext and its key is not in memory, so the
 * items are absent from every screen whether this gate is shown or not.
 *
 * That distinction is what makes the escape hatch at the bottom honest rather
 * than a hole: skipping the gate shows the app's non-locked content, and the
 * locked items stay hidden and unreadable exactly as before.
 */
export function LockGate() {
  const ready = usePrivacyStore((state) => state.ready);
  const settings = usePrivacyStore((state) => state.settings);
  const keyringPresent = usePrivacyStore((state) => state.keyringPresent);
  const unlocked = usePrivacyStore((state) => state.unlocked);
  const deviceAuthAvailable = usePrivacyStore((state) => state.deviceAuthAvailable);
  const deviceUnlockReady = usePrivacyStore((state) => state.deviceUnlockReady);
  const message = usePrivacyStore((state) => state.message);
  const busy = usePrivacyStore((state) => state.busy);
  const unlock = usePrivacyStore((state) => state.unlock);
  const unlockWithBiometrics = usePrivacyStore((state) => state.unlockWithBiometrics);
  const hasProtected = useVaultStore((state) => state.protection.folders.size + state.protection.notes.size + state.protection.links.size > 0);

  const [passcode, setPasscode] = React.useState('');
  const [skipped, setSkipped] = React.useState(false);

  const blocking = ready && keyringPresent && !unlocked && settings.lockApp !== false && !skipped;

  const submit = React.useCallback(async () => {
    if (passcode.length === 0) return;
    const result = await unlock(passcode);
    // Clear on success and on failure alike: a rejected passcode should not sit
    // in a text field for the next person to see.
    setPasscode('');
    return result;
  }, [passcode, unlock]);

  if (!blocking) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stash is locked"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-bg px-6 py-10 pt-safe pb-safe"
    >
      <Lock size={30} strokeWidth={1.7} className="text-accent" aria-hidden />

      <div className="text-center">
        <h1 className="text-display font-semibold tracking-tight text-fg">Stash is locked</h1>
        <p className="mt-1.5 max-w-xs text-meta leading-relaxed text-muted">
          Locked notes, links and folders stay encrypted until you unlock. Everything else is on this device as
          usual.
        </p>
      </div>

      {deviceAuthAvailable && deviceUnlockReady ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full max-w-xs"
          disabled={busy}
          onClick={() => void unlockWithBiometrics()}
        >
          {busy ? (
            <Loader2 size={19} strokeWidth={2.2} className="animate-spin" aria-hidden />
          ) : (
            <Fingerprint size={19} strokeWidth={1.9} aria-hidden />
          )}
          Unlock with your device
        </Button>
      ) : null}

      <div className="w-full max-w-xs">
        <PasscodeInput
          label="Stash passcode"
          value={passcode}
          onChange={setPasscode}
          onSubmit={() => void submit()}
          autoFocus={!deviceUnlockReady}
          disabled={busy}
          tone={message ? 'danger' : 'default'}
          hint={
            message ? (
              message
            ) : (
              <span>
                Your vault key is unlocked by this passcode. There is no reset — nobody, including us, can recover
                it.
              </span>
            )
          }
        />
        <Button
          variant="accentSoft"
          size="lg"
          className="mt-3 w-full"
          disabled={busy || passcode.length === 0}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 size={19} strokeWidth={2.2} className="animate-spin" aria-hidden />
          ) : (
            <Unlock size={19} strokeWidth={1.9} aria-hidden />
          )}
          Unlock
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setSkipped(true)}
        className={cn(
          'tap mt-2 max-w-xs rounded-xl px-3 py-2 text-center text-meta leading-relaxed text-subtle',
          'active:bg-surface-2',
        )}
      >
        {hasProtected
          ? 'Continue without unlocking — locked items stay hidden and unreadable'
          : 'Continue without unlocking'}
      </button>
    </div>
  );
}
