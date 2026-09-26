import { normalizeUrl } from './normalize';

/** Characters that commonly trail a URL inside prose or markup. */
// Brackets are deliberately absent: the balance loop below decides whether a
// closing bracket belongs to the URL, and a blanket strip would break legitimate
// addresses such as `.../path_(notes)`.
const TRAILING_JUNK = /[.,;:!?"'“”‘’>»…]+$/;

/** Characters that surround a URL in prose but can never open one. */
const LEADING_JUNK = new Set(['(', '[', '{', '<', '"', "'", '“', '‘', '«', '>']);

const SCHEMED_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * Bare hostnames such as `youtube.com/watch?v=abc`. Deliberately narrow:
 * requires a `www.` prefix or a known TLD *and* a path/query, so ordinary
 * prose ("Node.js, e.g. this") is never mistaken for a link.
 */
const BARE_URL =
  /\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|me|sh|xyz|info|edu|gov|us|uk|de|in|to|tv|gg|so|rs|fm|link|page|site|blog|wiki|news|tech|design|art|store|online|cloud|pro|xyz|zip|run|tools|codes|works|studio|space|team|live|world|zone|blog)(?:\/[^\s<>"'`]*)?)/gi;

/**
 * Trim punctuation that belongs to the surrounding sentence rather than the
 * URL, while keeping characters that are legal inside a query string.
 */
const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
];

export function trimUrlJunk(candidate: string): string {
  let value = candidate.trim();
  while (value.length > 0 && LEADING_JUNK.has(value[0]!)) value = value.slice(1);

  // Repeat until stable: removing a trailing full stop can expose an unbalanced
  // closing bracket that also belongs to the sentence, and vice versa.
  let previous = '';
  while (value !== previous) {
    previous = value;
    for (const [open, close] of BRACKET_PAIRS) {
      // A closing bracket stays only when the URL itself opened it.
      while (value.endsWith(close) && count(value, open) < count(value, close)) {
        value = value.slice(0, -1);
      }
    }
    while (TRAILING_JUNK.test(value)) value = value.slice(0, -1);
  }
  return value;
}

function count(haystack: string, needle: string): number {
  let total = 0;
  for (const char of haystack) if (char === needle) total += 1;
  return total;
}

export interface ExtractedUrls {
  /** URLs exactly as they appeared, de-duplicated by normalized form. */
  urls: string[];
  /** Normalized form of each url, same order. */
  normalized: string[];
}

/**
 * Extract every plausible URL from arbitrary shared text.
 *
 * Handles all the shapes real Android apps produce: a bare URL, "Title
 * https://url", "Title\nhttps://url", prose containing a link, several links
 * in one message, and text with no link at all.
 */
export function extractUrls(rawText: string): ExtractedUrls {
  const text = rawText ?? '';
  const found: Array<{ url: string; normalized: string }> = [];
  const seen = new Set<string>();

  const consider = (candidate: string) => {
    const trimmed = trimUrlJunk(candidate);
    if (trimmed.length < 4) return;
    const normalized = normalizeUrl(trimmed);
    if (!normalized) return;
    const key = normalized;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ url: trimmed, normalized });
  };

  for (const match of text.matchAll(SCHEMED_URL)) consider(match[0]);

  // Only look for bare hosts when we have not already found links, otherwise a
  // bare-looking fragment inside a real URL could produce a phantom match.
  if (found.length === 0) {
    for (const match of text.matchAll(BARE_URL)) {
      const candidate = match[0].toLowerCase();
      if (!/[/?]/.test(candidate) && !candidate.startsWith('www.')) continue;
      consider(candidate.startsWith('http') ? candidate : `https://${candidate}`);
    }
  }

  return {
    urls: found.map((entry) => entry.url),
    normalized: found.map((entry) => entry.normalized),
  };
}

/** Domain to show for a link, without the `www.` prefix. Falls back to a guess. */
export function domainOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
