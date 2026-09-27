import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_SETTINGS, type RelockPolicy } from '@/db/types';
import {
  isRelockPolicy,
  RELOCK_POLICIES,
  relockDelayMs,
  relockPolicyLabel,
  shouldLockOnBackground,
  shouldRelock,
} from '@/lib/privacy/session';

/**
 * Re-lock timing.
 *
 * The whole policy is a pure function of a policy and two timestamps, so every
 * boundary below is exact — there is no timer to mock and no device to wait on.
 */

const MINUTE = 60_000;
const T = 1_700_000_000_000;

describe('re-lock policies', () => {
  it('offers the four documented windows', () => {
    expect(RELOCK_POLICIES.map((option) => option.id)).toEqual(['immediate', '1m', '5m', '15m']);
    expect(RELOCK_POLICIES.map((option) => option.delayMs)).toEqual([0, MINUTE, 5 * MINUTE, 15 * MINUTE]);
  });

  it('recognises valid policy ids only', () => {
    for (const option of RELOCK_POLICIES) expect(isRelockPolicy(option.id)).toBe(true);
    expect(isRelockPolicy('30m')).toBe(false);
    expect(isRelockPolicy(null)).toBe(false);
    expect(isRelockPolicy(5)).toBe(false);
  });

  it('labels a policy for the settings list', () => {
    expect(relockPolicyLabel('immediate')).toBe('Immediately');
    expect(relockDelayMs('15m')).toBe(15 * MINUTE);
  });
});

describe('expiry', () => {
  it('expires immediately when asked to', () => {
    expect(shouldRelock('immediate', T, T)).toBe(true);
    expect(shouldLockOnBackground('immediate')).toBe(true);
  });

  it('keeps the key for a quick app switch under the longer windows', () => {
    for (const policy of ['1m', '5m', '15m'] as const) {
      expect(shouldRelock(policy, T, T + 5_000), policy).toBe(false);
      expect(shouldLockOnBackground(policy), policy).toBe(false);
    }
  });

  it('expires exactly at the boundary, not a millisecond later', () => {
    expect(shouldRelock('1m', T, T + MINUTE - 1)).toBe(false);
    expect(shouldRelock('1m', T, T + MINUTE)).toBe(true);
    expect(shouldRelock('5m', T, T + 5 * MINUTE)).toBe(true);
    expect(shouldRelock('15m', T, T + 15 * MINUTE)).toBe(true);
  });

  it('does nothing when the app never left the foreground', () => {
    for (const policy of ['immediate', '1m', '5m', '15m'] as const) {
      expect(shouldRelock(policy, null, T), policy).toBe(false);
    }
  });

  it('locks when the clock is unreliable rather than trusting it', () => {
    // A backwards clock means elapsed time cannot be reasoned about at all. The
    // conservative answer is to lock: a false lock costs one unlock, a false
    // unlock costs the whole feature.
    expect(shouldRelock('15m', T, T - 1)).toBe(true);
  });

  it('handles every policy without a lookup miss', () => {
    const policies: RelockPolicy[] = ['immediate', '1m', '5m', '15m'];
    for (const policy of policies) {
      expect(Number.isFinite(relockDelayMs(policy))).toBe(true);
    }
  });
});

describe('defaults', () => {
  it('is secure by default', () => {
    // Immediate re-lock, the app covered while locked. Screen privacy stays
    // opt-in because it blocks screenshots the user may want.
    expect(DEFAULT_PRIVACY_SETTINGS.relockPolicy).toBe('immediate');
    expect(DEFAULT_PRIVACY_SETTINGS.lockApp).toBe(true);
    expect(DEFAULT_PRIVACY_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_PRIVACY_SETTINGS.secureScreen).toBe(false);
  });
});
