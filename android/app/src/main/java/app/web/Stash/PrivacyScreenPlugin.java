package app.web.Stash;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Screen privacy.
 *
 * Android's FLAG_SECURE is a window-level property with two effects that matter
 * to a vault: it blocks screenshots and screen recording of this window, and it
 * makes the recent-apps thumbnail a blank card instead of a photograph of
 * whatever was on screen when the app was backgrounded.
 *
 * The flag is applied on the main thread against the current window, and is
 * applied and cleared at runtime by the web layer, which decides whether it is
 * appropriate: while the vault is locked it is always on, and while it is
 * unlocked only if the user asked for it. Nothing here applies it app-wide.
 */
@CapacitorPlugin(name = "PrivacyScreen")
public class PrivacyScreenPlugin extends Plugin {

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", false));

        getActivity().runOnUiThread(() -> {
            if (secure) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
        });

        JSObject result = new JSObject();
        result.put("secure", secure);
        call.resolve(result);
    }
}
