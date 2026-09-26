import type { NextConfig } from 'next';

/**
 * Stash is shipped to Android through Capacitor, so the Next.js app is a
 * fully static bundle. `output: 'export'` guarantees there is no server
 * dependency, which is what makes the "no backend, works offline" promise
 * structurally true rather than merely a convention.
 *
 * `trailingSlash: true` emits `library/index.html` instead of `library.html`.
 * Capacitor's WebView local server resolves directory indexes natively, so
 * deep links such as `/library/` keep working after a cold start.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  images: {
    // No remote metafetching and no Next image optimizer on device.
    unoptimized: true,
  },
};

export default nextConfig;
