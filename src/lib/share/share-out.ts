import { getActiveShareBridge, type SharePayload } from './bridge';

/**
 * Sending a link (or a digest of a folder) somewhere else.
 *
 * Stash is both a share *target* and a share *source*, and the interesting part
 * is that the two are the same seam: an Android `ACTION_SEND` intent. Outgoing,
 * the chooser belongs to the operating system, so the app never maintains a list
 * of destinations and never needs the network to reach one.
 *
 * The fallback order is deliberate:
 *
 *  1. the native share sheet, where the user's own apps live;
 *  2. the Web Share API, for the installable PWA on a phone that has it;
 *  3. the clipboard, which always works and is announced in the UI.
 *
 * A cancelled share is not a failure. Asking Android to show a chooser and then
 * backing out of it is the user changing their mind, and reporting that as an
 * error would be the app arguing with them.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareOutRequest {
  /** What to send. A URL for a link, several lines for a digest. */
  text: string;
  /** Chooser heading, e.g. `Share “Binary search”`. */
  title?: string;
  /** `EXTRA_SUBJECT`, which mail clients use as the subject line. */
  subject?: string;
}

export async function shareOut(request: ShareOutRequest): Promise<ShareOutcome> {
  const text = request.text.trim();
  if (text.length === 0) return 'failed';

  const payload: SharePayload = { text };
  if (request.title) payload.title = request.title;
  if (request.subject) payload.subject = request.subject;

  try {
    const bridge = await getActiveShareBridge();
    if (await bridge.share(payload)) return 'shared';
  } catch {
    // The native path is best-effort; the clipboard below still works.
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * A folder, as something you can send to a person.
 *
 * A digest rather than a file: a `.json` backup of one folder would need its own
 * format version, its own validation and its own reader, and it would still be
 * useless to anyone who does not have Stash. Plain lines with titles and
 * addresses are readable in any messaging app on any platform, which is the
 * point of sending them.
 */
export function folderDigest(input: {
  name: string;
  links: ReadonlyArray<{ title?: string; url: string; folderPath?: string }>;
}): string {
  const lines = input.links.map((link) => {
    const title = link.title?.trim();
    const where = link.folderPath && link.folderPath !== input.name ? `  (${link.folderPath})` : '';
    return title ? `- ${title}${where}\n  ${link.url}` : `- ${link.url}${where}`;
  });

  return [`${input.name} — ${input.links.length} link${input.links.length === 1 ? '' : 's'} from Stash`, ...lines].join(
    '\n',
  );
}
