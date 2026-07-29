package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

import app.telltea.npos.R;

/**
 * Device-local setting: how long to show cash-change after pay.
 * Staff can tune on the tablet (Settings) without BO — front-counter convenience.
 *
 * <ul>
 *   <li>Positive seconds → auto-dismiss after that many seconds
 *   <li>{@link #MANUAL} (−1) → stay until staff taps «ตกลง» (or starts next cart)
 * </ul>
 */
public final class ChangeDisplayPrefs {
  public static final int MANUAL = -1;
  /** Default 10s — longer than the old 3.5s flash; still keeps the line moving. */
  public static final int DEFAULT_SECONDS = 10;

  /** Cycle order in Settings. */
  public static final int[] OPTIONS = {3, 5, 8, 10, 12, 15, MANUAL};

  private static final String PREFS = "npos_change_display";
  private static final String KEY_SECONDS = "holdSeconds";

  private ChangeDisplayPrefs() {}

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /** Seconds to hold, or {@link #MANUAL}. */
  public static int holdSeconds(Context context) {
    int v = prefs(context).getInt(KEY_SECONDS, DEFAULT_SECONDS);
    if (v == MANUAL) return MANUAL;
    if (v < 1) return DEFAULT_SECONDS;
    if (v > 120) return 120;
    return v;
  }

  public static boolean isManual(Context context) {
    return holdSeconds(context) == MANUAL;
  }

  public static void setHoldSeconds(Context context, int seconds) {
    int v = seconds == MANUAL ? MANUAL : Math.max(1, Math.min(120, seconds));
    prefs(context).edit().putInt(KEY_SECONDS, v).apply();
  }

  /** Advance to the next option in {@link #OPTIONS}. */
  public static int cycleNext(Context context) {
    int cur = holdSeconds(context);
    int idx = 0;
    for (int i = 0; i < OPTIONS.length; i++) {
      if (OPTIONS[i] == cur) {
        idx = i;
        break;
      }
    }
    int next = OPTIONS[(idx + 1) % OPTIONS.length];
    setHoldSeconds(context, next);
    return next;
  }

  public static String label(Context context) {
    return label(context, holdSeconds(context));
  }

  public static String label(Context context, int seconds) {
    if (seconds == MANUAL) {
      return context.getString(R.string.change_display_manual);
    }
    return context.getString(R.string.change_display_seconds_fmt, seconds);
  }

  /**
   * Hold duration in ms for a cash sale with change. {@code -1} means manual (no auto timer).
   * Exact tender (no change) callers should keep using the short default splash.
   */
  public static long holdMsForChange(Context context) {
    int s = holdSeconds(context);
    if (s == MANUAL) return -1L;
    return s * 1000L;
  }
}
