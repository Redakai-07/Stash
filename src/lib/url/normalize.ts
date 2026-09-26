/**
 * Conservative URL normalization for duplicate detection.
 *
 * Philosophy: only strip things that provably cannot change *which resource*
 * the URL addresses. Anything ambiguous is left alone, because a false
 * "already saved" is far more annoying than a rare duplicate.
 *
 * Kept:
 *  - path and any unknown query parameter (could be a document id, page, item)
 *  - `t` (media timestamp), `list` (playlist), `page`, `v`, `id`, `q`, ...
 *
 * Removed:
 *  - fragments (`#section` navigates inside the same document)
 *  - known pure-telemetry parameters (utm_*, fbclid, gclid, ...)
 *  - default ports, `www.` prefix, trailing slash on a bare path
 *  - `youtu.be` / `/shorts/` style aliases, which are the *same* resource
 */

const TRACKING_PARAMS_EXACT = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'yclid',
  's_cid',
  'spm',
  'scm',
  'mkt_tok',
  'vero_id',
  'vero_conv',
  '_hsenc',
  '_hsmi',
  '_ga',
  '_gl',
  '__twitter_impression',
  '__s',
  'ref_src',
  'ref_url',
  'wt_mc',
  'trk',
  'trkCampaign',
  'sc_cid',
  'wickedid',
  'oly_anon_id',
  'oly_enc_id',
  'cmpid',
  'campaign_id',
  'smid',
  'partner',
  'si',
  'feature',
  'ab_channel',
  'pp',
]);

const TRACKING_PARAM_PREFIXES = ['utm_', 'ga_', 'pk_', 'piwik_', 'matomo_', 'hsa_'];

export function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Returns a normalized URL string, or `null` when the input is not a usable
 * absolute http(s) URL. Callers should fall back to the raw input on `null`
 * so that an exotic-but-valid share is never lost.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return null;

  parsed.protocol = protocol;
  parsed.hostname = canonicalHost(parsed.hostname);
  parsed.hash = '';

  if (
    (protocol === 'https:' && parsed.port === '443') ||
    (protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = '';
  }

  stripTrackingParams(parsed);

  // A trailing slash on an otherwise empty path is pure noise:
  // `https://example.com/` and `https://example.com` are one resource.
  const emptyPath = parsed.pathname === '' || parsed.pathname === '/';

  const canonical = applyPlatformAliases(parsed);
  if (canonical) return canonical;

  sortSearchParams(parsed);

  // WHATWG serialization always emits at least `/`, so the empty path has to be
  // trimmed from the rendered string rather than from the URL object.
  const out = parsed.toString();
  return emptyPath ? out.replace(/\/(?=\?|#|$)/, '') : out;
}

/**
 * Lower-cases the host and drops the `www.` prefix. We deliberately do *not*
 * collapse `m.`/`mobile.` subdomains: those are occasionally distinct.
 */
function canonicalHost(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

function stripTrackingParams(url: URL): void {
  const doomed: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (isTrackingParam(key)) doomed.push(key);
  });
  for (const key of doomed) url.searchParams.delete(key);
}

function sortSearchParams(url: URL): void {
  const entries = [...url.searchParams.entries()];
  if (entries.length < 2) return;
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
}

/**
 * Aliases where two different URL shapes address byte-for-byte the same
 * resource. Restricted to a small hand-checked table so this stays safe.
 */
function applyPlatformAliases(url: URL): string | null {
  const host = url.hostname;
  const segments = url.pathname.split('/').filter(Boolean);

  // YouTube: youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id> -> watch?v=<id>
  if (host === 'youtu.be') {
    const id = segments[0];
    if (id) return withQuery('https://youtube.com/watch', 'v', id, url);
    return null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const [first, second] = segments;
    const alias = first === 'shorts' || first === 'embed' || first === 'live' || first === 'v';
    const id = alias ? second : undefined;
    if (id) return withQuery('https://youtube.com/watch', 'v', id, url);
    // A plain /watch link: keep only the parameters that identify the video.
    if (first === 'watch' && url.searchParams.has('v')) {
      const videoId = url.searchParams.get('v') ?? '';
      const playlist = url.searchParams.get('list');
      const qs = new URLSearchParams({ v: videoId });
      if (playlist) qs.set('list', playlist);
      return `https://youtube.com/watch?${qs.toString()}`;
    }
    if (!first) return 'https://youtube.com';
    return null;
  }

  // Instagram reels: /reels/<id> is a synonym for /reel/<id>.
  if (host === 'instagram.com' && segments[0] === 'reels' && segments[1]) {
    return `https://instagram.com/reel/${segments[1]}`;
  }

  // Twitter is X; old reddit host is reddit.
  if (host === 'twitter.com') {
    return `https://x.com${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;
  }
  if (host === 'old.reddit.com') {
    return `https://reddit.com${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;
  }

  return null;
}

function withQuery(base: string, key: string, value: string, source: URL): string {
  const qs = new URLSearchParams({ [key]: value });
  // Playlist context is preserved when present so the dedupe key matches a
  // plain /watch link of the same video inside a playlist.
  const playlist = source.searchParams.get('list');
  if (playlist) qs.set('list', playlist);
  return `${base}?${qs.toString()}`;
}

/** True when `value` parses as an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
