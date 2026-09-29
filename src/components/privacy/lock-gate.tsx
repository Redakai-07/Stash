'use client';

import * as React from 'react';
import { Fingerprint, KeyRound, Loader2, Lock, LockKeyhole, Unlock } from 'lucide-react';
import { devicePromptName, devicePromptTitle } from '@/lib/privacy/auth';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PasscodeInput } from './passcode-input';

/**
 * The lock gate.
 *
 * Shown when the session is locked. It is deliberately *not* the last line of
 * defence — it is the explanation. The actual protection is that locked content
 * is ciphertext and its key is not in memory, so the items are unreadable
 * whether this gate is shown or not.
 *
 * The order of the two ways in matters. The device prompt comes first and runs
 * by itself, because that is the whole point of setting locking up this way:
 * there is nothing to remember, nothing to type, and no password to invent.
 * The Stash passcode sits underneath it, behind one tap, for the cases where the
 * prompt is unavailable or the device key is gone — and it is the only way in at
 * all on a vault that has a passcode but no armed device key.
 */

export function LockGate() {
  const ready = usePrivacyStore((state) => state.ready);
  const settings = usePrivacyStore((state) => state.settings);
  const keyringPresent = usePrivacyStore((state) => state.keyringPresent);
  const passcodeSet = usePrivacyStore((state) => state.passcodeSet);
  const unlocked = usePrivacyStore((state) => state.unlocked);
  const deviceAuthAvailable = usePrivacyStore((state) => state.deviceAuthAvailable);
  const deviceUnlockReady = usePrivacyStore((state) => state.deviceUnlockReady);
  const deviceStoreKind = usePrivacyStore((state) => state.deviceStoreKind);
  const revealRequest = usePrivacyStore((state) => state.revealRequest);
  const message = usePrivacyStore((state) => state.message);
  const busy = usePrivacyStore((state) => state.busy);
  const unlock = usePrivacyStore((state) => state.unlock);
  const unlockWithBiometrics = usePrivacyStore((state) => state.unlockWithBiometrics);
  const hasProtected = useVaultStore(
    (state) => state.protection.folders.size + state.protection.notes.size + state.protection.links.size > 0,
  );

  const [passcode, setPasscode] = React.useState('');
  const [skipped, setSkipped] = React.useState(false);
  // Revealed when there is no device path to offer, or when the user asks.
  const [showPasscode, setShowPasscode] = React.useState(false);

  // Two reasons to cover the screen: locking is configured to cover the app, or
  // the user just tapped a locked item. The second one matters when locking is
  // set to cover only locked items — nothing else would ever ask them.
  const blocking =
    ready && keyringPresent && !unlocked && (revealRequest !== null || (settings.lockApp !== false && !skipped));
  const devicePath = deviceAuthAvailable && deviceUnlockReady;
  const passcodeFieldVisible = showPasscode || !devicePath;

  /**
   * Prompt on arrival.
   *
   * Once per visit, and only while nothing has failed: a dialog that reappears
   * after a cancellation is the behaviour people hate about this pattern. If the
   * prompt cannot work here, the passcode field is simply already open instead.
   */
  const prompted = React.useRef(false);
  const unlockWithBiometricsRef = React.useRef(unlockWithBiometrics);
  React.useEffect(() => {
    unlockWithBiometricsRef.current = unlockWithBiometrics;
  }, [unlockWithBiometrics]);

  React.useEffect(() => {
    // Not when the arrival was itself a reveal request: the prompt has just been
    // shown and dismissed, and asking again immediately is exactly the behaviour
    // people hate about this pattern. The button stays there to try again.
    if (!blocking || !devicePath || revealRequest || prompted.current) return;
    prompted.current = true;
    void unlockWithBiometricsRef.current();
  }, [blocking, devicePath, revealRequest]);

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
        <h1 className="text-display font-semibold tracking-tight text-fg">
          {revealRequest ? 'That item is locked' : 'Stash is locked'}
        </h1>
        <p className="mt-1.5 max-w-xs text-meta leading-relaxed text-muted">
          {revealRequest
            ? `Unlock to open it. ${devicePath ? `${devicePromptName(deviceStoreKind)} will ask for you.` : 'Your passcode opens it.'}`
            : devicePath
              ? `Unlock with ${devicePromptName(deviceStoreKind)}. Nothing else is shown until you do.`
              : 'Locked notes, links and folders stay encrypted until you unlock. Everything else is on this device as usual.'}
        </p>
      </div>

      {devicePath ? (
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
          Unlock with {devicePromptTitle(deviceStoreKind)}
        </Button>
      ) : null}

      {message ? (
        <p className="max-w-xs text-center text-meta leading-relaxed text-danger" role="status">
          {message}
        </p>
      ) : null}

      {passcodeFieldVisible ? (
        <div className="w-full max-w-xs">
          <PasscodeInput
            label="Stash passcode"
            value={passcode}
            onChange={setPasscode}
            onSubmit={() => void submit()}
            autoFocus={!devicePath}
            disabled={busy}
            tone={message ? 'danger' : 'default'}
            hint={
              devicePath ? (
                <span>The passcode you set beside the device lock.</span>
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
      ) : passcodeSet ? (
        <button
          type="button"
          onClick={() => setShowPasscode(true)}
          className="tap flex items-center gap-1.5 rounded-xl px-3 py-2 text-meta font-medium text-accent active:bg-accent-soft"
        >
          <KeyRound size={15} strokeWidth={2} aria-hidden />
          Use your Stash passcode
        </button>
      ) : (
        <p className="max-w-xs text-center text-meta leading-relaxed text-subtle">
          This vault was set up with the device lock only, so there is no passcode to fall back on.
        </p>
      )}

      <button
        type="button"
        onClick={() => setSkipped(true)}
        className={cn(
          'tap mt-2 max-w-xs rounded-xl px-3 py-2 text-center text-meta leading-relaxed text-subtle',
          'active:bg-surface-2',
        )}
      >
        {hasProtected
          ? 'Continue without unlocking — locked items stay unreadable'
          : 'Continue without unlocking'}
      </button>

      <p className="flex max-w-xs items-center gap-1.5 text-center text-label text-subtle">
        <LockKeyhole size={13} strokeWidth={2} aria-hidden />
        {/* Says which ways in exist, not which ways were configured once: an armed
            device key on a machine that can no longer prompt is not a way in. */}
        {[passcodeSet ? 'Passcode set' : null, devicePath ? 'device prompt ready' : null]
          .filter(Boolean)
          .join(' · ') || 'No passcode — device lock only'}
      </p>
    </div>
  );
}
