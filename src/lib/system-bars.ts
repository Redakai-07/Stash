'use client';

import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ResolvedTheme } from '@/stores/theme-store';

/**
 * Keep the Android status bar and gesture bar legible.
 *
 * Capacitor styles the system bars from the *device* appearance (its SystemBars
 * plugin resolves `DEFAULT` against the system uiMode), while Stash follows its
 * own theme: Settings can pin light or dark whatever the phone is set to. The
 * mismatch is not cosmetic — in light mode the bars are given dark icons, and
 * dark icons over the app's dark background is a status bar nobody can read.
 *
 * So the resolved theme is pushed to the bars whenever it changes. The call is
 * asynchronous and failure is swallowed: off Android the plugin is a stub that
 * rejects, and a device that cannot restyle its bars should still work.
 */
export function syncSystemBars(resolved: ResolvedTheme): void {
  if (!Capacitor.isNativePlatform()) return;
  void SystemBars.setStyle({
    style: resolved === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => {
    /* no SystemBars implementation here: leave the platform default in place */
  });
}
