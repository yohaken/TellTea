package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Local-first bestseller qty counters (native). Cloud rank is source of truth online. */
public final class BestsellerPrefs {
  private static final String PREFS = "npos_bestsellers";
  private static final String KEY_DAYS = "days";
  private static final String KEY_CAT = "categoryByItem";
  private static final long DAY_MS = 86_400_000L;
  private static final int KEEP_DAYS = 14;

  private BestsellerPrefs() {}

  public static void recordLines(Context context, JSONArray lines) {
    applyDelta(context, lines, 1);
  }

  public static void reverseLines(Context context, JSONArray lines) {
    applyDelta(context, lines, -1);
  }

  private static void applyDelta(Context context, JSONArray lines, int sign) {
    if (context == null || lines == null || lines.length() == 0) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      JSONObject days = new JSONObject(prefs.getString(KEY_DAYS, "{}"));
      JSONObject cats = new JSONObject(prefs.getString(KEY_CAT, "{}"));
      String day = dayKey(System.currentTimeMillis());
      JSONObject bucket = days.optJSONObject(day);
      if (bucket == null) bucket = new JSONObject();
      for (int i = 0; i < lines.length(); i++) {
        JSONObject line = lines.optJSONObject(i);
        if (line == null) continue;
        String id = line.optString("menuItemId", "").trim();
        if (id.isEmpty()) continue;
        int qty = Math.max(0, line.optInt("qty", 0));
        if (qty <= 0) {
          double q = line.optDouble("qty", 0);
          qty = (int) Math.max(0, Math.round(q));
        }
        if (qty <= 0) continue;
        int next = Math.max(0, bucket.optInt(id, 0) + sign * qty);
        if (next == 0) bucket.remove(id);
        else bucket.put(id, next);
        String cat = line.optString("categoryId", "").trim();
        if (!cat.isEmpty()) cats.put(id, cat);
      }
      days.put(day, bucket);
      prune(days);
      prefs.edit().putString(KEY_DAYS, days.toString()).putString(KEY_CAT, cats.toString()).apply();
    } catch (Exception ignored) {
      /* keep last */
    }
  }

  private static void prune(JSONObject days) {
    long cutoff = System.currentTimeMillis() - KEEP_DAYS * DAY_MS;
    JSONArray names = days.names();
    if (names == null) return;
    for (int i = 0; i < names.length(); i++) {
      String k = names.optString(i);
      if (k == null || k.length() < 8) continue;
      try {
        // yyyy-mm-dd
        String[] p = k.split("-");
        if (p.length != 3) continue;
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.clear();
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 12, 0);
        if (c.getTimeInMillis() < cutoff) days.remove(k);
      } catch (Exception ignored) {
        /* keep */
      }
    }
  }

  private static String dayKey(long ms) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ms);
    return String.format(
        java.util.Locale.US,
        "%04d-%02d-%02d",
        c.get(java.util.Calendar.YEAR),
        c.get(java.util.Calendar.MONTH) + 1,
        c.get(java.util.Calendar.DAY_OF_MONTH));
  }
}
