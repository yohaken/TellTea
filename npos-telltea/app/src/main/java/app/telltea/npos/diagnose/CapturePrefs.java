package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/** Local ack / interval / pending-consent state for screen capture commands. */
public final class CapturePrefs {
    private static final String PREFS = "npos_capture";

    private CapturePrefs() {}

    public static long lastAckRequestAt(Context context) {
        return prefs(context).getLong("lastAckRequestAt", 0L);
    }

    public static void setLastAckRequestAt(Context context, long at) {
        prefs(context)
                .edit()
                .putLong("lastAckRequestAt", at)
                .remove("pendingConsentRequestAt")
                .remove("pendingConsentReason")
                .apply();
    }

    public static long lastCaptureAt(Context context) {
        return prefs(context).getLong("lastCaptureAt", 0L);
    }

    public static void setLastCaptureAt(Context context, long at) {
        prefs(context).edit().putLong("lastCaptureAt", at).apply();
    }

    public static int intervalMinutes(Context context) {
        return prefs(context).getInt("intervalMinutes", 0);
    }

    public static void setIntervalMinutes(Context context, int minutes) {
        prefs(context).edit().putInt("intervalMinutes", Math.max(0, minutes)).apply();
    }

    /** Remember BO capture that still needs MediaProjection consent (not acked yet). */
    public static void setPendingConsent(Context context, long requestAt, String reason) {
        if (requestAt <= 0) return;
        prefs(context)
                .edit()
                .putLong("pendingConsentRequestAt", requestAt)
                .putString("pendingConsentReason", reason == null ? "manual" : reason)
                .apply();
    }

    public static long pendingConsentRequestAt(Context context) {
        return prefs(context).getLong("pendingConsentRequestAt", 0L);
    }

    public static String pendingConsentReason(Context context) {
        String r = prefs(context).getString("pendingConsentReason", "manual");
        return r == null || r.isEmpty() ? "manual" : r;
    }

    public static void clearPendingConsent(Context context) {
        prefs(context)
                .edit()
                .remove("pendingConsentRequestAt")
                .remove("pendingConsentReason")
                .apply();
    }

    /** True while BO asked for a capture that has not been uploaded/acked. */
    public static boolean hasOutstandingCaptureRequest(Context context) {
        long pending = pendingConsentRequestAt(context);
        if (pending <= 0) return false;
        return pending > lastAckRequestAt(context);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
