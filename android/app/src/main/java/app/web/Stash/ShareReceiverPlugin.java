package app.web.Stash;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android share target.
 *
 * Stash is a place links go, so the most important thing the native layer does
 * is accept one from another app. This plugin is the whole of that seam: an
 * {@code ACTION_SEND} intent arrives, its text is handed to JavaScript as a
 * plain string, and nothing above this layer needs to know what an Intent extra
 * is.
 *
 * Nothing here *interprets* the share. Which URL in the shared text is the link,
 * whether there is one at all, and what to do with the rest of the text are
 * product questions with exactly one implementation — in TypeScript, where they
 * are unit-tested against every app that shares. A second, Java-side URL
 * extractor would be a second set of rules to keep in step, and inevitably a
 * second set of bugs.
 *
 * ## Deliveries, and why the payload is static
 *
 * Capacitor's activity routes *both* the launching intent and every later one
 * through {@link #handleOnNewIntent}, so there is no need for the activity to
 * know this plugin exists:
 *
 *  - **Share with Stash closed** — Android creates the process with the share in
 *    its intent; Capacitor's {@code load()} replays it through the same hook.
 *    JavaScript is not listening yet, which is why the payload is also held in a
 *    static field and answered by {@link #getPendingShare} when the app asks.
 *  - **Share with Stash backgrounded or already open** — {@code onNewIntent}
 *    reaches the same hook on the live plugin, so the pending share is updated
 *    *and* an event fires, letting the sheet open without waiting for a resume.
 *
 * A static field is used rather than an instance one because the activity can be
 * recreated while the process lives; the share is the user's intent, and it must
 * outlive a configuration change. It is deliberately *not* persisted to disk: a
 * share that is never consumed is a share the user moved on from, and replaying
 * it after a process death would be a surprise.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    /** The most recent share nobody has consumed yet, across activity instances. */
    private static JSObject pendingShare;

    @Override
    public void load() {
        // Nothing to set up: the intent arrives through handleOnNewIntent, which
        // Capacitor calls during load() for the launching share.
    }

    @Override
    protected void handleOnNewIntent(@Nullable Intent intent) {
        accept(intent);
    }

    private void accept(@Nullable Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean single = Intent.ACTION_SEND.equals(action);
        boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!single && !multiple) return;

        String text = multiple ? collectMultiple(intent) : collectSingle(intent);
        String subject = asString(intent.getStringExtra(Intent.EXTRA_SUBJECT));

        if (text.isEmpty() && subject.isEmpty()) return;

        JSObject payload = new JSObject();
        payload.put("text", text);
        payload.put("subject", subject);
        String sourcePackage = resolveSourcePackage(getActivity());
        if (sourcePackage != null) payload.put("sourcePackage", sourcePackage);
        payload.put("receivedAt", System.currentTimeMillis());

        pendingShare = payload;

        try {
            // A no-op when the page has not finished loading, which is the normal
            // case for a cold-start share. The pending payload covers it.
            notifyListeners("shareReceived", payload);
        } catch (Exception ignored) {
            // Nothing to report: the share is still pending and will be read.
        }
    }

    private String collectSingle(Intent intent) {
        return firstNonEmpty(
            asString(intent.getCharSequenceExtra(Intent.EXTRA_TEXT)),
            // Some browsers send only an HTML body. Passing it through unchanged
            // beats dropping the share: the same text parser finds a URL in
            // markup as in prose, and the link is what matters.
            asString(intent.getCharSequenceExtra(Intent.EXTRA_HTML_TEXT))
        );
    }

    /**
     * Join the pieces of a multi-select share.
     *
     * Several links arrive either as clip items or as a text array depending on
     * the sender, so both are read and joined with newlines. The joined text is
     * handed over exactly like a single share, which means the parser's existing
     * "also save these other links" path picks the extras up for free — no
     * second code path, and no sender-specific handling.
     */
    private String collectMultiple(Intent intent) {
        StringBuilder joined = new StringBuilder();

        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int index = 0; index < clip.getItemCount(); index += 1) {
                CharSequence piece = clip.getItemAt(index).coerceToText(getContext());
                appendLine(joined, piece);
            }
        }

        CharSequence[] extra = intent.getCharSequenceArrayExtra(Intent.EXTRA_TEXT);
        if (extra != null) {
            for (CharSequence piece : extra) appendLine(joined, piece);
        }

        if (joined.length() == 0) appendLine(joined, intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
        return joined.toString().trim();
    }

    private static void appendLine(StringBuilder target, @Nullable CharSequence piece) {
        if (piece == null) return;
        String value = piece.toString().trim();
        if (value.isEmpty()) return;
        if (target.length() > 0) target.append('\n');
        target.append(value);
    }

    /** The share that launched or last landed in the app, if it is unclaimed. */
    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingShare != null) result.put("share", pendingShare);
        call.resolve(result);
    }

    /** Mark the pending share consumed, so a reload cannot replay it. */
    @PluginMethod
    public void clearPendingShare(PluginCall call) {
        pendingShare = null;
        call.resolve();
    }

    /**
     * The other half of being a share citizen: Stash as a *source*.
     *
     * One plugin owns both directions because they are one capability — the app
     * can receive a link and it can hand one on — and because a second plugin
     * would mean a second entry in the native build for the same idea. Android's
     * chooser is used directly rather than a custom sheet: it is where the user's
     * own apps are, it needs no catalogue of targets kept up to date, and it
     * works with no network.
     *
     * A failure is reported rather than swallowed, because unlike an incoming
     * share there is a person waiting for the chooser to appear; the caller
     * falls back to the clipboard.
     */
    @PluginMethod
    public void shareOut(PluginCall call) {
        String text = asString(call.getString("text"));
        String title = asString(call.getString("title"));
        String subject = asString(call.getString("subject"));
        if (text.isEmpty() && title.isEmpty()) {
            call.reject("Nothing to share.");
            return;
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        if (!subject.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, subject);

        Intent chooser = Intent.createChooser(send, title.isEmpty() ? null : title);
        try {
            getActivity().startActivity(chooser);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "No app can receive this." : error.getMessage());
            return;
        }
        call.resolve();
    }

    /**
     * The package that sent the share, when Android exposes it.
     *
     * A share that started the app is usually referred by the sender, which
     * Android reports as {@code android-app://<package>}. A share into a running
     * app frequently carries no sender at all, and reporting nothing is the
     * correct answer there — the UI shows "shared into Stash" rather than
     * inventing a source.
     */
    @Nullable
    private String resolveSourcePackage(@Nullable Activity activity) {
        if (activity == null) return null;
        Uri referrer = activity.getReferrer();
        if (referrer != null && "android-app".equals(referrer.getScheme())) {
            String host = referrer.getHost();
            return host == null || host.isEmpty() ? null : host;
        }
        return null;
    }

    private static String asString(@Nullable CharSequence value) {
        return value == null ? "" : value.toString().trim();
    }

    private static String firstNonEmpty(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isEmpty()) return candidate;
        }
        return "";
    }
}
