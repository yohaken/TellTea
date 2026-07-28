package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Remote tablet sync cadence from BO {@code meta/pos.heartbeatIntervalSec}.
 * Applied on each successful device heartbeat so shops can slow the pulse
 * without shipping a new APK.
 */
public final class OpsPulsePrefs {
  private static final String PREFS = "npos_ops_pulse";
  private static final String KEY_HB_SEC = "heartbeatIntervalSec";

  public static final int DEFAULT_SEC = 5;
  public static final int MIN_SEC = 5;
  public static final int MAX_SEC = 600;

  private OpsPulsePrefs() {}

  public static int heartbeatIntervalSec(Context context) {
    int v = prefs(context).getInt(KEY_HB_SEC, DEFAULT_SEC);
    return clampSec(v);
  }

  public static long heartbeatIntervalMs(Context context) {
    return heartbeatIntervalSec(context) * 1000L;
  }

  public static void applyFromServer(Context context, int sec) {
    prefs(context).edit().putInt(KEY_HB_SEC, clampSec(sec)).apply();
  }

  public static int clampSec(int sec) {
    if (sec < MIN_SEC) return MIN_SEC;
    if (sec > MAX_SEC) return MAX_SEC;
    return sec;
  }

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }
}
