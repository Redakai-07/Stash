package app.web.Stash;

import android.os.Bundle;

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
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrivacyScreenPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
