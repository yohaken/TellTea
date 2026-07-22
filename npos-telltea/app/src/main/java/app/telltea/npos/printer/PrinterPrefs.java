package app.telltea.npos.printer;

import android.content.Context;
import android.content.SharedPreferences;

/** Last successful / selected printer endpoint for heartbeat + N5 drawer. */
public final class PrinterPrefs {
    private static final String PREFS = "npos_printer";
    private static final String KEY_ID = "endpointId";
    private static final String KEY_LABEL = "endpointLabel";
    private static final String KEY_KIND = "endpointKind";
    private static final String KEY_READY = "printerReady";
    private static final String KEY_LAST_OK_AT = "lastOkAt";

    private PrinterPrefs() {}

    public static void saveSuccess(Context context, PrinterEndpoint endpoint) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_ID, endpoint.id)
                .putString(KEY_LABEL, endpoint.label)
                .putString(KEY_KIND, endpoint.kind.name())
                .putBoolean(KEY_READY, true)
                .putLong(KEY_LAST_OK_AT, System.currentTimeMillis())
                .apply();
    }

    public static void markNotReady(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_READY, false)
                .apply();
    }

    public static boolean isReady(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_READY, false);
    }

    public static String label(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LABEL, "");
    }

    public static String endpointId(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ID, "");
    }

    public static PrinterEndpoint.Kind kind(Context context) {
        String raw =
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_KIND, "");
        if ("BLUETOOTH".equals(raw)) return PrinterEndpoint.Kind.BLUETOOTH;
        if ("USB".equals(raw)) return PrinterEndpoint.Kind.USB;
        if ("NETWORK".equals(raw)) return PrinterEndpoint.Kind.NETWORK;
        return null;
    }

    public static PrinterEndpoint savedOrNull(Context context) {
        String id = endpointId(context);
        if (id == null || id.isEmpty()) return null;
        PrinterEndpoint.Kind kind = kind(context);
        if (kind == null) return null;
        String label = label(context);
        return new PrinterEndpoint(kind, id, label == null || label.isEmpty() ? id : label, "");
    }
}
