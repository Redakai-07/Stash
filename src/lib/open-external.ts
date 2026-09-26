/**
 * Opening a saved link.
 *
 * Inside the Android WebView, `window.open(..., '_blank')` either navigates the
 * app's own WebView away from Stash or does nothing at all, depending on the
 * WebView's multi-window setting. Neither is acceptable, so native builds go
 * through Chrome Custom Tabs, which keeps Stash alive in the background and puts
 * a familiar "back to Stash" affordance on screen.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const core = await import('@capacitor/core');
    if (core.Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'fullscreen' });
      return;
    }
  } catch (error) {
    console.warn('[stash] falling back to window.open', error);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
