package app.telltea.npos.shift;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;

import app.telltea.npos.R;
import app.telltea.npos.diagnose.OpsLogger;

/**
 * Local shift/session state for nPos sell.
 *
 * <p>BO force-close arrives via heartbeat ({@code sessionRemoteClosed}) — seat stays;
 * tablet settles cooperatively (finish cart if needed, then clear local open).
 */
public final class ShiftPrefs {
  private static final String PREFS = "npos_shift";
  private static final String KEY_OPEN = "open";
  private static final String KEY_OPENED_AT = "openedAt";
  private static final String KEY_SESSION = "sessionId";
  private static final String KEY_SHIFT = "shift";
  private static final String KEY_CASH = "cashTotal";
  private static final String KEY_PP = "promptpayTotal";
  private static final String KEY_TRANSFER = "transferTotal";
  private static final String KEY_SALE_COUNT = "saleCount";
  private static final String KEY_CASH_BILLS = "cashBills";
  private static final String KEY_PP_BILLS = "ppBills";
  private static final String KEY_TRANSFER_BILLS = "transferBills";
  private static final String KEY_DISCOUNT = "discountTotal";
  private static final String KEY_VOIDED = "voidedCount";
  private static final String KEY_OPENING_CASH = "openingCash";
  private static final String KEY_NEXT_OPENING = "nextOpeningCash";
  private static final String KEY_LAST_RESUMED = "lastOpenResumed";
  private static final String KEY_CASH_OUT = "cashOutTotal";
  private static final String KEY_CASH_IN = "cashInTotal";
  private static final String KEY_CASH_DROP_COUNT = "cashDropCount";
  private static final String KEY_SERVER_SYNCED = "serverSessionSynced";
  private static final String KEY_REMOTE_CLOSED_PENDING = "remoteClosedPending";
  private static final String KEY_REMOTE_CLOSE_SOURCE = "remoteCloseSource";

  /** BO/server closed this round — not a seat kick. */
  public interface RemoteCloseListener {
    void onRemoteSessionClosed();
  }

  private static final CopyOnWriteArrayList<RemoteCloseListener> remoteCloseListeners =
      new CopyOnWriteArrayList<>();

  private ShiftPrefs() {}

  public static void addRemoteCloseListener(RemoteCloseListener listener) {
    if (listener != null && !remoteCloseListeners.contains(listener)) {
      remoteCloseListeners.add(listener);
    }
  }

  public static void removeRemoteCloseListener(RemoteCloseListener listener) {
    if (listener != null) remoteCloseListeners.remove(listener);
  }

  private static void notifyRemoteCloseListeners() {
    for (RemoteCloseListener l : remoteCloseListeners) {
      try {
        l.onRemoteSessionClosed();
      } catch (RuntimeException ignored) {
        /* one bad listener must not block others */
      }
    }
  }

