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
    private static final String KEY_PAPER_WIDTH_MM = "paperWidthMm";

    public static final int PAPER_58 = 58;
    public static final int PAPER_80 = 80;

    private PrinterPrefs() {}

    public static int getPaperWidthMm(Context context) {
        if (context == null) return PAPER_80;
        int w =
            context
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getInt(KEY_PAPER_WIDTH_MM, PAPER_80);
        return w == PAPER_58 ? PAPER_58 : PAPER_80;
    }

    public static void setPaperWidthMm(Context context, int widthMm) {
        if (context == null) return;
        int w = widthMm == PAPER_58 ? PAPER_58 : PAPER_80;
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_PAPER_WIDTH_MM, w)
            .apply();
    }

    /** ESC/POS text columns for the saved paper width. */
    public static int receiptCols(Context context) {
        return getPaperWidthMm(context) == PAPER_58
            ? ReceiptFormBuilder.COLS_58
            : ReceiptFormBuilder.COLS_80;
    }

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
