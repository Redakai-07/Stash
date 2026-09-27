import type { ExportedKeyring } from '@/db/types';
import {
  decryptString,
  deriveWrappingKey,
  encryptString,
  isEncryptedPayload,
  newSalt,
  PBKDF2_ITERATIONS,
  toBase64,
} from '@/lib/privacy/crypto';
import type { BackupData, StashBackup } from './format';
import { invalid, problemMessage, type ParseResult, validateBackupData } from './validate';

/**
 * The encrypted backup envelope.
 *
 * A backup file can itself be encrypted, under a passphrase the user chooses for
 * that file. This is separate from the vault passcode on purpose, and the
 * separation is worth stating plainly because it is the part users get wrong:
 *
 *  - The **vault passcode** protects locked items *on the device*. It is the key
 *    to the keyring, and it never travels anywhere.
 *  - The **backup passphrase** protects *this file*, wherever it ends up. It is
 *    chosen at export time, told to nobody, and needed only to restore.
 *
 * They are allowed to be the same string, but nothing requires it, and neither
 * one reveals the other. Choosing `encrypted` is how a backup becomes safe to
 * put in cloud storage or send to yourself without exposing anything — including
 * unlocked content, which the other two modes leave readable.
 *
 * Everything here is RFC 8018 PBKDF2-SHA256 and AES-256-GCM via WebCrypto. The
 * parameters are stored in the file alongside the ciphertext so a future build
 * with stronger defaults can still open an old file.
 *
 * Recovery implications, stated once and surfaced in the UI:
 *
 *  - There is no recovery code and no escrow. A forgotten backup passphrase
 *    means the file cannot be read, by us or by anyone.
 *  - A *sealed* backup (the default) needs no passphrase to open, but its locked
 *    items still need the original Stash passcode. Encrypting it with a backup
 *    passphrase protects everything at rest, and the Stash passcode is still
 *    required for the locked parts after restoring.
 */

/** A passphrase for a file, distinct from the vault passcode. */
export const MIN_BACKUP_PASSPHRASE = 8;

export interface BackupEnvelope {
  kdf: NonNullable<StashBackup['kdf']>;
  payload: NonNullable<StashBackup['payload']>;
}

/**
 * Encrypt a payload for a file.
 *
 * A fresh random salt and a fresh random IV are generated here, so exporting the
 * same vault twice never produces the same file. Reusing either would leak
 * equality between backups, which is exactly the kind of metadata leak a backup
 * passphrase is meant to prevent.
 */
export async function encryptBackupPayload(data: BackupData, passphrase: string): Promise<BackupEnvelope> {
  const salt = newSalt();
  const key = await deriveWrappingKey(passphrase, salt);
  const payload = await encryptString(key, JSON.stringify(data));
  return {
    kdf: { algorithm: 'PBKDF2-SHA256', salt: toBase64(salt), iterations: PBKDF2_ITERATIONS },
    payload,
  };
}

/**
 * Decrypt an encrypted backup, then validate what came out.
 *
 * A wrong passphrase and a corrupted payload are indistinguishable by design —
 * AES-GCM's tag verifies and fails either way — so both report the same thing.
 * Validation runs on the plaintext with the same rules as an unencrypted file:
 * encrypting a backup must not create a path that skips the checks.
 */
export async function decryptBackupPayload(backup: StashBackup, passphrase: string): Promise<ParseResult> {
  const kdf = backup.kdf;
  const payload = backup.payload;

  if (!kdf || !isEncryptedPayload(payload)) {
    return invalid('missing-payload', ['This backup has no encrypted payload to open.']);
  }
  if (kdf.algorithm !== 'PBKDF2-SHA256' || typeof kdf.salt !== 'string' || typeof kdf.iterations !== 'number') {
    return invalid('corrupt', ['This backup uses key-derivation settings this build does not understand.']);
  }

  let plaintext: string;
  try {
    const key = await deriveWrappingKey(passphrase, fromBase64Salt(kdf.salt), kdf.iterations);
    plaintext = await decryptString(key, payload);
  } catch {
    return invalid('wrong-passphrase', [], problemMessage('wrong-passphrase'));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return invalid('corrupt', ['The decrypted contents are not readable.']);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('corrupt', ['The decrypted contents are not a backup payload.']);
  }

  const outcome = validateBackupData(raw as Record<string, unknown>, {
    origin: 'stash-backup',
    version: backup.version,
    migratedFrom: null,
    mode: 'encrypted',
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    keyring: readKeyringFrom(backup),
    declaredSummary: backup.summary ?? null,
    extraWarnings: [],
  });

  if (!outcome.ok) return outcome.result;

  const next: StashBackup = { ...backup, data: outcome.data };
  return { kind: 'ready', backup: next, data: outcome.data, report: outcome.report };
}

function readKeyringFrom(backup: StashBackup): ExportedKeyring | null {
  return backup.security?.keyring ?? null;
}

/**
 * The salt is public, but it still has to be a real salt. A malformed one fails
 * the same way a wrong passphrase does, rather than being silently substituted.
 */
function fromBase64Salt(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
