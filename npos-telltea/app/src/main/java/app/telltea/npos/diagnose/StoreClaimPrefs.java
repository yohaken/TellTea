package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Local cache of store-claim (half-login) status from heartbeat / claim CF.
 */
public final class StoreClaimPrefs {
  private static final String PREFS = "npos_store_claim";
  private static final String KEY_REQUIRED = "required";
  private static final String KEY_CLAIMED = "claimed";
  private static final String KEY_BLOCKED = "blocked";
  private static final String KEY_REJECT_DEV = "rejectDev";
  private static final String KEY_UPDATED = "updatedAt";

  private StoreClaimPrefs() {}

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static void applyFromServer(
      Context context,
      boolean required,
      boolean claimed,
      boolean blocked,
      boolean rejectDev) {
    prefs(context)
        .edit()
        .putBoolean(KEY_REQUIRED, required)
        .putBoolean(KEY_CLAIMED, claimed)
        .putBoolean(KEY_BLOCKED, blocked)
        .putBoolean(KEY_REJECT_DEV, rejectDev)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
  }

  public static void markClaimed(Context context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_CLAIMED, true)
        .putBoolean(KEY_REQUIRED, true)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
  }

  public static boolean isRequired(Context context) {
    return prefs(context).getBoolean(KEY_REQUIRED, false);
  }

  public static boolean isClaimed(Context context) {
    return prefs(context).getBoolean(KEY_CLAIMED, false);
  }

  public static boolean isBlocked(Context context) {
    return prefs(context).getBoolean(KEY_BLOCKED, false);
  }

  public static boolean rejectDev(Context context) {
    return prefs(context).getBoolean(KEY_REJECT_DEV, true);
  }

  /** True when server gate would reject writes from this install. */
  public static boolean blocksWrites(Context context) {
    if (isBlocked(context)) return true;
    if (!isRequired(context)) return false;
    if (rejectDev(context) && DeviceIdentity.isEmulator()) {
      return true;
    }
    return !isClaimed(context);
  }

  public static String blockReason(Context context) {
    if (isBlocked(context)) return "เครื่องนี้ถูกบล็อกจากหลังบ้าน";
    if (!isRequired(context)) return "";
    if (rejectDev(context) && DeviceIdentity.isEmulator()) {
      return "เครื่องจำลองถูกปิดกั้นช่วงทดลองหน้าร้าน";
    }
    if (!isClaimed(context)) return "กรอกรหัสร้านเพื่อเคลมเครื่องก่อนขาย";
    return "";
  }
}
