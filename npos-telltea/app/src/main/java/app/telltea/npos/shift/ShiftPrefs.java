package app.telltea.npos.shift;

import android.content.Context;
import android.content.SharedPreferences;

/** Local shift/session state for nPos sell. */
public final class ShiftPrefs {
  private static final String PREFS = "npos_shift";
  private static final String KEY_OPEN = "open";
  private static final String KEY_OPENED_AT = "openedAt";
  private static final String KEY_SESSION = "sessionId";
  private static final String KEY_SHIFT = "shift";
  private static final String KEY_CASH = "cashTotal";
  private static final String KEY_PP = "promptpayTotal";
  private static final String KEY_SALE_COUNT = "saleCount";
  private static final String KEY_CASH_BILLS = "cashBills";
  private static final String KEY_PP_BILLS = "ppBills";
  private static final String KEY_DISCOUNT = "discountTotal";
  private static final String KEY_VOIDED = "voidedCount";
  private static final String KEY_OPENING_CASH = "openingCash";
  private static final String KEY_NEXT_OPENING = "nextOpeningCash";

  private ShiftPrefs() {}

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
        .apply();
  }

  /** Expected drawer cash = opening float + cash sales this shift. */
  public static double expectedCash(Context context) {
    return openingCash(context) + cashTotal(context);
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

  public static int saleCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_SALE_COUNT, 0);
  }

  public static int cashBillCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_CASH_BILLS, 0);
  }

  public static int promptpayBillCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_PP_BILLS, 0);
  }

  public static double discountTotal(Context context) {
    return Double.longBitsToDouble(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_DISCOUNT, 0L));
  }

  public static int voidedCount(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_VOIDED, 0);
  }

  public static void open(Context context) {
    open(context, "", "morning", System.currentTimeMillis());
  }

  public static void open(Context context, String sessionId, String shift, long openedAt) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    double opening = nextOpeningCash(context);
    prefs
        .edit()
        .putBoolean(KEY_OPEN, true)
        .putLong(KEY_OPENED_AT, openedAt)
        .putString(KEY_SESSION, sessionId == null ? "" : sessionId)
        .putString(KEY_SHIFT, shift == null ? "morning" : shift)
        .putLong(KEY_OPENING_CASH, Double.doubleToRawLongBits(opening))
        .putLong(KEY_NEXT_OPENING, Double.doubleToRawLongBits(0))
        .putLong(KEY_CASH, Double.doubleToRawLongBits(0))
        .putLong(KEY_PP, Double.doubleToRawLongBits(0))
        .putInt(KEY_SALE_COUNT, 0)
        .putInt(KEY_CASH_BILLS, 0)
        .putInt(KEY_PP_BILLS, 0)
        .putLong(KEY_DISCOUNT, Double.doubleToRawLongBits(0))
        .putInt(KEY_VOIDED, 0)
        .apply();
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
    if ("cash".equals(paymentMethod)) {
      ed.putInt(KEY_CASH_BILLS, cashBillCount(context) + 1);
      ed.putLong(KEY_CASH, Double.doubleToRawLongBits(cashTotal(context) + total));
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
    if ("cash".equals(paymentMethod)) {
      ed.putInt(KEY_CASH_BILLS, Math.max(0, cashBillCount(context) - 1));
      ed.putLong(KEY_CASH, Double.doubleToRawLongBits(Math.max(0, cashTotal(context) - total)));
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
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_OPEN, false).apply();
  }
}