  public static boolean isOpen(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_OPEN, false);
  }

  public static double openingCash(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_OPENING_CASH, 0L));
  }

  /** Seed for the next open — set at close (leave float). */
  public static double nextOpeningCash(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_NEXT_OPENING, 0L));
  }

  public static void setNextOpeningCash(Context context, double amount) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putLong(KEY_NEXT_OPENING, Double.doubleToRawLongBits(Math.max(0, amount)))
        .commit();
  }

  /** Expected drawer cash = opening float + cash sales − drops + cash-in. */
  public static double expectedCash(Context context) {
    return openingCash(context) + cashTotal(context) - cashOutTotal(context) + cashInTotal(context);
  }

  public static double cashOutTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_CASH_OUT, 0L));
  }

  public static double cashInTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_CASH_IN, 0L));
  }

  public static int cashDropCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_CASH_DROP_COUNT, 0);
  }

  /** Mid-shift cash drop (เงินออกจากลิ้นชัก). */
  public static void recordCashDrop(Context context, double amount) {
    if (amount <= 0) return;
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    double next = cashOutTotal(context) + amount;
    prefs
        .edit()
        .putLong(KEY_CASH_OUT, Double.doubleToRawLongBits(next))
        .putInt(KEY_CASH_DROP_COUNT, cashDropCount(context) + 1)
        .commit();
  }

  /**
   * Hub / sell strip — money args as strings so Resources.getString never hits
   * IllegalFormatConversionException on %.0f (seen as process death after open shift).
   */
  public static String summaryLine(Context context) {
    return context.getString(
        R.string.shift_summary_fmt,
        saleCount(context),
        moneyPlain(cashTotal(context)),
        moneyPlain(promptpayTotal(context)),
        moneyPlain(transferTotal(context)),
        voidedCount(context));
  }

  /**
   * Live duty strip: clock-in time + elapsed H:MM:SS (updates every second from UI).
   */
  public static String dutyLine(Context context) {
    if (!isOpen(context)) {
      return context.getString(R.string.shift_duty_closed);
    }
    long opened = openedAt(context);
    if (opened <= 0L) {
      return summaryLine(context);
    }
    java.text.SimpleDateFormat clock =
        new java.text.SimpleDateFormat("HH:mm", Locale.getDefault());
    String inAt = clock.format(new java.util.Date(opened));
    long elapsedSec = Math.max(0L, (System.currentTimeMillis() - opened) / 1000L);
    long h = elapsedSec / 3600L;
    long m = (elapsedSec % 3600L) / 60L;
    long s = elapsedSec % 60L;
    String elapsed =
        h > 0
            ? String.format(Locale.getDefault(), "%d:%02d:%02d", h, m, s)
            : String.format(Locale.getDefault(), "%02d:%02d", m, s);
    return context.getString(R.string.shift_duty_fmt, inAt, elapsed) + " · " + summaryLine(context);
  }

  public static String moneyPlain(double amount) {
    return String.format(Locale.US, "%.0f", Math.max(0, amount));
  }

  public static long openedAt(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_OPENED_AT, 0L);
  }

  public static String sessionId(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SESSION, "");
  }

  public static String shift(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SHIFT, "morning");
  }

  public static double cashTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_CASH, 0L));
  }

  public static double promptpayTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_PP, 0L));
  }

  public static double transferTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_TRANSFER, 0L));
  }

  public static int saleCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_SALE_COUNT, 0);
  }

  public static int cashBillCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_CASH_BILLS, 0);
  }

  public static int promptpayBillCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_PP_BILLS, 0);
  }

  public static int transferBillCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_TRANSFER_BILLS, 0);
  }

  public static double discountTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_DISCOUNT, 0L));
  }

  public static int voidedCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_VOIDED, 0);
  }

  public static void open(Context context) {
    open(context, "", "morning", System.currentTimeMillis(), nextOpeningCash(context));
  }

  public static void open(Context context, String sessionId, String shift, long openedAt) {
    open(context, sessionId, shift, openedAt, nextOpeningCash(context));
  }

  public static void open(
      Context context, String sessionId, String shift, long openedAt, double openingCash) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    prefs
        .edit()
        .putBoolean(KEY_OPEN, true)
        .putLong(KEY_OPENED_AT, openedAt)
        .putString(KEY_SESSION, sessionId == null ? "" : sessionId)
        .putString(KEY_SHIFT, shift == null ? "morning" : shift)
        .putLong(KEY_OPENING_CASH, Double.doubleToRawLongBits(Math.max(0, openingCash)))
        .putLong(KEY_NEXT_OPENING, Double.doubleToRawLongBits(0))
        .putLong(KEY_CASH, Double.doubleToRawLongBits(0))
        .putLong(KEY_PP, Double.doubleToRawLongBits(0))
        .putLong(KEY_TRANSFER, Double.doubleToRawLongBits(0))
        .putInt(KEY_SALE_COUNT, 0)
        .putInt(KEY_CASH_BILLS, 0)
        .putInt(KEY_PP_BILLS, 0)
        .putInt(KEY_TRANSFER_BILLS, 0)
        .putLong(KEY_DISCOUNT, Double.doubleToRawLongBits(0))
        .putInt(KEY_VOIDED, 0)
        .putLong(KEY_CASH_OUT, Double.doubleToRawLongBits(0))
        .putLong(KEY_CASH_IN, Double.doubleToRawLongBits(0))
        .putInt(KEY_CASH_DROP_COUNT, 0)
        .putBoolean(KEY_LAST_RESUMED, false)
        .putBoolean(KEY_SERVER_SYNCED, false)
        .putBoolean(KEY_REMOTE_CLOSED_PENDING, false)
        .putString(KEY_REMOTE_CLOSE_SOURCE, "")
        .commit();
  }

  /**
   * Bind to an already-open server session after seat handoff (kick ≠ close).
   * Local counters seed from server totals when available.
   */
  public static void resume(
      Context context,
      String sessionId,
      String shift,
      long openedAt,
      double openingCash,
      double cashTotal,
      double promptpayTotal,
      int saleCount,
      int voidedCount,
      double discountTotal) {
    resume(
        context,
        sessionId,
        shift,
        openedAt,
        openingCash,
        cashTotal,
        promptpayTotal,
        0,
        saleCount,
        voidedCount,
        discountTotal);
  }

  public static void resume(
      Context context,
      String sessionId,
      String shift,
      long openedAt,
      double openingCash,
      double cashTotal,
      double promptpayTotal,
      double transferTotal,
      int saleCount,
      int voidedCount,
      double discountTotal) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    prefs
        .edit()
        .putBoolean(KEY_OPEN, true)
        .putLong(KEY_OPENED_AT, openedAt > 0 ? openedAt : System.currentTimeMillis())
        .putString(KEY_SESSION, sessionId == null ? "" : sessionId)
        .putString(KEY_SHIFT, shift == null ? "morning" : shift)
        .putLong(KEY_OPENING_CASH, Double.doubleToRawLongBits(Math.max(0, openingCash)))
        .putLong(KEY_NEXT_OPENING, Double.doubleToRawLongBits(0))
        .putLong(KEY_CASH, Double.doubleToRawLongBits(Math.max(0, cashTotal)))
        .putLong(KEY_PP, Double.doubleToRawLongBits(Math.max(0, promptpayTotal)))
        .putLong(KEY_TRANSFER, Double.doubleToRawLongBits(Math.max(0, transferTotal)))
        .putInt(KEY_SALE_COUNT, Math.max(0, saleCount))
        .putInt(KEY_CASH_BILLS, 0)
        .putInt(KEY_PP_BILLS, 0)
        .putInt(KEY_TRANSFER_BILLS, 0)
        .putLong(KEY_DISCOUNT, Double.doubleToRawLongBits(Math.max(0, discountTotal)))
        .putInt(KEY_VOIDED, Math.max(0, voidedCount))
        .putBoolean(KEY_LAST_RESUMED, true)
        .putBoolean(KEY_SERVER_SYNCED, true)
        .putBoolean(KEY_REMOTE_CLOSED_PENDING, false)
        .putString(KEY_REMOTE_CLOSE_SOURCE, "")
        .commit();
  }

  public static boolean consumeLastResumed(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    boolean v = prefs.getBoolean(KEY_LAST_RESUMED, false);
    if (v) prefs.edit().putBoolean(KEY_LAST_RESUMED, false).apply();
    return v;
  }

  /** True after nposSessionOpen succeeded (or resume). Retry sync while false. */
  public static boolean isServerSessionSynced(Context context) {
    return context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean(KEY_SERVER_SYNCED, false);
  }

  public static void markServerSessionSynced(Context context, boolean synced) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_SERVER_SYNCED, synced)
        .apply();
  }

  /** Drop local open flag only — does not call server close (used on kick). */
  public static void clearLocalOpen(Context context) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_OPEN, false)
        .putBoolean(KEY_SERVER_SYNCED, false)
        .putBoolean(KEY_REMOTE_CLOSED_PENDING, false)
        .putString(KEY_REMOTE_CLOSE_SOURCE, "")
        .commit();
  }

  public static boolean isRemoteClosedPending(Context context) {
    return context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean(KEY_REMOTE_CLOSED_PENDING, false);
  }

  public static String remoteCloseSource(Context context) {
    return context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_REMOTE_CLOSE_SOURCE, "");
  }

  /**
   * Heartbeat / open-retry learned server already closed this sessionId.
   * Keeps local open until UI settles (finish cart) — seat claim untouched.
   */
  public static void applyRemoteSessionClosed(
      Context context, String sessionId, String closeSource) {
    if (!isOpen(context)) return;
    String local = sessionId(context);
    if (sessionId != null
        && !sessionId.isEmpty()
        && local != null
        && !local.isEmpty()
        && !sessionId.equals(local)) {
      return;
    }
    if (isRemoteClosedPending(context)) return;
    String src = closeSource == null ? "" : closeSource.trim();
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_REMOTE_CLOSED_PENDING, true)
        .putString(KEY_REMOTE_CLOSE_SOURCE, src)
        .commit();
    OpsLogger.info(
        context.getApplicationContext(),
        "shift",
        "รอบปิดจากเซิร์ฟเวอร์",
        (local == null ? "" : local) + (src.isEmpty() ? "" : " · " + src));
    notifyRemoteCloseListeners();
  }

  /** After cart settle / hub — drop local open for a BO-closed round. */
  public static void settleRemoteClosed(Context context) {
    if (!isRemoteClosedPending(context) && !isOpen(context)) return;
    clearLocalOpen(context);
  }

  public static void addCash(Context context, double amount) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    double next = cashTotal(context) + amount;
    prefs.edit().putLong(KEY_CASH, Double.doubleToRawLongBits(next)).apply();
  }

  public static void addPromptPay(Context context, double amount) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    double next = promptpayTotal(context) + amount;
    prefs.edit().putLong(KEY_PP, Double.doubleToRawLongBits(next)).apply();
  }

  /** Record one completed local sale for Z-report. */
  public static void recordSale(
      Context context, String paymentMethod, double total, double discountBaht) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    SharedPreferences.Editor ed = prefs.edit();
    ed.putInt(KEY_SALE_COUNT, saleCount(context) + 1);
    String method = app.telltea.npos.sell.PaymentMethods.normalize(paymentMethod);
    if (app.telltea.npos.sell.PaymentMethods.CASH.equals(method)) {
      ed.putInt(KEY_CASH_BILLS, cashBillCount(context) + 1);
      ed.putLong(KEY_CASH, Double.doubleToRawLongBits(cashTotal(context) + total));
    } else if (app.telltea.npos.sell.PaymentMethods.TRANSFER.equals(method)) {
      ed.putInt(KEY_TRANSFER_BILLS, transferBillCount(context) + 1);
      ed.putLong(KEY_TRANSFER, Double.doubleToRawLongBits(transferTotal(context) + total));
    } else {
      ed.putInt(KEY_PP_BILLS, promptpayBillCount(context) + 1);
      ed.putLong(KEY_PP, Double.doubleToRawLongBits(promptpayTotal(context) + total));
    }
    if (discountBaht > 0) {
      ed.putLong(
          KEY_DISCOUNT, Double.doubleToRawLongBits(discountTotal(context) + discountBaht));
    }
    ed.apply();
  }

  /** Reverse a voided sale from shift counters (local void parity with web tablet). */
  public static void unrecordSale(
      Context context, String paymentMethod, double total, double discountBaht) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    SharedPreferences.Editor ed = prefs.edit();
    ed.putInt(KEY_SALE_COUNT, Math.max(0, saleCount(context) - 1));
    ed.putInt(KEY_VOIDED, voidedCount(context) + 1);
    String method = app.telltea.npos.sell.PaymentMethods.normalize(paymentMethod);
    if (app.telltea.npos.sell.PaymentMethods.CASH.equals(method)) {
      ed.putInt(KEY_CASH_BILLS, Math.max(0, cashBillCount(context) - 1));
      ed.putLong(KEY_CASH, Double.doubleToRawLongBits(Math.max(0, cashTotal(context) - total)));
    } else if (app.telltea.npos.sell.PaymentMethods.TRANSFER.equals(method)) {
      ed.putInt(KEY_TRANSFER_BILLS, Math.max(0, transferBillCount(context) - 1));
      ed.putLong(
          KEY_TRANSFER, Double.doubleToRawLongBits(Math.max(0, transferTotal(context) - total)));
    } else {
      ed.putInt(KEY_PP_BILLS, Math.max(0, promptpayBillCount(context) - 1));
      ed.putLong(KEY_PP, Double.doubleToRawLongBits(Math.max(0, promptpayTotal(context) - total)));
    }
    if (discountBaht > 0) {
      ed.putLong(
          KEY_DISCOUNT,
          Double.doubleToRawLongBits(Math.max(0, discountTotal(context) - discountBaht)));
    }
    ed.apply();
  }

  public static void close(Context context) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_OPEN, false)
        .putBoolean(KEY_SERVER_SYNCED, false)
        .putBoolean(KEY_REMOTE_CLOSED_PENDING, false)
        .putString(KEY_REMOTE_CLOSE_SOURCE, "")
        .commit();
  }
}
