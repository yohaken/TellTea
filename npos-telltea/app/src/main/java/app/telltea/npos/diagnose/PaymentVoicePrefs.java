package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

import app.telltea.npos.R;

/** Device-local toggle: speak cash received / change in Thai after pay. */
public final class PaymentVoicePrefs {
  private static final String PREFS = "npos_payment_voice";
  private static final String KEY_ENABLED = "enabled";
  private static final String KEY_THAI_READY = "thaiReady";
  private static final String KEY_THAI_CHECKED = "thaiChecked";

  private PaymentVoicePrefs() {}

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /** Default ON — bundled clips ship in APK (no OEM TTS required). */
  public static boolean isEnabled(Context context) {
    return prefs(context).getBoolean(KEY_ENABLED, true);
  }

  public static void setEnabled(Context context, boolean enabled) {
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
  }

  public static boolean toggle(Context context) {
    boolean next = !isEnabled(context);
    setEnabled(context, next);
    return next;
  }

  public static void setThaiReady(Context context, boolean ready) {
    prefs(context)
        .edit()
        .putBoolean(KEY_THAI_READY, ready)
        .putBoolean(KEY_THAI_CHECKED, true)
        .apply();
  }

  public static boolean thaiReady(Context context) {
    // Bundled voice is always present in 1.14.89+; warm() sets the flag.
    return prefs(context).getBoolean(KEY_THAI_READY, true);
  }

  public static boolean thaiChecked(Context context) {
    return prefs(context).getBoolean(KEY_THAI_CHECKED, true);
  }

  public static String statusLabel(Context context) {
    boolean on = isEnabled(context);
    if (!on) return context.getString(R.string.payment_voice_off);
    return context.getString(R.string.payment_voice_on_bundled);
  }
}
