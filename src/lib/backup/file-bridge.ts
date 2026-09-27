import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { fromBase64, toBase64 } from '@/lib/privacy/crypto';
import { MAX_BACKUP_BYTES } from './format';

/**
 * Getting a backup off the device and back onto it.
 *
 * The rule that shapes this module: **Stash never assumes it can write to a
 * filesystem.** On Android 10 and later there is no such thing as free access to
 * external storage, and an app that writes to a path of its own choosing is
 * writing somewhere the user cannot find. So neither the export nor the import
 * picks a location:
 *
 *  - **Export** writes the file into the app's own cache directory — a location
 *    the app genuinely owns — and then hands it to the system share sheet, so the
 *    user chooses the destination: Files, Drive, a mail to themselves, anything
 *    that accepts a file. The cache copy is a staging area, not a home.
 *  - **Import** goes through the system document picker (Storage Access
 *    Framework), which is the only correct way to read a file the user owns. We
 *    get a URI and permission for exactly that file, for exactly this operation.
 *
 * On the web the same two operations are the browser's equivalents: a download
 * and a file input. Both paths converge on plain text, which is what the rest of
 * the feature works with — nothing below this module knows where a file came
 * from.
 */

/** The types a file picker should offer. JSON, plus the generic fallbacks. */
const BACKUP_PICKER_TYPES = ['application/json', 'text/plain', 'application/octet-stream'];

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export interface SaveOutcome {
  ok: boolean;
  cancelled?: boolean;
  /** Where the staging copy landed, when one was written. */
  path?: string;
  message?: string;
}

/**
 * Hand a backup to the device.
 *
 * The cache write and the share are separate steps on purpose: a share that the
 * user cancels must not look like a failed export, and a cache write that fails
 * must not open a share sheet with nothing behind it. The staging copy is left in
 * place — it is in the app's own cache directory, it costs nothing, and keeping
 * it means the file is still there if the share target was the wrong one.
 */
export async function saveBackupToDevice(text: string, fileName: string): Promise<SaveOutcome> {
  if (!isNativePlatform()) {
    downloadInBrowser(text, fileName);
    return { ok: true };
  }

  let uri: string;
  try {
    const written = await Filesystem.writeFile({
      path: fileName,
      data: encodeBase64(text),
      directory: Directory.Cache,
      recursive: true,
    });
    uri = written.uri;
  } catch (error) {
    return {
      ok: false,
      message: `Could not write the backup file: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  try {
    await Share.share({
      title: fileName,
      dialogTitle: 'Save or share your Stash backup',
      files: [uri],
    });
    return { ok: true, path: uri };
  } catch (error) {
    // A cancelled chooser is a normal outcome, not an error worth alarming
    // anyone about. The warning here is a log, not a dead end.
    return {
      ok: false,
      message: `The backup was written but not shared: ${error instanceof Error ? error.message : 'unknown error'}`,
      path: uri,
    };
  }
}

export interface PickOutcome {
  ok: boolean;
  cancelled?: boolean;
  text?: string;
  name?: string;
  bytes?: number;
  message?: string;
}

/**
 * Read a backup the user chooses.
 *
 * The size is checked from the picker's own metadata *before* the contents are
 * fetched, which is the only way to refuse an enormous file without first
 * loading it into memory. When the picker cannot offer a fetchable path, the
 * file is read directly instead; the two paths exist because document providers
 * vary in what they expose, and a provider that only gives a raw URI should not
 * make import impossible.
 */
export async function pickBackupFile(): Promise<PickOutcome> {
  if (!isNativePlatform()) return pickInBrowser();

  let files: Awaited<ReturnType<typeof FilePicker.pickFiles>>['files'];
  try {
    const picked = await FilePicker.pickFiles({
      types: BACKUP_PICKER_TYPES,
      limit: 1,
      // Reading data inline is explicitly avoided: it decodes the whole file
      // into a string inside the bridge, and we want a size check first.
      readData: false,
    });
    files = picked.files;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Dismissing the picker surfaces as an error on some platforms; that is a
    // cancellation, not a failure.
    if (/cancel|dismiss/i.test(message)) return { ok: false, cancelled: true };
    return { ok: false, message: `Could not open the file picker: ${message}` };
  }

  const file = files?.[0];
  if (!file) return { ok: false, cancelled: true };

  if (typeof file.size === 'number' && file.size > MAX_BACKUP_BYTES) {
    return { ok: false, message: 'That file is far larger than any Stash backup, so it is not being opened.' };
  }

  try {
    const text = await readPickedFile(file);
    if (text === null) {
      return { ok: false, message: 'That file could not be read. Try another location or another file.' };
    }
    return { ok: true, text, name: file.name, bytes: file.size };
  } catch (error) {
    return {
      ok: false,
      message: `Could not read that file: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

async function readPickedFile(file: { path?: string; webPath?: string }): Promise<string | null> {
  // `webPath` is a URL the WebView itself can fetch, which is the most reliable
  // route across document providers.
  if (file.webPath) {
    const response = await fetch(file.webPath);
    if (response.ok) return response.text();
  }
  if (file.path) {
    const result = await Filesystem.readFile({ path: file.path });
    if (typeof result.data === 'string') return decodeBase64(result.data);
  }
  return null;
}

/**
 * Keep the pre-restore safety copy somewhere it survives the restore.
 *
 * A replace clears the database, so an in-memory copy is only useful while the
 * app stays open — and an import that goes wrong is exactly when someone is
 * likely to close the app. Writing it to the app's own data directory makes it
 * survive a restart, and it is invisible to other apps. Returns `null` when it
 * could not be written, which the caller reports rather than ignores.
 */
export async function stashEmergencyBackup(text: string, fileName: string): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    const written = await Filesystem.writeFile({
      path: `emergency/${fileName}`,
      data: encodeBase64(text),
      directory: Directory.Data,
      recursive: true,
    });
    return written.uri;
  } catch (error) {
    console.warn('[stash] could not store the emergency backup', error);
    return null;
  }
}

/** UTF-8 text to base64, the form the filesystem bridge takes. */
function encodeBase64(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(fromBase64(value));
}

function downloadInBrowser(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the navigation to have been picked up.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The browser's file input.
 *
 * Kept as an imperative element rather than a React component so the import flow
 * can await a single value and read it with `File.text()` — which decodes the
 * file off the main thread's critical path instead of through base64.
 */
function pickInBrowser(): Promise<PickOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    const finish = (outcome: PickOutcome) => {
      input.remove();
      resolve(outcome);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish({ ok: false, cancelled: true });
      if (file.size > MAX_BACKUP_BYTES) {
        return finish({ ok: false, message: 'That file is far larger than any Stash backup, so it is not being opened.' });
      }
      file
        .text()
        .then((text) => finish({ ok: true, text, name: file.name, bytes: file.size }))
        .catch((error: unknown) =>
          finish({ ok: false, message: error instanceof Error ? error.message : 'Could not read that file.' }),
        );
    });

    // `cancel` is not universally supported; the element is removed when the
    // window regains focus without a selection so it does not leak.
    input.addEventListener('cancel', () => finish({ ok: false, cancelled: true }));
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!input.isConnected) return;
          if (!input.files || input.files.length === 0) finish({ ok: false, cancelled: true });
        }, 500);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
