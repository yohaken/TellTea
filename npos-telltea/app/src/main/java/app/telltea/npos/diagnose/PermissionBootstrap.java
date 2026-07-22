package app.telltea.npos.diagnose;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import java.util.ArrayList;
import java.util.List;

/**
 * One-tap / first-open grant for shop tablets.
 * Staff should not dig through Android settings — ask everything up front.
 */
public final class PermissionBootstrap {
  private static final String PREFS = "npos_perm_bootstrap";
  private static final String KEY_PROMPTED = "prompted_v1";
  public static final int REQ_RUNTIME = 7101;
  public static final int REQ_INSTALL = 7102;
  public static final int REQ_BATTERY = 7103;

  private PermissionBootstrap() {}

  public static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static boolean wasPrompted(Context context) {
    return prefs(context).getBoolean(KEY_PROMPTED, false);
  }

  public static void markPrompted(Context context) {
    prefs(context).edit().putBoolean(KEY_PROMPTED, true).apply();
  }

  public static boolean needsBluetooth(Context context) {
    if (Build.VERSION.SDK_INT < 31) return false;
    return context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
        != PackageManager.PERMISSION_GRANTED;
  }

  public static boolean needsNotifications(Context context) {
    if (Build.VERSION.SDK_INT < 33) return false;
    return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
        != PackageManager.PERMISSION_GRANTED;
  }

  public static boolean canInstallPackages(Context context) {
    if (Build.VERSION.SDK_INT < 26) return true;
    return context.getPackageManager().canRequestPackageInstalls();
  }

  public static boolean isBatteryUnrestricted(Context context) {
    if (Build.VERSION.SDK_INT < 23) return true;
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    if (pm == null) return true;
    return pm.isIgnoringBatteryOptimizations(context.getPackageName());
  }

  /** True when every shop-critical grant is in place. */
  public static boolean allCriticalGranted(Context context) {
    return !needsBluetooth(context)
        && !needsNotifications(context)
        && canInstallPackages(context);
  }

  public static String statusLine(Context context) {
    List<String> missing = new ArrayList<>();
    if (needsBluetooth(context)) missing.add("Bluetooth");
    if (needsNotifications(context)) missing.add("แจ้งเตือน");
    if (!canInstallPackages(context)) missing.add("ติดตั้งอัปเดต");
    if (!isBatteryUnrestricted(context)) missing.add("แบตเตอรี่");
    if (missing.isEmpty()) return "สิทธิ์ครบ";
    return "ยังขาด: " + String.join(" · ", missing);
  }

  public static String[] missingRuntimePermissions(Context context) {
    List<String> need = new ArrayList<>();
    if (needsBluetooth(context)) need.add(Manifest.permission.BLUETOOTH_CONNECT);
    if (needsNotifications(context)) need.add(Manifest.permission.POST_NOTIFICATIONS);
    return need.toArray(new String[0]);
  }

  /**
   * Request runtime permissions first; caller should then open install + battery
   * screens via {@link #continueSystemSettings(Activity)}.
   */
  public static boolean requestRuntimeIfNeeded(Activity activity) {
    markPrompted(activity);
    String[] need = missingRuntimePermissions(activity);
    if (need.length == 0) return false;
    activity.requestPermissions(need, REQ_RUNTIME);
    return true;
  }

  /** Open install-unknown + battery exemption screens (one at a time). */
  public static void continueSystemSettings(Activity activity) {
    if (!canInstallPackages(activity)) {
      openInstallPermission(activity);
      return;
    }
    if (!isBatteryUnrestricted(activity)) {
      openBatteryExemption(activity);
    }
  }

  public static void openInstallPermission(Activity activity) {
    if (Build.VERSION.SDK_INT < 26) return;
    try {
      Intent i =
          new Intent(
              Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
              Uri.parse("package:" + activity.getPackageName()));
      activity.startActivityForResult(i, REQ_INSTALL);
    } catch (Exception ignored) {
      try {
        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES));
      } catch (Exception ignored2) {
        /* no settings UI */
      }
    }
  }

  public static void openBatteryExemption(Activity activity) {
    if (Build.VERSION.SDK_INT < 23) return;
    try {
      Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      i.setData(Uri.parse("package:" + activity.getPackageName()));
      activity.startActivityForResult(i, REQ_BATTERY);
    } catch (Exception ignored) {
      try {
        activity.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
      } catch (Exception ignored2) {
        /* no settings UI */
      }
    }
  }

  /** One button: runtime dialogs then system settings. */
  public static void grantAll(Activity activity) {
    markPrompted(activity);
    if (requestRuntimeIfNeeded(activity)) {
      return;
    }
    continueSystemSettings(activity);
  }
}
