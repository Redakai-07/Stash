import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppBoot, BootGate, PrivacySession, ShareListener } from '@/components/providers';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Stash',
  description: 'An offline-first personal knowledge vault for the links you mean to keep.',
  applicationName: 'Stash',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Stash',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f4' },
    { media: '(prefers-color-scheme: dark)', color: '#151714' },
  ],
};

/**
 * Applied before first paint so a device set to dark never flashes white.
 *
 * `localStorage` is used purely as a paint-time cache of the theme mode; the
 * source of truth stays in IndexedDB alongside the rest of the user's data, and
 * the real theme store overwrites whatever this sets a moment later.
 */
const THEME_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem('stash.theme');var d=m==='dark'||((!m||m==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <AppBoot>
          <BootGate>
            <PrivacySession />
            <ShareListener />
            <AppShell>{children}</AppShell>
          </BootGate>
        </AppBoot>
      </body>
    </html>
  );
}
