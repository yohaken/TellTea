package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Local hold-bill («ส่งค้างไว้») — web UI is still stub; nPos ships working local hold. */
public final class HoldCart {
  private static final String PREFS = "npos_hold";
  private static final String KEY_CART = "cartJson";
  private static final String KEY_DISC = "discountBaht";
  private static final String KEY_AT = "heldAt";
  private static final String KEY_MEMBER_ID = "memberId";
  private static final String KEY_MEMBER_PHONE = "memberPhone";
  private static final String KEY_MEMBER_PHONE_DISPLAY = "memberPhoneDisplay";
  private static final String KEY_MEMBER_NAME = "memberName";

  private HoldCart() {}

  public static boolean hasHold(Context context) {
    String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CART, null);
    return raw != null && !raw.isEmpty() && !"[]".equals(raw);
  }

  public static void save(Context context, List<MenuModels.CartLine> cart, double discountBaht)
      throws Exception {
    save(context, cart, discountBaht, "", "", "", "");
  }

  /**
   * Persist cart + manual discount + member identity. Selected redeem points are NOT held —
   * staff re-selects after restore (points may change while on hold).
   */
  public static void save(
      Context context,
      List<MenuModels.CartLine> cart,
      double discountBaht,
      String memberId,
      String memberPhone,
      String memberPhoneDisplay,
      String memberName)
      throws Exception {
    JSONArray arr = new JSONArray();
    for (MenuModels.CartLine line : cart) {
      JSONObject o = new JSONObject();
      o.put("menuItemId", line.menuItemId);
      o.put("name", line.name);
      o.put("unitPrice", line.unitPrice);
      o.put("qty", line.qty);
      o.put("options", line.optionsJson == null ? new JSONArray() : line.optionsJson);
      arr.put(o);
    }
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_CART, arr.toString())
        .putLong(KEY_DISC, Double.doubleToRawLongBits(discountBaht))
        .putLong(KEY_AT, System.currentTimeMillis())
        .putString(KEY_MEMBER_ID, memberId == null ? "" : memberId)
        .putString(KEY_MEMBER_PHONE, memberPhone == null ? "" : memberPhone)
        .putString(KEY_MEMBER_PHONE_DISPLAY, memberPhoneDisplay == null ? "" : memberPhoneDisplay)
        .putString(KEY_MEMBER_NAME, memberName == null ? "" : memberName)
        .apply();
  }

  public static Held restore(Context context) throws Exception {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String raw = prefs.getString(KEY_CART, null);
    if (raw == null || raw.isEmpty()) return null;
    JSONArray arr = new JSONArray(raw);
    List<MenuModels.CartLine> lines = new ArrayList<>();
    for (int i = 0; i < arr.length(); i++) {
      JSONObject o = arr.getJSONObject(i);
      lines.add(
          new MenuModels.CartLine(
              o.optString("menuItemId"),
              o.optString("name"),
              o.optDouble("unitPrice", 0),
              o.optInt("qty", 1),
              o.optJSONArray("options")));
    }
    double disc = Double.longBitsToDouble(prefs.getLong(KEY_DISC, 0L));
    Held held =
        new Held(
            lines,
            disc,
            prefs.getString(KEY_MEMBER_ID, ""),
            prefs.getString(KEY_MEMBER_PHONE, ""),
            prefs.getString(KEY_MEMBER_PHONE_DISPLAY, ""),
            prefs.getString(KEY_MEMBER_NAME, ""));
    clear(context);
    return held;
  }

  public static void clear(Context context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
  }

  public static final class Held {
    public final List<MenuModels.CartLine> lines;
    public final double discountBaht;
    public final String memberId;
    public final String memberPhone;
    public final String memberPhoneDisplay;
    public final String memberName;

    public Held(List<MenuModels.CartLine> lines, double discountBaht) {
      this(lines, discountBaht, "", "", "", "");
    }

    public Held(
        List<MenuModels.CartLine> lines,
        double discountBaht,
        String memberId,
        String memberPhone,
        String memberPhoneDisplay,
        String memberName) {
      this.lines = lines;
      this.discountBaht = discountBaht;
      this.memberId = memberId == null ? "" : memberId;
      this.memberPhone = memberPhone == null ? "" : memberPhone;
      this.memberPhoneDisplay = memberPhoneDisplay == null ? "" : memberPhoneDisplay;
      this.memberName = memberName == null ? "" : memberName;
    }

    public boolean hasMember() {
      return memberId != null && !memberId.isEmpty();
    }
  }
}
