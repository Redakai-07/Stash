'use client';

import * as React from 'react';
import { Fingerprint, Loader2, Lock, Unlock } from 'lucide-react';
import { devicePromptName, devicePromptTitle } from '@/lib/privacy/auth';
import { shouldPromptForReveal } from '@/lib/privacy/session';
import type { RevealKind } from '@/stores/privacy-store';
import { usePrivacyStore } from '@/stores/privacy-store';
import { Button } from '@/components/ui/button';
import { PasscodeInput } from './passcode-input';

/**
 * The unlock prompt.
 *
 * This is **not** a lock screen for the app, and deliberately so. Stash asks for
 * nothing to open: there is no app password, and the vault is not hidden behind a
 * gate. What is locked is content — a locked folder, note or link is ciphertext on
 * disk with its fields blanked, so it reads as a locked row and its contents are
 * simply not there to show.
 *
 * This dialog exists for exactly one moment: the user tapped one of those rows and
 * the system prompt did not open it. That happens when the prompt is cancelled,
 * when it fails, or when this device has no way to prompt at all — and in all
 * three cases the honest answer is a sentence, not silence. Passing the prompt
 * unlocks every locked item for the session, because there is one vault key: the
 * contents of other locked folders become readable too, until the user moves to
 * another tab or leaves the app.
 *
 * One branch survives for a vault made by an earlier build whose only wrap was a
 * passcode: that vault has no other key in existence, and asking for the passcode
 * is the difference between opening it and destroying access to it. The field is
 * never offered for anything else and nothing writes a passcode any more.
 */

const NOUNS: Record<RevealKind, string> = {
  folder: 'Locked folder',
  note: 'Locked note',
  link: 'Locked link',
};

export function LockGate() {
  const ready = usePrivacyStore((state) => state.ready);
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
  const clearReveal = usePrivacyStore((state) => state.clearReveal);

  const [passcode, setPasscode] = React.useState('');

  // The only reason to show this: something the user tapped is locked and the
  // prompt did not answer for it. Nothing else raises it — not a cold start, not
  // a tab change, not the app coming back to the foreground, not a share.
  const blocking = shouldPromptForReveal({
    ready,
    keyringPresent,
    unlocked,
    hasRevealRequest: revealRequest !== null,
  });
  const devicePath = deviceAuthAvailable && deviceUnlockReady;
  /** A vault from an older build whose only key is a passcode: nothing else can open it. */
  const legacyPasscodeOnly = passcodeSet && !devicePath;

  const submit = React.useCallback(async () => {
    if (passcode.length === 0) return;
    await unlock(passcode);
    // Cleared on failure as well as success: a rejected passcode should not sit
    // in a text field for the next person to see.
    setPasscode('');
  }, [passcode, unlock]);

  if (!blocking) return null;

  const noun = revealRequest ? NOUNS[revealRequest.kind] : 'Locked item';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${noun} — unlock to open`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay px-6 py-10 pt-safe pb-safe"
    >
      <div className="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-5 shadow-raised">
        <Lock size={26} strokeWidth={1.7} className="text-accent" aria-hidden />

        <h1 className="text-title mt-3 font-semibold tracking-tight text-fg">{noun}</h1>
        <p className="text-meta mt-1.5 leading-relaxed text-muted">
          {devicePath
            ? `Unlock with ${devicePromptName(deviceStoreKind)} to open it. Everything else stays readable, and the other locked folders open too — until you switch tabs or leave Stash.`
            : legacyPasscodeOnly
              ? 'This vault was created with a passcode, and its key is wrapped by that passcode alone — there is no device key to ask.'
              : 'This device cannot show its lock prompt right now, so this item cannot be opened here. Everything else stays readable.'}
        </p>

        {devicePath ? (
          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
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
          <p className="text-meta mt-3 leading-relaxed text-danger" role="status">
            {message}
          </p>
        ) : null}

        {legacyPasscodeOnly ? (
          <div className="mt-4">
            <PasscodeInput
              label="Passcode"
              value={passcode}
              onChange={setPasscode}
              onSubmit={() => void submit()}
              autoFocus
              disabled={busy}
              tone={message ? 'danger' : 'default'}
              hint={
                <span>
                  This vault was created with a passcode, and its key is wrapped by that passcode alone — there is no
                  device key to ask. Nothing can reset it, including us.
                </span>
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
        ) : null}

        <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => clearReveal()}>
          Not now
        </Button>
      </div>
    </div>
  );
}
