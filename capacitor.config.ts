import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.web.Stash',
  appName: 'Stash',
  webDir: 'out',
  plugins: {
    /**
     * System bars and safe-area insets.
     *
     * `css` is Capacitor's default and is set explicitly because the app's CSS
     * depends on it: it publishes the insets as `--safe-area-inset-*` custom
     * properties, which stay correct on every WebView version (on older ones
     * Capacitor pads the WebView natively and reports zero, so the app does not
     * pad twice). See the inset utilities in `src/app/globals.css`.
     *
     * The viewport really is `viewport-fit=cover` (set in the root layout), and
     * stating it here spares the app a layout jump while Capacitor works that
     * out for itself.
     */
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
