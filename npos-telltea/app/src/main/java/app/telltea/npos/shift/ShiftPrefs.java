package app.telltea.npos.shift;

import android.content.Context;
import android.content.SharedPreferences;

/** Local shift/session state for nPos sell. */
public final class ShiftPrefs {
    private static final String PREFS = "npos_shift";
    private static final String KEY_OPEN = "open";
    private static final String KEY_OPENED_AT = "openedAt";
    private static final String KEY_SESSION = "sessionId";
    private static final String KEY_SHIFT = "shift";
    private static final String KEY_CASH = "cashTotal";
    private static final String KEY_PP = "promptpayTotal";

    private ShiftPrefs() {}

    public static boolean isOpen(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_OPEN, false);
    }

    public static long openedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_OPENED_AT, 0L);
    }

    public static String sessionId(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SESSION, "");
    }

    public static String shift(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SHIFT, "morning");
    }

    public static double cashTotal(Context context) {
        return Double.longBitsToDouble(
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_CASH, 0L));
    }

    public static double promptpayTotal(Context context) {
        return Double.longBitsToDouble(
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_PP, 0L));
    }

    public static void open(Context context) {
        open(context, "", "morning", System.currentTimeMillis());
    }

    public static void open(Context context, String sessionId, String shift, long openedAt) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_OPEN, true)
                .putLong(KEY_OPENED_AT, openedAt)
                .putString(KEY_SESSION, sessionId == null ? "" : sessionId)
                .putString(KEY_SHIFT, shift == null ? "morning" : shift)
                .putLong(KEY_CASH, Double.doubleToRawLongBits(0))
                .putLong(KEY_PP, Double.doubleToRawLongBits(0))
                .apply();
    }

    public static void addCash(Context context, double amount) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        double next = cashTotal(context) + amount;
        prefs.edit().putLong(KEY_CASH, Double.doubleToRawLongBits(next)).apply();
    }

    public static void addPromptPay(Context context, double amount) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        double next = promptpayTotal(context) + amount;
        prefs.edit().putLong(KEY_PP, Double.doubleToRawLongBits(next)).apply();
    }

    public static void close(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_OPEN, false)
                .apply();
    }
}
