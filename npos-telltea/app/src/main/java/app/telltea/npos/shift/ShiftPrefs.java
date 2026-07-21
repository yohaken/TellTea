package app.telltea.npos.shift;

import android.content.Context;
import android.content.SharedPreferences;

/** Local-only open-shift flag for N6.0 shell (full shift sync later). */
public final class ShiftPrefs {
    private static final String PREFS = "npos_shift";
    private static final String KEY_OPEN = "open";
    private static final String KEY_OPENED_AT = "openedAt";

    private ShiftPrefs() {}

    public static boolean isOpen(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_OPEN, false);
    }

    public static long openedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_OPENED_AT, 0L);
    }

    public static void open(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_OPEN, true)
                .putLong(KEY_OPENED_AT, System.currentTimeMillis())
                .apply();
    }

    public static void close(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_OPEN, false)
                .apply();
    }
}
