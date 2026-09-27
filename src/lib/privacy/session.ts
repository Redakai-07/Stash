import type { RelockPolicy } from '@/db/types';

/**
 * Session re-lock policy.
 *
 * Unlocking once should not unlock the vault forever. The policy answers one
 * question: after Stash has been off screen for a while, is the key still
 * allowed to be in memory?
 *
 * The logic is a pure function of the policy plus two timestamps, so the whole
 * timing model is testable without a device, and the React layer only has to feed
 * it `visibilitychange` / `appStateChange` events.
 *
 * `immediate` is the default because it is the only setting whose guarantee does
 * not depend on the user's estimate of how long "a minute" is.
 */
export interface RelockPolicyOption {
  id: RelockPolicy;
  label: string;
  description: string;
  /** How long the app may stay backgrounded before the key is dropped. */
  delayMs: number;
}

export const RELOCK_POLICIES: ReadonlyArray<RelockPolicyOption> = [
  {
    id: 'immediate',
    label: 'Immediately',
    description: 'The moment Stash leaves the screen.',
    delayMs: 0,
  },
  {
    id: '1m',
    label: 'After 1 minute',
    description: 'A quick app switch stays unlocked.',
    delayMs: 60_000,
  },
  {
    id: '5m',
    label: 'After 5 minutes',
    description: 'Comfortable for copying links between apps.',
    delayMs: 300_000,
  },
  {
    id: '15m',
    label: 'After 15 minutes',
    description: 'Longest window. Least private.',
    delayMs: 900_000,
  },
];

export function isRelockPolicy(value: unknown): value is RelockPolicy {
  return typeof value === 'string' && RELOCK_POLICIES.some((option) => option.id === value);
}

export function relockDelayMs(policy: RelockPolicy): number {
  return RELOCK_POLICIES.find((option) => option.id === policy)?.delayMs ?? 0;
}

export function relockPolicyLabel(policy: RelockPolicy): string {
  return RELOCK_POLICIES.find((option) => option.id === policy)?.label ?? 'Immediately';
}

/**
 * Whether the key must be dropped, given when the app was backgrounded.
 *
 * `backgroundedAt === null` means the app never left the foreground, so there is
 * nothing to expire. A clock that appears to move backwards (a manual device
 * time change, or a suspend) is treated as expired rather than as safe: `now`
 * before `backgroundedAt` means we cannot reason about elapsed time, and the
 * conservative answer is to lock.
 */
export function shouldRelock(policy: RelockPolicy, backgroundedAt: number | null, now: number): boolean {
  if (backgroundedAt === null) return false;
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= relockDelayMs(policy);
}

/**
 * Whether the key should be dropped the instant the app is backgrounded.
 *
 * Returned separately from {@link shouldRelock} because `immediate` must not wait
 * for the app to come back: on Android the process may be killed while
 * backgrounded, and "locked on resume" would then be a promise the app was never
 * alive to keep. Locking at background time makes the guarantee hold even if it
 * never resumes.
 */
export function shouldLockOnBackground(policy: RelockPolicy): boolean {
  return relockDelayMs(policy) === 0;
}
