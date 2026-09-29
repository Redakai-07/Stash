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
import { devicePromptName } from '@/lib/privacy/auth';
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

type Mode = 'idle' | 'create' | 'add-passcode' | 'change' | 'disable' | 'abandon';

export function PrivacySettings() {
  const ready = usePrivacyStore((state) => state.ready);
  const settings = usePrivacyStore((state) => state.settings);
  const keyringPresent = usePrivacyStore((state) => state.keyringPresent);
  const passcodeSet = usePrivacyStore((state) => state.passcodeSet);
  const unlocked = usePrivacyStore((state) => state.unlocked);
  const deviceAuthAvailable = usePrivacyStore((state) => state.deviceAuthAvailable);
  const deviceUnlockReady = usePrivacyStore((state) => state.deviceUnlockReady);
  const deviceStoreKind = usePrivacyStore((state) => state.deviceStoreKind);
  const busy = usePrivacyStore((state) => state.busy);

  const createPasscode = usePrivacyStore((state) => state.createPasscode);
  const createWithDevice = usePrivacyStore((state) => state.createWithDevice);
  const addPasscode = usePrivacyStore((state) => state.addPasscode);
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

  /** Locking with the system prompt alone — no passcode to invent. */
  const submitCreateWithDevice = async () => {
    const result = await createWithDevice();
    if (!result.ok) {
      setError(result.message ?? 'Could not turn on locking.');
      return;
    }
    reset();
    toast('Locking is on', { tone: 'success' });
  };

  /** Give a device-locked vault a second, portable way in. */
  const submitAddPasscode = async () => {
    const invalid = validateNewPasscode(passcode, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    const result = await addPasscode(passcode);
    if (!result.ok) {
      setError(result.message ?? 'Could not add a passcode.');
      return;
    }
    reset();
    toast('Passcode added', { tone: 'success' });
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
        <div className="mx-4 overflow-hidden rounded-control border border-hairline bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-row font-medium text-fg">
                {keyringPresent ? (
                  <LockKeyhole size={17} strokeWidth={1.9} className="shrink-0 text-accent" aria-hidden />
                ) : (
                  <Lock size={17} strokeWidth={1.9} className="shrink-0 text-subtle" aria-hidden />
                )}
                {keyringPresent ? (unlocked ? 'Unlocked' : 'Locked') : 'Not set up'}
              </p>
              <p className="mt-0.5 text-meta leading-relaxed text-subtle">
                {keyringPresent
                  ? hasLocks
                    ? `${pluralize(lockedCounts.notes, 'note')}, ${pluralize(lockedCounts.links, 'link')} and ${pluralize(lockedCounts.folders, 'folder')} protected · ${passcodeSet ? 'passcode set' : 'device lock only'}`
                    : `No items are locked yet. Lock a folder, note or link to use this. ${passcodeSet ? 'Your passcode is set.' : 'No passcode is set on this device.'}`
                  : 'Lock folders, notes and links so they are encrypted at rest. Use your device lock, a passcode, or both.'}
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
                <div className="flex flex-col gap-2">
                  {/*
                    * The device prompt is offered first, because it is the
                    * setup that asks nothing of the user's memory. Its cost is
                    * stated in the same breath rather than discovered later.
                    */}
                  {deviceAuthAvailable ? (
                    <>
                      <Button
                        variant="accentSoft"
                        className="w-full"
                        onClick={() => void submitCreateWithDevice()}
                        disabled={busy}
                      >
                        <Fingerprint size={18} strokeWidth={1.9} aria-hidden />
                        Use {devicePromptName(deviceStoreKind)}
                      </Button>
                      <p className="px-0.5 text-meta leading-relaxed text-subtle">
                        Nothing to remember and nothing to type. Locked items on this device can only be opened with
                        that prompt — so if the app&apos;s data is cleared, they cannot be recovered. Add a passcode
                        below and they travel with your backup instead.
                      </p>
                    </>
                  ) : (
                    <p className="px-0.5 text-meta leading-relaxed text-subtle">
                      {deviceStoreKind === 'web'
                        ? 'This computer cannot prompt for a device unlock yet. Set up Windows Hello or a PIN in Windows Settings, or set a passcode below.'
                        : 'This device has no screen lock or enrolled biometrics yet. Set one up, or set a passcode below.'}
                    </p>
                  )}
                  <Button variant="surface" className="w-full justify-start" onClick={() => setMode('create')}>
                    <ShieldCheck size={18} strokeWidth={1.9} aria-hidden />
                    Set a passcode instead
                  </Button>
                  <PasscodeReassurance className="mt-0.5 px-0.5" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {passcodeSet ? (
                    <Button variant="surface" className="justify-start" onClick={() => setMode('change')}>
                      <KeyRound size={18} strokeWidth={1.9} aria-hidden />
                      Change passcode
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="accentSoft"
                        className="justify-start"
                        onClick={() => setMode('add-passcode')}
                      >
                        <KeyRound size={18} strokeWidth={1.9} aria-hidden />
                        Add a passcode
                      </Button>
                      <p className="px-0.5 text-meta leading-relaxed text-subtle">
                        Locked items currently open with the device lock alone, so they are tied to this device. A
                        passcode is what lets them survive a new phone, a wiped app or a restore.
                      </p>
                    </>
                  )}
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

          {mode === 'add-passcode' ? (
            <div className="border-t border-border px-3 py-3">
              <div className="flex flex-col gap-3">
                <p className="rounded-xl border border-warning/30 bg-surface-2 px-3 py-2.5 text-meta leading-relaxed text-fg/85">
                  Adding a passcode does not change the key or re-encrypt anything: it wraps the same key a second time,
                  so the vault can be opened without this device.
                </p>
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
                  onSubmit={() => void submitAddPasscode()}
                  disabled={busy}
                  tone={error ? 'danger' : 'default'}
                  hint={error ?? undefined}
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => void submitAddPasscode()} disabled={busy}>
                    Add passcode
                  </Button>
                </div>
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
                <p className="rounded-xl border border-warning/30 bg-surface-2 px-3 py-2.5 text-meta leading-relaxed text-fg/85">
                  Turning locking off decrypts every locked item and stores it in the clear again.{' '}
                  {passcodeSet ? 'The passcode is removed.' : 'The device lock is removed from this vault.'}
                </p>
                {passcodeSet ? (
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
                ) : (
                  <p className="text-meta leading-relaxed text-muted">
                    There is no passcode on this vault, so {devicePromptName(deviceStoreKind)} confirms it instead.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    variant="surface"
                    className="flex-1"
                    disabled={busy || (passcodeSet && passcode.length === 0)}
                    onClick={() => void submitDisable()}
                  >
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
            <div className="mx-4 overflow-hidden rounded-control border border-hairline bg-surface">
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
                        'block text-row font-medium',
                        settings.relockPolicy === option.id ? 'text-accent' : 'text-fg',
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-meta text-subtle">{option.description}</span>
                  </span>
                  {settings.relockPolicy === option.id ? (
                    <span className="shrink-0 text-label font-semibold text-accent">
                      Active
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="px-5 pt-2 text-meta leading-relaxed text-subtle">
              Locking drops the vault key from memory. Locked items stay encrypted on disk either way — this only
              controls how soon you must unlock again.
            </p>
          </Section>

          <Section title="Protection">
            <div className="mx-4 overflow-hidden rounded-control border border-hairline bg-surface">
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
            <div className="mx-4 overflow-hidden rounded-control border border-hairline bg-surface">
              <ToggleRow
                icon={<Fingerprint size={17} strokeWidth={1.9} aria-hidden />}
                label={deviceStoreKind === 'web' ? 'Use Windows Hello' : 'Use fingerprint or face'}
                description={
                  deviceAuthAvailable
                    ? deviceStoreKind === 'web'
                      ? 'Unlocking asks Windows Hello (or your device PIN) and only then unwraps the vault key from this app’s own storage.'
                      : 'A device key in Android Keystore unwraps the vault key after a successful prompt.'
                    : deviceStoreKind === 'web'
                      ? 'This computer has no prompt available yet. Set up Windows Hello or a PIN, then reload Stash.'
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
              <p className="px-5 pt-2 text-meta leading-relaxed text-subtle">
                {passcodeSet
                  ? 'Unlock once with your passcode to arm the fast path on this device.'
                  : 'This vault has no passcode, so the fast path is the only way in — turn it on from the section above.'}
              </p>
            ) : null}
            {keyringPresent && !passcodeSet ? (
              <p className="px-5 pt-2 text-meta leading-relaxed text-warning">
                No passcode is set. Locked items can only be opened on this device, and nothing can recover them if
                this device is lost or the app&apos;s data is cleared.
              </p>
            ) : null}
          </Section>

          <Section title="What is protected">
            <div className="mx-4 rounded-control border border-hairline bg-surface p-4">
              <ul className="flex flex-col gap-2 text-meta leading-relaxed text-muted">
                <li>
                  <span className="font-medium text-fg">Encrypted:</span> a locked item&apos;s note title and body,
                  a locked link&apos;s address and title, and a locked folder&apos;s name. Locking a folder covers
                  everything inside it.
                </li>
                <li>
                  <span className="font-medium text-fg">Still visible:</span> that a locked item exists and where it
                  sits — it keeps its row, its place in the tree, its counts and its timestamps, and shows as a
                  locked entry you can tap to unlock. Also visible: which app a link came from, and its tags.
                </li>
                <li>
                  <span className="font-medium text-fg">Key location:</span> the vault key is wrapped — by your
                  passcode, by the device key, or both — and only the wrapped form is stored. It is never in the
                  backup file&apos;s plaintext, in a browser store, or in the app&apos;s code.
                </li>
                <li>
                  <span className="font-medium text-fg">After a restart:</span> the vault opens locked and the key
                  exists only in your passcode and, where armed, the device key
                  {deviceStoreKind === 'web'
                    ? ' — kept by this app on this computer, behind the system prompt. A passcode is the stronger secret.'
                    : ' in Android Keystore-backed storage.'}
                </li>
              </ul>
            </div>
          </Section>

          <Section title="If you forget the passcode" className="pb-10">
            <div className="mx-4 rounded-control border border-danger/30 bg-danger-soft p-4">
              <p className="flex items-center gap-2 text-row font-semibold text-danger">
                <AlertTriangle size={17} strokeWidth={2} aria-hidden />
                There is no recovery
              </p>
              <p className="mt-1.5 text-meta leading-relaxed text-fg/85">
                Your passcode is the only thing that opens locked items. Nothing else is deleted if you never
                unlock again — the rest of your vault keeps working normally.
              </p>
              {mode === 'abandon' ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-meta leading-relaxed text-danger">
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
        <p className="text-row font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-meta leading-relaxed text-subtle">{description}</p>
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
