package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import java.util.UUID;

/**
 * Stable device id for heartbeat / diagnose.
 * Prefer ANDROID_ID so reinstall on the same emulator/device does not spawn a new "machine".
 *
 * <p>deviceClass defaults: emulator → {@code dev}, real tablet → {@code shop}.
 * Back-office can set {@code blocked}; the client never claims blocked itself.
 */
public final class DeviceIdentity {
    private static final String PREFS = "npos_diagnose";
    private static final String KEY = "installId";
    /** Known broken ANDROID_ID on some old devices/emulators. */
    private static final String BAD_ANDROID_ID = "9774d56d682e549c";

    public static final String CLASS_SHOP = "shop";
    public static final String CLASS_DEV = "dev";

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

    /** Heuristic: AVD / Genymotion / SDK images → treat as long-lived dev machines. */
    public static boolean isEmulator() {
        String fingerprint = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String brand = Build.BRAND == null ? "" : Build.BRAND;
        String device = Build.DEVICE == null ? "" : Build.DEVICE;
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String hardware = Build.HARDWARE == null ? "" : Build.HARDWARE;
        return fingerprint.startsWith("generic")
                || fingerprint.startsWith("unknown")
                || model.contains("google_sdk")
                || model.contains("Emulator")
                || model.contains("Android SDK built for x86")
                || manufacturer.contains("Genymotion")
                || (brand.startsWith("generic") && device.startsWith("generic"))
                || "google_sdk".equals(product)
                || hardware.contains("goldfish")
                || hardware.contains("ranchu")
                || product.contains("sdk_gphone")
                || product.contains("emulator")
                || product.contains("sdk");
    }

    /** Client-side default class only — never {@code blocked}. */
    public static String deviceClass() {
        return isEmulator() ? CLASS_DEV : CLASS_SHOP;
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
