package app.web.Stash;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Register the plugins that are local to the app rather than shipped as npm
     * packages. Capacitor's own plugins register themselves from the generated
     * plugin manifest; these two are small enough to live here, and keeping them
     * local means the two places that touch Android-specific behaviour — the
     * window flags and the incoming share — have no third-party dependency.
     *
     * The share receiver needs no further wiring: registering it before
     * `super.onCreate` is enough, because Capacitor replays the launching intent
     * (the cold-start share) through the plugin's `handleOnNewIntent`, and routes
     * every later one the same way.
     *
     * `EdgeToEdge.enable` is Capacitor's own recommendation for Capacitor 8 and
     * is what makes the window edge-to-edge on Android 14 and older too, where
     * Android does not force it. The window then extends under the status bar
     * and the gesture bar on every supported version, and the WebView reports
     * the insets the web layer lays itself out with -- one layout story across
     * devices instead of two. The CSS side never double-pads: when Capacitor
     * resolves to padding the WebView natively it reports zero insets.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        registerPlugin(PrivacyScreenPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
