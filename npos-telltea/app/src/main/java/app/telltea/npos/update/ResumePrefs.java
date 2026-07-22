package app.telltea.npos.update;

import android.content.Context;

/**
 * Survive package replace so staff land back on sell without re-clock-in.
 * ShiftPrefs already keeps the open shift; this only marks “resume sell after update”.
 */
public final class ResumePrefs {
  private static final String PREFS = "npos_resume";
  private static final String KEY_AFTER_UPDATE = "afterUpdateSell";
  private static final String KEY_DISMISS_UNTIL = "dismissPopupUntil";
  private static final String KEY_RESTORE_HOLD = "restoreHoldAfterUpdate";

  private ResumePrefs() {}

  public static void markResumeSellAfterUpdate(Context context) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_AFTER_UPDATE, true)
        .apply();
  }

  public static void markRestoreHoldAfterUpdate(Context context) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_RESTORE_HOLD, true)
        .apply();
  }

  public static boolean consumeRestoreHoldAfterUpdate(Context context) {
    boolean v =
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_RESTORE_HOLD, false);
    if (v) {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putBoolean(KEY_RESTORE_HOLD, false)
          .apply();
    }
    return v;
  }

  public static boolean consumeResumeSellAfterUpdate(Context context) {
    boolean v =
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_AFTER_UPDATE, false);
    if (v) {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putBoolean(KEY_AFTER_UPDATE, false)
          .apply();
    }
    return v;
  }

  public static void dismissPopupFor(Context context, long ms) {
    long until = System.currentTimeMillis() + Math.max(0L, ms);
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putLong(KEY_DISMISS_UNTIL, until)
        .apply();
  }

  public static boolean isPopupDismissed(Context context) {
    long until =
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_DISMISS_UNTIL, 0L);
    return System.currentTimeMillis() < until;
  }
}
