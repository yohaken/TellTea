package app.telltea.npos.shift;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Local closed-session summaries for native "ประวัติรอบขาย" (newest first, capped).
 */
public final class SessionHistory {
  private static final String PREFS = "npos_session_history";
  private static final String KEY = "closed";
  private static final int MAX = 40;

  private SessionHistory() {}

  public static void rememberClose(
      Context context, BlindCloseReport report, String staffName, String deviceId) {
    if (context == null) return;
    try {
      JSONObject row = new JSONObject();
      long closedAt = System.currentTimeMillis();
      long openedAt = ShiftPrefs.openedAt(context);
      row.put("sessionId", ShiftPrefs.sessionId(context));
      row.put("openedAt", openedAt);
      row.put("closedAt", closedAt);
      row.put("staffName", staffName == null ? "" : staffName);
      row.put("deviceId", deviceId == null ? "" : deviceId);
      row.put("openingCash", ShiftPrefs.openingCash(context));
      row.put("cashSales", ShiftPrefs.cashTotal(context));
      row.put("transferSales", ShiftPrefs.transferTotal(context));
      row.put("promptpaySales", ShiftPrefs.promptpayTotal(context));
      row.put("saleCount", ShiftPrefs.saleCount(context));
      row.put("discountTotal", ShiftPrefs.discountTotal(context));
      row.put("voidedCount", ShiftPrefs.voidedCount(context));
      if (report != null) {
        row.put("countedCash", report.countedCash);
        row.put("expectedCash", report.expectedCash);
        row.put("cashDifference", report.cashDifference);
        row.put("discrepancyLabel", report.discrepancyLabel());
        row.put("leaveFloat", report.leaveFloat);
      } else {
        row.put("expectedCash", ShiftPrefs.expectedCash(context));
        row.put("countedCash", 0);
        row.put("cashDifference", 0);
        row.put("discrepancyLabel", "—");
        row.put("leaveFloat", ShiftPrefs.nextOpeningCash(context));
      }
      JSONArray next = new JSONArray();
      next.put(row);
      JSONArray prev = loadRaw(context);
      for (int i = 0; i < prev.length() && next.length() < MAX; i++) {
        next.put(prev.getJSONObject(i));
      }
      prefs(context).edit().putString(KEY, next.toString()).apply();
    } catch (Exception ignored) {
      /* keep sell flow unblocked */
    }
  }

  public static List<JSONObject> listNewestFirst(Context context) {
    List<JSONObject> out = new ArrayList<>();
    JSONArray raw = loadRaw(context);
    for (int i = 0; i < raw.length(); i++) {
      JSONObject row = raw.optJSONObject(i);
      if (row != null) out.add(row);
    }
    return out;
  }

  private static JSONArray loadRaw(Context context) {
    try {
      String s = prefs(context).getString(KEY, "[]");
      return new JSONArray(s == null || s.isEmpty() ? "[]" : s);
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }
}
