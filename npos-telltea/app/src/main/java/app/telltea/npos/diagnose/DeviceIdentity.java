package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** Stable install / device id shared by diagnose + heartbeat. */
public final class DeviceIdentity {
    private static final String PREFS = "npos_diagnose";
    private static final String KEY = "installId";

    private DeviceIdentity() {}

    public static String getOrCreateInstallId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY, null);
        if (id != null && id.length() >= 8) return id;
        id = UUID.randomUUID().toString().replace("-", "");
        prefs.edit().putString(KEY, id).apply();
        return id;
    }

    /** Last 6 chars upper — matches back-office pairingCode style. */
    public static String pairingCode(Context context) {
        String id = getOrCreateInstallId(context);
        String compact = id.replace("-", "");
        if (compact.length() <= 6) return compact.toUpperCase();
        return compact.substring(compact.length() - 6).toUpperCase();
    }
}
