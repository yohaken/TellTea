package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Consent for MediaProjection screen capture only (not BT / notifications).
 *
 * <ul>
 *   <li>BO manual capture / after-update: keep asking until staff grant (nag-until-grant).
 *   <li>Interval captures: after deny, throttle 6h so sell flow is not interrupted every tick.
 *   <li>Projection token does not survive process death — re-ask then is necessary.
 * </ul>
 */
public final class CaptureProjectionPrefs {
  private static final String PREFS = "npos_capture_projection";
  private static final String KEY_STATE = "consent_state"; // none|granted|denied
  private static final String KEY_PROMPT_AFTER_UPDATE = "prompt_after_update";
  private static final String KEY_LAST_PROMPT_AT = "last_prompt_at";
  /** Sticky: keep re-showing the system dialog until MediaProjection is live. */
  private static final String KEY_NAG_UNTIL_GRANT = "nag_until_grant";

  public static final String STATE_NONE = "none";
  public static final String STATE_GRANTED = "granted";
  public static final String STATE_DENIED = "denied";

  private CaptureProjectionPrefs() {}

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static String consentState(Context context) {
    String s = prefs(context).getString(KEY_STATE, STATE_NONE);
    if (STATE_GRANTED.equals(s) || STATE_DENIED.equals(s)) return s;
    return STATE_NONE;
  }

  public static void markGranted(Context context) {
    prefs(context)
        .edit()
        .putString(KEY_STATE, STATE_GRANTED)
        .putBoolean(KEY_PROMPT_AFTER_UPDATE, false)
        .putBoolean(KEY_NAG_UNTIL_GRANT, false)
        .apply();
  }

  public static void markDenied(Context context) {
    prefs(context)
        .edit()
        .putString(KEY_STATE, STATE_DENIED)
        .putBoolean(KEY_PROMPT_AFTER_UPDATE, false)
        .apply();
  }

  /**
   * Projection token died (process death / system revoke) while prefs still said granted.
   * Reset to none so the next BO capture can re-prompt immediately (not 6h interval throttle).
   */
  public static void markProjectionDead(Context context) {
    prefs(context)
        .edit()
        .putString(KEY_STATE, STATE_NONE)
        .putBoolean(KEY_NAG_UNTIL_GRANT, false)
        .apply();
  }

  /** Call when APK update finishes — ask capture consent on next UI open. */
  public static void markPromptAfterUpdate(Context context) {
    prefs(context).edit().putBoolean(KEY_PROMPT_AFTER_UPDATE, true).apply();
  }

  public static boolean consumePromptAfterUpdate(Context context) {
    SharedPreferences p = prefs(context);
    if (!p.getBoolean(KEY_PROMPT_AFTER_UPDATE, false)) return false;
    p.edit().putBoolean(KEY_PROMPT_AFTER_UPDATE, false).apply();
    return true;
  }

  public static void markNagUntilGrant(Context context) {
    prefs(context).edit().putBoolean(KEY_NAG_UNTIL_GRANT, true).apply();
  }

  public static void clearNagUntilGrant(Context context) {
    prefs(context).edit().putBoolean(KEY_NAG_UNTIL_GRANT, false).apply();
  }

  public static boolean shouldNagUntilGrant(Context context) {
    return prefs(context).getBoolean(KEY_NAG_UNTIL_GRANT, false);
  }

  public static void touchPrompted(Context context) {
    prefs(context).edit().putLong(KEY_LAST_PROMPT_AT, System.currentTimeMillis()).apply();
  }

  public static long lastPromptAt(Context context) {
    return prefs(context).getLong(KEY_LAST_PROMPT_AT, 0L);
  }

  /** Need a system capture dialog when we do not already hold a live MediaProjection. */
  public static boolean needsCaptureConsent(Context context) {
    return !CaptureProjectionService.hasLiveProjection();
  }

  /**
   * Auto-prompt policy: always for BO manual / after-update / sticky nag. After a deny, throttle
   * interval-only retries so staff are not interrupted every heartbeat while selling.
   */
  public static boolean shouldAutoPrompt(Context context, String reason) {
    if (!needsCaptureConsent(context)) return false;
    String why = reason == null ? "" : reason;
    if ("manual".equals(why) || "after_update".equals(why)) return true;
    if (shouldNagUntilGrant(context)) return true;
    if (STATE_DENIED.equals(consentState(context))) {
      long last = lastPromptAt(context);
      if (last > 0 && System.currentTimeMillis() - last < 6L * 60L * 60L * 1000L) {
        return false;
      }
    }
    return true;
  }
}
