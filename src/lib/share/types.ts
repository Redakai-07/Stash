/**
 * The stable contract between native code (or a PWA share target) and the
 * web application. React components depend only on this shape, never on
 * Android Intent extras, so the parsing surface stays swappable.
 */
export interface IncomingShare {
  /** Exactly what the source application sent, untouched. */
  rawText: string;
  /** Extracted URLs in original form, de-duplicated by normalized form. */
  urls: string[];
  /** Android package name of the sharing app, when it can be determined. */
  sourcePackage?: string;
  /** Android EXTRA_SUBJECT, sometimes the page title. */
  subject?: string;
  /** Epoch milliseconds. */
  receivedAt: number;
}

/** Friendly product names for the apps people share from most often. */
const PACKAGE_LABELS: Record<string, string> = {
  'com.google.android.youtube': 'YouTube',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.facebook.lite': 'Facebook Lite',
  'com.twitter.android': 'X',
  'com.reddit.frontpage': 'Reddit',
  'com.linkedin.android': 'LinkedIn',
  'com.google.android.googlequicksearchbox': 'Google',
  'com.android.chrome': 'Chrome',
  'com.chrome.beta': 'Chrome',
  'org.mozilla.firefox': 'Firefox',
  'com.microsoft.emmx': 'Edge',
  'com.brave.browser': 'Brave',
  'com.google.android.apps.nexuslauncher': 'Launcher',
  'com.whatsapp': 'WhatsApp',
  'org.telegram.messenger': 'Telegram',
  'com.slack': 'Slack',
  'com.discord': 'Discord',
  'com.pinterest': 'Pinterest',
  'com.medium.reader': 'Medium',
  'com.github.android': 'GitHub',
  'com.google.android.gm': 'Gmail',
};

const DOMAIN_LABELS: Record<string, string> = {
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'fb.com': 'Facebook',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'medium.com': 'Medium',
  'github.com': 'GitHub',
  'stackoverflow.com': 'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'wikipedia.org': 'Wikipedia',
  'arxiv.org': 'arXiv',
  'notion.so': 'Notion',
  'substack.com': 'Substack',
  'spotify.com': 'Spotify',
  'pinterest.com': 'Pinterest',
  'tiktok.com': 'TikTok',
  'twitch.tv': 'Twitch',
  'docs.google.com': 'Google Docs',
  'developer.mozilla.org': 'MDN',
  'npmjs.com': 'npm',
};

/** Human label for the app that sent the share, e.g. `com.instagram.android` -> Instagram. */
export function labelForPackage(packageName?: string): string | undefined {
  if (!packageName) return undefined;
  const direct = PACKAGE_LABELS[packageName];
  if (direct) return direct;
  const tail = packageName.split('.').pop();
  if (!tail) return undefined;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** Human label for a link domain, falling back to the domain itself. */
export function labelForDomain(domain: string): string | undefined {
  if (!domain) return undefined;
  const key = domain.replace(/^www\./, '');
  if (DOMAIN_LABELS[key]) return DOMAIN_LABELS[key];
  const parts = key.split('.');
  if (parts.length > 2) {
    const parent = parts.slice(-2).join('.');
    if (DOMAIN_LABELS[parent]) return DOMAIN_LABELS[parent];
  }
  return domain;
}
