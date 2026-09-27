'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Fingerprint,
  KeyRound,
  Lock,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Unlock,
} from 'lucide-react';
import { pluralize } from '@/lib/format';
import { RELOCK_POLICIES } from '@/lib/privacy/session';
import type { RelockPolicy } from '@/db/types';
import { usePrivacyStore } from '@/stores/privacy-store';
import { useVaultStore } from '@/stores/vault-store';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Section } from '@/components/ui/page';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PasscodeInput, PasscodeReassurance, validateNewPasscode } from './passcode-input';

/**
 * Privacy settings.
 *
 * Written to be read by someone deciding whether to trust the app with something
 * private, so the limitations are stated next to the switches rather than buried
 * in a policy page. In particular: what is encrypted, what stays visible, and the
 * fact that a forgotten passcode means the locked items are gone.
 */

type Mode = 'idle' | 'create' | 'change' | 'disable' | 'abandon';

export function PrivacySettings() {
  const ready = usePrivacyStore((state) => state.ready);
  const settings = usePrivacyStore((state) => state.settings);
  const keyringPresent = usePrivacyStore((state) => state.keyringPresent);
  const unlocked = usePrivacyStore((state) => state.unlocked);
  const deviceAuthAvailable = usePrivacyStore((state) => state.deviceAuthAvailable);
  const deviceUnlockReady = usePrivacyStore((state) => state.deviceUnlockReady);
  const busy = usePrivacyStore((state) => state.busy);

  const createPasscode = usePrivacyStore((state) => state.createPasscode);
  const changePasscode = usePrivacyStore((state) => state.changePasscode);
  const disable = usePrivacyStore((state) => state.disable);
  const abandonLock = usePrivacyStore((state) => state.abandonLock);
  const update = usePrivacyStore((state) => state.update);
  const armBiometrics = usePrivacyStore((state) => state.armBiometrics);
  const disarmBiometrics = usePrivacyStore((state) => state.disarmBiometrics);
  const lock = usePrivacyStore((state) => state.lock);

  const protection = useVaultStore((state) => state.protection);

  const [mode, setMode] = React.useState<Mode>('idle');
  const [passcode, setPasscode] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  /** Only used by the change-passcode flow; the current secret, never stored. */
  const [current, setCurrent] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const lockedCounts = {
    folders: protection.folders.size,
    notes: protection.notes.size,
    links: protection.links.size,
  };
  const hasLocks = lockedCounts.folders + lockedCounts.notes + lockedCounts.links > 0;

  const reset = () => {
    setMode('idle');
    setPasscode('');
    setConfirmation('');
    setCurrent('');
    setError(null);
  };

  const submitCreate = async () => {
    const invalid = validateNewPasscode(passcode, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    const result = await createPasscode(passcode);
    if (!result.ok) {
      setError(result.message ?? 'Could not set a passcode.');
      return;
    }
    reset();
    toast('Locking is on', { tone: 'success' });
  };

  const submitChange = async () => {
    const invalid = validateNewPasscode(passcode, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    const result = await changePasscode(current, passcode);
    if (!result.ok) {
      setError(result.message ?? 'Could not change the passcode.');
      return;
    }
    reset();
    toast('Passcode changed', { tone: 'success' });
  };

  const submitDisable = async () => {
    const result = await disable(passcode);
    if (!result.ok) {
      setError(result.message ?? 'Could not turn locking off.');
      return;
    }
    reset();
    toast('Locking is off. Everything is readable again.', { tone: 'success' });
  };

  const setPolicy = (policy: RelockPolicy) => {
    void update({ relockPolicy: policy });
  };

  if (!ready) return null;

  return (
    <>
      <Section title="Locking">
        <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-fg">
                {keyringPresent ? (
                  <LockKeyhole size={17} strokeWidth={1.9} className="shrink-0 text-accent" aria-hidden />
                ) : (
                  <Lock size={17} strokeWidth={1.9} className="shrink-0 text-subtle" aria-hidden />
                )}
                {keyringPresent ? (unlocked ? 'Unlocked' : 'Locked') : 'Not set up'}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-subtle">
                {keyringPresent
                  ? hasLocks
                    ? `${pluralize(lockedCounts.notes, 'note')}, ${pluralize(lockedCounts.links, 'link')} and ${pluralize(lockedCounts.folders, 'folder')} protected`
                    : 'No items are locked yet. Lock a folder, note or link to use this.'
                  : 'Set a passcode to lock folders, notes and links so they are encrypted at rest.'}
              </p>
            </div>
            {keyringPresent && unlocked ? (
              <Button variant="surface" size="sm" onClick={() => lock()}>
                Lock now
              </Button>
            ) : null}
          </div>

          {mode === 'idle' ? (
            <div className="border-t border-border px-3 py-3">
              {!keyringPresent ? (
                <>
                  <Button variant="accentSoft" className="w-full" onClick={() => setMode('create')}>
                    <ShieldCheck size={18} strokeWidth={1.9} aria-hidden />
                    Set a passcode
                  </Button>
                  <PasscodeReassurance className="mt-2.5 px-0.5" />
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button variant="surface" className="justify-start" onClick={() => setMode('change')}>
                    <KeyRound size={18} strokeWidth={1.9} aria-hidden />
                    Change passcode
                  </Button>
                  <Button
                    variant="surface"
                    className="justify-start"
                    onClick={() => {
                      setMode('disable');
                    }}
                  >
                    <Unlock size={18} strokeWidth={1.9} aria-hidden />
                    Turn locking off
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {mode === 'create' ? (
            <div className="border-t border-border px-3 py-3">
              <div className="flex flex-col gap-3">
                <PasscodeInput
                  label="New passcode"
                  value={passcode}
                  onChange={(value) => {
                    setPasscode(value);
                    setError(null);
                  }}
                  autoFocus
                  disabled={busy}
                />
                <PasscodeInput
                  label="Confirm passcode"
                  value={confirmation}
                  onChange={(value) => {
                    setConfirmation(value);
                    setError(null);
                  }}
                  onSubmit={() => void submitCreate()}
                  disabled={busy}
                  tone={error ? 'danger' : 'default'}
                  hint={error ?? undefined}
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => void submitCreate()} disabled={busy}>
                    Turn on locking
                  </Button>
                </div>
                <PasscodeReassurance />
              </div>
            </div>
          ) : null}

          {mode === 'change' ? (
            <div className="border-t border-border px-3 py-3">
              <div className="flex flex-col gap-3">
                <PasscodeInput
                  label="Current passcode"
                  value={current}
                  onChange={(value) => {
                    setCurrent(value);
                    setError(null);
                  }}
                  autoFocus
                  disabled={busy}
                />
                <PasscodeInput
                  label="New passcode"
                  value={passcode}
                  onChange={(value) => {
                    setPasscode(value);
                    setError(null);
                  }}
                  disabled={busy}
                />
                <PasscodeInput
                  label="Confirm new passcode"
                  value={confirmation}
                  onChange={(value) => {
                    setConfirmation(value);
                    setError(null);
                  }}
                  onSubmit={() => void submitChange()}
                  disabled={busy}
                  tone={error ? 'danger' : 'default'}
                  hint={error ?? 'Changing the passcode re-wraps the key. Nothing is re-encrypted.'}
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => void submitChange()} disabled={busy}>
                    Save passcode
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {mode === 'disable' ? (
            <div className="border-t border-border px-3 py-3">
              <div className="flex flex-col gap-3">
                <p className="rounded-xl border border-warning/30 bg-surface-2 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg/85">
                  Turning locking off decrypts every locked item and stores it in the clear again. The passcode is
                  removed.
                </p>
                <PasscodeInput
                  label="Passcode"
                  value={passcode}
                  onChange={(value) => {
                    setPasscode(value);
                    setError(null);
                  }}
                  onSubmit={() => void submitDisable()}
                  autoFocus
                  disabled={busy}
                  tone={error ? 'danger' : 'default'}
                  hint={error ?? undefined}
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="surface" className="flex-1" onClick={() => void submitDisable()} disabled={busy}>
                    Turn off and decrypt
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Section>

      {keyringPresent ? (
        <>
          <Section title="Re-lock">
            <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface">
              {RELOCK_POLICIES.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPolicy(option.id)}
                  aria-pressed={settings.relockPolicy === option.id}
                  className={cn(
                    'tap flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                    index > 0 && 'border-t border-border',
                    settings.relockPolicy === option.id ? 'bg-accent-soft' : 'active:bg-surface-2',
                  )}
                >
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-[0.9375rem] font-medium',
                        settings.relockPolicy === option.id ? 'text-accent' : 'text-fg',
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">{option.description}</span>
                  </span>
                  {settings.relockPolicy === option.id ? (
                    <span className="shrink-0 text-[0.6875rem] font-bold tracking-wide text-accent uppercase">
                      Active
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="px-5 pt-2 text-xs leading-relaxed text-subtle">
              Locking drops the vault key from memory. Locked items stay encrypted on disk either way — this only
              controls how soon you must unlock again.
            </p>
          </Section>

          <Section title="Protection">
            <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface">
              <ToggleRow
                icon={<Lock size={17} strokeWidth={1.9} aria-hidden />}
                label="Cover the app when locked"
                description="Show the lock screen over everything until you unlock."
                checked={settings.lockApp !== false}
                onChange={(value) => void update({ lockApp: value })}
              />
              <ToggleRow
                icon={<Smartphone size={17} strokeWidth={1.9} aria-hidden />}
                label="Block screenshots and app previews"
                description="Not recommended for everyday use: it also blocks screen recording while unlocked."
                checked={settings.secureScreen}
                onChange={(value) => void update({ secureScreen: value })}
                last
              />
            </div>
          </Section>

          <Section title="Device unlock">
            <div className="mx-4 overflow-hidden rounded-2xl border border-border bg-surface">
              <ToggleRow
                icon={<Fingerprint size={17} strokeWidth={1.9} aria-hidden />}
                label="Use fingerprint or face"
                description={
                  deviceAuthAvailable
                    ? 'A device key in Android Keystore unwraps the vault key after a successful prompt.'
                    : 'No biometrics or screen lock are set up on this device.'
                }
                checked={settings.biometric && deviceUnlockReady}
                disabled={!deviceAuthAvailable}
                onChange={(value) => {
                  if (!value) {
                    void disarmBiometrics();
                    return;
                  }
                  void armBiometrics().then((result) => {
                    if (!result.ok) {
                      toast(result.message ?? 'Could not turn on device unlock', { tone: 'danger' });
                    }
                  });
                }}
                last
              />
            </div>
            {!deviceUnlockReady && settings.biometric && deviceAuthAvailable ? (
              <p className="px-5 pt-2 text-xs leading-relaxed text-subtle">
                Unlock once with your passcode to arm the biometric fast path on this device.
              </p>
            ) : null}
          </Section>

          <Section title="What is protected">
            <div className="mx-4 rounded-2xl border border-border bg-surface p-4">
              <ul className="flex flex-col gap-2 text-[0.8125rem] leading-relaxed text-muted">
                <li>
                  <span className="font-medium text-fg">Encrypted:</span> a locked item&apos;s note title and body,
                  a locked link&apos;s address and title, and a locked folder&apos;s name. Locking a folder covers
                  everything inside it.
                </li>
                <li>
                  <span className="font-medium text-fg">Still visible:</span> the fact that a locked item exists,
                  how the tree is arranged, timestamps, favourites, tags and which app a link came from. Sizes and
                  counts of locked folders are hidden while locked.
                </li>
                <li>
                  <span className="font-medium text-fg">Key location:</span> the vault key is wrapped by your
                  passcode and the wrapped form is the only copy stored. It is never in the backup file&apos;s
                  plaintext, in a browser store, or in the app&apos;s code.
                </li>
                <li>
                  <span className="font-medium text-fg">After a restart:</span> the vault opens locked and the key
                  exists only in your passcode and, if enabled, in Android Keystore-backed storage.
                </li>
              </ul>
            </div>
          </Section>

          <Section title="If you forget the passcode" className="pb-10">
            <div className="mx-4 rounded-2xl border border-danger/30 bg-danger-soft p-4">
              <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-danger">
                <AlertTriangle size={17} strokeWidth={2} aria-hidden />
                There is no recovery
              </p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg/85">
                Your passcode is the only thing that opens locked items. Nothing else is deleted if you never
                unlock again — the rest of your vault keeps working normally.
              </p>
              {mode === 'abandon' ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-[0.8125rem] leading-relaxed text-danger">
                    Removing the lock destroys the key. Every locked note, link and folder becomes permanently
                    unreadable and cannot be recovered on any device.
                  </p>
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={() => {
                      void abandonLock();
                      reset();
                      toast('Lock removed. Locked items are now unreadable.', { tone: 'danger' });
                    }}
                  >
                    Remove the lock permanently
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={reset}>
                    Keep my lock
                  </Button>
                </div>
              ) : (
                <Button variant="surface" className="mt-3 w-full" onClick={() => setMode('abandon')}>
                  Remove the lock without unlocking
                </Button>
              )}
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3.5', !last && 'border-b border-border')}>
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
        className="mt-1 shrink-0"
      />
    </div>
  );
}
