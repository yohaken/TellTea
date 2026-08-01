package app.telltea.npos.update;

import android.content.Context;

/** Ack of the last versionCode whose what's-new card was dismissed. */
public final class WhatsNewPrefs {
  private static final String PREFS = "npos_whats_new";
  private static final String KEY_ACK_CODE = "ackVersionCode";

  private WhatsNewPrefs() {}

  public static int ackVersionCode(Context context) {
    return context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getInt(KEY_ACK_CODE, 0);
  }

  public static void markAck(Context context, int versionCode) {
    if (versionCode <= 0) return;
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(KEY_ACK_CODE, versionCode)
        .apply();
  }

  /** True when this build has slides and staff have not dismissed them yet. */
  public static boolean shouldShow(Context context, int versionCode) {
    if (versionCode <= 0) return false;
    if (ackVersionCode(context) >= versionCode) return false;
    return !WhatsNewCatalog.slidesFor(versionCode).isEmpty();
  }
}
