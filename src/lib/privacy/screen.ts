/**
 * Screen privacy.
 *
 * Android's `FLAG_SECURE` does two useful things: it blocks screenshots and
 * screen recording of the window, and it blanks the app in the recent-apps
 * thumbnail. Both matter for a vault — the recents thumbnail is a photograph of
 * whatever was on screen when the app was backgrounded, and no lock screen can
 * undo that after the fact.
 *
 * It is applied while the session is **locked** unconditionally — a locked
 * screen should never be capturable, and the flag is cheap. While the session is
 * unlocked it is applied only if the user asked for it, because blocking
 * screenshots is a real cost that most people have not opted into. It is never
 * applied to the whole app as a silent default.
 *
 * The flag is a native window property, so this goes through a small local
 * Capacitor plugin; on the web it is a no-op rather than a pretence.
 */
interface PrivacyScreenPlugin {
  setSecure(options: { secure: boolean }): Promise<void>;
}

let plugin: PrivacyScreenPlugin | null = null;
let pluginResolved = false;

async function resolvePlugin(): Promise<PrivacyScreenPlugin | null> {
  if (pluginResolved) return plugin;
  pluginResolved = true;

  if (typeof window === 'undefined') return null;
  try {
    const core = await import('@capacitor/core');
    if (core.Capacitor.isNativePlatform()) {
      plugin = core.registerPlugin<PrivacyScreenPlugin>('PrivacyScreen');
    }
  } catch (error) {
    console.warn('[stash] screen privacy unavailable', error);
  }
  return plugin;
}

let applied: boolean | null = null;

export async function applyScreenPrivacy(secure: boolean): Promise<void> {
  if (applied === secure) return;
  const target = await resolvePlugin();
  if (!target) {
    applied = secure;
    return;
  }
  try {
    await target.setSecure({ secure });
    applied = secure;
  } catch (error) {
    console.warn('[stash] could not change screen privacy', error);
  }
}

/** Test seam. */
export function setPrivacyScreenPlugin(next: PrivacyScreenPlugin | null): void {
  plugin = next;
  pluginResolved = true;
  applied = null;
}
