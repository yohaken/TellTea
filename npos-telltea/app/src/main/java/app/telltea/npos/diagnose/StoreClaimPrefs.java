package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Local cache of store-claim / exclusive-seat status from heartbeat / claim CF.
 */
public final class StoreClaimPrefs {
  private static final String PREFS = "npos_store_claim";
  private static final String KEY_REQUIRED = "required";
  private static final String KEY_CLAIMED = "claimed";
  private static final String KEY_BLOCKED = "blocked";
  private static final String KEY_REJECT_DEV = "rejectDev";
  private static final String KEY_SEAT_HELD = "seatHeldByMe";
  private static final String KEY_SEAT_TAKEN = "seatTaken";
  private static final String KEY_KICKED = "kicked";
  private static final String KEY_UPDATED = "updatedAt";

  public interface KickListener {
    void onKickedOrLostSeat();
  }

  private static volatile KickListener kickListener;

  private StoreClaimPrefs() {}

  public static void setKickListener(KickListener listener) {
    kickListener = listener;
  }

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static void applyFromServer(
      Context context,
      boolean required,
      boolean claimed,
      boolean blocked,
      boolean rejectDev,
      boolean seatHeldByMe,
      boolean seatTaken,
      boolean kicked) {
    boolean wasHeld = isSeatHeld(context) || isClaimed(context);
    prefs(context)
        .edit()
        .putBoolean(KEY_REQUIRED, required)
        .putBoolean(KEY_CLAIMED, claimed)
        .putBoolean(KEY_BLOCKED, blocked)
        .putBoolean(KEY_REJECT_DEV, rejectDev)
        .putBoolean(KEY_SEAT_HELD, seatHeldByMe)
        .putBoolean(KEY_SEAT_TAKEN, seatTaken)
        .putBoolean(KEY_KICKED, kicked)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
    boolean lost = wasHeld && required && (kicked || !seatHeldByMe);
    if (lost) {
      KickListener l = kickListener;
      if (l != null) l.onKickedOrLostSeat();
    }
  }

  /** @deprecated use full applyFromServer */
  public static void applyFromServer(
      Context context,
      boolean required,
      boolean claimed,
      boolean blocked,
      boolean rejectDev) {
    applyFromServer(context, required, claimed, blocked, rejectDev, claimed, false, false);
  }

  public static void markClaimed(Context context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_CLAIMED, true)
        .putBoolean(KEY_REQUIRED, true)
        .putBoolean(KEY_SEAT_HELD, true)
        .putBoolean(KEY_SEAT_TAKEN, false)
        .putBoolean(KEY_KICKED, false)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
  }

  public static void clearClaim(Context context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_CLAIMED, false)
        .putBoolean(KEY_SEAT_HELD, false)
        .putBoolean(KEY_KICKED, true)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
  }

  public static boolean isRequired(Context context) {
    return prefs(context).getBoolean(KEY_REQUIRED, false);
  }

  public static boolean isClaimed(Context context) {
    return prefs(context).getBoolean(KEY_CLAIMED, false);
  }

  public static boolean isSeatHeld(Context context) {
    return prefs(context).getBoolean(KEY_SEAT_HELD, false);
  }

  public static boolean isSeatTaken(Context context) {
    return prefs(context).getBoolean(KEY_SEAT_TAKEN, false);
  }

  public static boolean isKicked(Context context) {
    return prefs(context).getBoolean(KEY_KICKED, false);
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
    if (isSeatHeld(context)) return false;
    // Exclusive seat empty or lost.
    return true;
  }

  public static String blockReason(Context context) {
    if (isBlocked(context)) return "เครื่องนี้ถูกบล็อกจากหลังบ้าน";
    if (!isRequired(context)) return "";
    if (rejectDev(context) && DeviceIdentity.isEmulator()) {
      return "เครื่องจำลองถูกปิดกั้นช่วงทดลองหน้าร้าน";
    }
    if (isKicked(context)) return "ถูกถอนสิทธิ์จากหลังบ้าน — กรอกรหัสร้านใหม่";
    if (isSeatTaken(context)) return "มีเครื่องอื่นใช้อยู่ — ให้หลังบ้านเตะเครื่องนั้นก่อน";
    if (!isSeatHeld(context)) return "กรอกรหัสร้านเพื่อเคลมเครื่องก่อนขาย";
    return "";
  }
}
