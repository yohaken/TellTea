package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/** Local ack / interval state for screen capture commands. */
public final class CapturePrefs {
    private static final String PREFS = "npos_capture";

    private CapturePrefs() {}

    public static long lastAckRequestAt(Context context) {
        return prefs(context).getLong("lastAckRequestAt", 0L);
    }

    public static void setLastAckRequestAt(Context context, long at) {
        prefs(context).edit().putLong("lastAckRequestAt", at).apply();
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

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
