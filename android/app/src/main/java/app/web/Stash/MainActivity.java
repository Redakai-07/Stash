package app.web.Stash;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Register the plugins that are local to the app rather than shipped as npm
     * packages. Capacitor's own plugins (including the share receiver) register
     * themselves from the generated plugin manifest; the privacy screen control
     * is small enough to live here, and keeping it local means there is no
     * third-party dependency in the one place that touches window flags.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrivacyScreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
