package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import java.util.UUID;

/**
 * Stable device id for heartbeat / diagnose.
 * Prefer ANDROID_ID so reinstall on the same emulator/device does not spawn a new "machine".
 */
public final class DeviceIdentity {
    private static final String PREFS = "npos_diagnose";
    private static final String KEY = "installId";
    /** Known broken ANDROID_ID on some old devices/emulators. */
    private static final String BAD_ANDROID_ID = "9774d56d682e549c";

    private DeviceIdentity() {}

    public static String getOrCreateInstallId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stable = stableIdFromAndroid(context);
        if (stable != null) {
            String cached = prefs.getString(KEY, null);
            if (!stable.equals(cached)) {
                prefs.edit().putString(KEY, stable).apply();
            }
            return stable;
        }

        String id = prefs.getString(KEY, null);
        if (id != null && id.length() >= 8) return id;
        id = "npos" + UUID.randomUUID().toString().replace("-", "");
        prefs.edit().putString(KEY, id).apply();
        return id;
    }

    /** Fingerprint for back-office dedupe (empty if unavailable). */
    public static String stableKey(Context context) {
        String androidId =
                Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId == null) return "";
        androidId = androidId.trim();
        if (androidId.length() < 8 || BAD_ANDROID_ID.equalsIgnoreCase(androidId)) return "";
        return androidId.toLowerCase();
    }

    private static String stableIdFromAndroid(Context context) {
        String key = stableKey(context);
        if (key.isEmpty()) return null;
        return "npos" + key.replace("-", "");
    }

    /** Last 6 chars upper — matches back-office pairingCode style. */
    public static String pairingCode(Context context) {
        String id = getOrCreateInstallId(context);
        String compact = id.replace("-", "");
        if (compact.length() <= 6) return compact.toUpperCase();
        return compact.substring(compact.length() - 6).toUpperCase();
    }
}
