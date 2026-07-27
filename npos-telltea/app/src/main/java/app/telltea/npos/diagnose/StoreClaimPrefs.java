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
  private static final String KEY_KICK_REASON = "kickReason";
  private static final String KEY_UPDATED = "updatedAt";
  private static final String KEY_CODE_HASH = "codeHash";
  private static final String KEY_HASH_AT = "codeHashAt";
  private static final String KEY_PENDING_SYNC = "claimPendingSync";
  private static final String KEY_PENDING_CODE = "claimPendingCode";

  /** Owner revoked claim from BO table / clear seat. */
  public static final String REASON_KICKED = "kicked";
  /** Store code hash changed — must re-enter new code. */
  public static final String REASON_CODE_CHANGED = "code_changed";

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
    applyFromServer(context, required, claimed, blocked, rejectDev, seatHeldByMe, seatTaken, kicked, null, 0);
  }

  public static void applyFromServer(
      Context context,
      boolean required,
      boolean claimed,
      boolean blocked,
      boolean rejectDev,
      boolean seatHeldByMe,
      boolean seatTaken,
      boolean kicked,
      String codeHash,
      long hashUpdatedAt) {
    boolean wasHeld = isSeatHeld(context) || isClaimed(context);
    String prevHash = cachedCodeHash(context);
    String nextHash =
        codeHash != null && codeHash.length() >= 32 ? codeHash.trim().toLowerCase() : null;
    // Only treat as code-change when we already had a real hash (avoid false kick on first cache).
    boolean hashChanged =
        prevHash != null
            && prevHash.length() >= 32
            && nextHash != null
            && !prevHash.equals(nextHash);

    boolean effectiveClaimed = claimed;
    boolean effectiveHeld = seatHeldByMe;
    boolean effectiveKicked = kicked;
    String reason = "";
    if (hashChanged && wasHeld) {
      effectiveClaimed = false;
      effectiveHeld = false;
      effectiveKicked = true;
      reason = REASON_CODE_CHANGED;
    } else if (kicked) {
      reason = REASON_KICKED;
    }

    SharedPreferences.Editor ed =
        prefs(context)
            .edit()
            .putBoolean(KEY_REQUIRED, required)
            .putBoolean(KEY_CLAIMED, effectiveClaimed)
            .putBoolean(KEY_BLOCKED, blocked)
            .putBoolean(KEY_REJECT_DEV, rejectDev)
            .putBoolean(KEY_SEAT_HELD, effectiveHeld)
            .putBoolean(KEY_SEAT_TAKEN, seatTaken)
            .putBoolean(KEY_KICKED, effectiveKicked)
            .putLong(KEY_UPDATED, System.currentTimeMillis());
    if (reason.isEmpty()) {
      ed.remove(KEY_KICK_REASON);
    } else {
      ed.putString(KEY_KICK_REASON, reason);
    }
    if (nextHash != null) {
      ed.putString(KEY_CODE_HASH, nextHash);
      if (hashUpdatedAt > 0) ed.putLong(KEY_HASH_AT, hashUpdatedAt);
    } else if (!required) {
      ed.remove(KEY_CODE_HASH);
    }
    if (effectiveHeld) {
      ed.putBoolean(KEY_PENDING_SYNC, false);
    } else if (hashChanged && wasHeld) {
      ed.putBoolean(KEY_PENDING_SYNC, false);
      ed.remove(KEY_PENDING_CODE);
    }
    ed.apply();
    boolean lost =
        (hashChanged && wasHeld)
            || (wasHeld && required && (effectiveKicked || !effectiveHeld));
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
    applyFromServer(context, required, claimed, blocked, rejectDev, claimed, false, false, null, 0);
  }

  public static void cacheCodeHash(Context context, String codeHash, long updatedAt) {
    if (codeHash == null || codeHash.length() < 32) return;
    String next = codeHash.trim().toLowerCase();
    String prev = cachedCodeHash(context);
    boolean wasHeld = isSeatHeld(context) || isClaimed(context);
    boolean hashChanged = prev != null && prev.length() >= 32 && !prev.equals(next);
    SharedPreferences.Editor ed =
        prefs(context)
            .edit()
            .putString(KEY_CODE_HASH, next)
            .putLong(KEY_HASH_AT, updatedAt > 0 ? updatedAt : System.currentTimeMillis());
    if (hashChanged && wasHeld) {
      ed.putBoolean(KEY_CLAIMED, false)
          .putBoolean(KEY_SEAT_HELD, false)
          .putBoolean(KEY_KICKED, true)
          .putString(KEY_KICK_REASON, REASON_CODE_CHANGED)
          .putBoolean(KEY_PENDING_SYNC, false)
          .remove(KEY_PENDING_CODE)
          .putLong(KEY_UPDATED, System.currentTimeMillis());
    }
    ed.apply();
    if (hashChanged && wasHeld) {
      KickListener l = kickListener;
      if (l != null) l.onKickedOrLostSeat();
    }
  }

  public static String cachedCodeHash(Context context) {
    return prefs(context).getString(KEY_CODE_HASH, "");
  }

  public static boolean hasCachedCodeHash(Context context) {
    String h = cachedCodeHash(context);
    return h != null && h.length() >= 32;
  }

  public static void markClaimed(Context context) {
    markClaimed(context, false);
  }

  /** Local-first claim — pendingSync=true until server seat assign confirms. */
  public static void markClaimed(Context context, boolean pendingSync) {
    markClaimed(context, pendingSync, null);
  }

  public static void markClaimed(Context context, boolean pendingSync, String pendingCode) {
    SharedPreferences.Editor ed =
        prefs(context)
            .edit()
            .putBoolean(KEY_CLAIMED, true)
            .putBoolean(KEY_REQUIRED, true)
            .putBoolean(KEY_SEAT_HELD, true)
            .putBoolean(KEY_SEAT_TAKEN, false)
            .putBoolean(KEY_KICKED, false)
            .remove(KEY_KICK_REASON)
            .putBoolean(KEY_PENDING_SYNC, pendingSync)
            .putLong(KEY_UPDATED, System.currentTimeMillis());
    if (pendingSync && pendingCode != null && !pendingCode.isEmpty()) {
      ed.putString(KEY_PENDING_CODE, pendingCode);
    } else {
      ed.remove(KEY_PENDING_CODE);
    }
    ed.apply();
  }

  public static String pendingClaimCode(Context context) {
    return prefs(context).getString(KEY_PENDING_CODE, "");
  }

  public static void markClaimSynced(Context context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_PENDING_SYNC, false)
        .remove(KEY_PENDING_CODE)
        .apply();
  }

  public static boolean isClaimPendingSync(Context context) {
    return prefs(context).getBoolean(KEY_PENDING_SYNC, false);
  }

  public static void clearClaim(Context context) {
    prefs(context)
        .edit()
        .putBoolean(KEY_CLAIMED, false)
        .putBoolean(KEY_SEAT_HELD, false)
        .putBoolean(KEY_KICKED, true)
        .putString(KEY_KICK_REASON, REASON_KICKED)
        .putBoolean(KEY_PENDING_SYNC, false)
        .remove(KEY_PENDING_CODE)
        .putLong(KEY_UPDATED, System.currentTimeMillis())
        .apply();
  }

  public static String kickReason(Context context) {
    return prefs(context).getString(KEY_KICK_REASON, "");
  }

  public static boolean wasCodeChanged(Context context) {
    return REASON_CODE_CHANGED.equals(kickReason(context));
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
    if (isKicked(context)) {
      if (wasCodeChanged(context)) return "รหัสร้านเปลี่ยน — กรอกรหัสใหม่";
      return "ถูกถอนสิทธิ์จากหลังบ้าน — กรอกรหัสร้านใหม่";
    }
    if (isSeatTaken(context)) return "มีเครื่องอื่นใช้อยู่ — ให้หลังบ้านเตะเครื่องนั้นก่อน";
    if (!isSeatHeld(context)) return "กรอกรหัสร้านเพื่อเคลมเครื่องก่อนขาย";
    return "";
  }
}
