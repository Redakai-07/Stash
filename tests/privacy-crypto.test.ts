import { describe, expect, it } from 'vitest';
import {
  decryptJson,
  decryptString,
  deriveWrappingKey,
  encryptJson,
  encryptString,
  exportKeyBytes,
  fromBase64,
  generateVaultKey,
  importKeyBytes,
  isEncryptedPayload,
  newSalt,
  PBKDF2_ITERATIONS,
  toBase64,
} from '@/lib/privacy/crypto';

/**
 * The crypto layer, exercised against the real platform primitives.
 *
 * Node ships the same WebCrypto surface the Android WebView does, so these are
 * not mocks: an AES-GCM operation that passes here is an AES-GCM operation. The
 * assertions that matter most are the negative ones — a modified ciphertext must
 * *fail*, not decrypt to something plausible.
 */

// PBKDF2 at production cost is deliberately slow. The derived-key tests use a
// reduced count so the suite stays honest about behaviour without paying the
// full 210k rounds on every assertion; the production figure is asserted
// separately.
const FAST_ITERATIONS = 1_000;

describe('authenticated encryption', () => {
  it('round-trips a string', async () => {
    const key = await generateVaultKey();
    const payload = await encryptString(key, 'the quiet part');
    expect(payload.alg).toBe('AES-GCM');
    expect(payload.v).toBe(1);
    expect(payload.ct).not.toContain('quiet');
    await expect(decryptString(key, payload)).resolves.toBe('the quiet part');
  });

  it('round-trips unicode and empty strings', async () => {
    const key = await generateVaultKey();
    for (const value of ['', '☕️ café', '日本語のメモ', '{"a":1}']) {
      await expect(decryptString(key, await encryptString(key, value))).resolves.toBe(value);
    }
  });

  it('never reuses a nonce', async () => {
    const key = await generateVaultKey();
    const ivs = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      ivs.add((await encryptString(key, 'same plaintext')).iv);
    }
    // Identical plaintexts must produce different ciphertexts, otherwise the
    // database would leak equality between locked rows.
    expect(ivs.size).toBe(32);
  });

  it('fails on a tampered ciphertext instead of returning garbage', async () => {
    const key = await generateVaultKey();
    const payload = await encryptString(key, 'untouched');

    const bytes = fromBase64(payload.ct);
    // Flip one bit in the middle: the authentication tag must reject this.
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = (bytes[middle] as number) ^ 0x01;

    await expect(decryptString(key, { ...payload, ct: toBase64(bytes) })).rejects.toThrow();
  });

  it('fails when the nonce is swapped', async () => {
    const key = await generateVaultKey();
    const first = await encryptString(key, 'one');
    const second = await encryptString(key, 'two');
    await expect(decryptString(key, { ...first, iv: second.iv })).rejects.toThrow();
  });

  it('fails with the wrong key', async () => {
    const payload = await encryptString(await generateVaultKey(), 'secret');
    await expect(decryptString(await generateVaultKey(), payload)).rejects.toThrow();
  });

  it('round-trips json', async () => {
    const key = await generateVaultKey();
    const value = { title: 'Tax documents', content: 'line one\nline two' };
    await expect(decryptJson(key, await encryptJson(key, value))).resolves.toEqual(value);
  });

  it('recognises a well-formed payload and rejects the rest', async () => {
    const payload = await encryptString(await generateVaultKey(), 'x');
    expect(isEncryptedPayload(payload)).toBe(true);
    expect(isEncryptedPayload(undefined)).toBe(false);
    expect(isEncryptedPayload({ v: 1, alg: 'AES-GCM', iv: 'a', ct: '' })).toBe(false);
    expect(isEncryptedPayload({ v: 2, alg: 'AES-GCM', iv: 'a', ct: 'b' })).toBe(false);
    expect(isEncryptedPayload({ v: 1, alg: 'ROT13', iv: 'a', ct: 'b' })).toBe(false);
  });

  it('round-trips raw key bytes through import and export', async () => {
    const key = await generateVaultKey();
    const bytes = await exportKeyBytes(key);
    expect(bytes).toHaveLength(32);
    const restored = await importKeyBytes(bytes);
    const payload = await encryptString(key, 'portable');
    await expect(decryptString(restored, payload)).resolves.toBe('portable');
  });
});

describe('passcode key derivation', () => {
  it('derives the same key from the same passcode and salt', async () => {
    const salt = newSalt();
    const a = await deriveWrappingKey('correct horse', salt, FAST_ITERATIONS);
    const b = await deriveWrappingKey('correct horse', salt, FAST_ITERATIONS);
    const payload = await encryptString(a, 'wrapped');
    await expect(decryptString(b, payload)).resolves.toBe('wrapped');
  });

  it('derives a different key for a different salt', async () => {
    const payload = await encryptString(await deriveWrappingKey('pass', newSalt(), FAST_ITERATIONS), 'wrapped');
    await expect(decryptString(await deriveWrappingKey('pass', newSalt(), FAST_ITERATIONS), payload)).rejects.toThrow();
  });

  it('derives a different key for a different passcode', async () => {
    const salt = newSalt();
    const payload = await encryptString(await deriveWrappingKey('pass', salt, FAST_ITERATIONS), 'wrapped');
    await expect(
      decryptString(await deriveWrappingKey('pasz', salt, FAST_ITERATIONS), payload),
    ).rejects.toThrow();
  });

  it('uses production-grade work factors', () => {
    // A regression here would silently weaken every passcode. The figure is
    // OWASP's current PBKDF2-HMAC-SHA256 guidance.
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });

  it('survives a base64 round trip of arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([0, 1, 127, 128, 255, 42]);
  });
});
