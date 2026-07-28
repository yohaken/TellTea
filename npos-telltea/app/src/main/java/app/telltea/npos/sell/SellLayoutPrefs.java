package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * User-draggable sell pane X weights (category / menu / cart).
 *
 * <p>Defaults match XML 14 / 51 / 35. Each side (category, cart) may expand to at most 35% so the
 * menu pane is not crushed. Menu always keeps at least {@link #MENU_MIN}.
 */
public final class SellLayoutPrefs {
  public static final float CAT_DEFAULT = 14f;
  public static final float MENU_DEFAULT = 51f;
  public static final float CART_DEFAULT = 35f;

  /** Max share for category or cart (user request ≈35%). */
  public static final float SIDE_MAX = 35f;
  public static final float CAT_MIN = 10f;
  public static final float CART_MIN = 22f;
  public static final float MENU_MIN = 30f;

  private static final String PREFS = "npos_sell_layout";
  private static final String KEY_CAT = "w_cat";
  private static final String KEY_MENU = "w_menu";
  private static final String KEY_CART = "w_cart";

  public static final class Weights {
    public final float cat;
    public final float menu;
    public final float cart;

    public Weights(float cat, float menu, float cart) {
      this.cat = cat;
      this.menu = menu;
      this.cart = cart;
    }
  }

  private SellLayoutPrefs() {}

  public static Weights load(Context context) {
    if (context == null) {
      return new Weights(CAT_DEFAULT, MENU_DEFAULT, CART_DEFAULT);
    }
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    float cat = prefs.getFloat(KEY_CAT, CAT_DEFAULT);
    float menu = prefs.getFloat(KEY_MENU, MENU_DEFAULT);
    float cart = prefs.getFloat(KEY_CART, CART_DEFAULT);
    return clamp(cat, menu, cart);
  }

  public static void save(Context context, float cat, float menu, float cart) {
    if (context == null) return;
    Weights w = clamp(cat, menu, cart);
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putFloat(KEY_CAT, w.cat)
        .putFloat(KEY_MENU, w.menu)
        .putFloat(KEY_CART, w.cart)
        .apply();
  }

  /** Drag category↔menu: change cat, keep cart fixed. */
  public static Weights adjustCat(float cat, float cart) {
    float c = clamp(cat, CAT_MIN, SIDE_MAX);
    float k = clamp(cart, CART_MIN, SIDE_MAX);
    float menu = 100f - c - k;
    if (menu < MENU_MIN) {
      float overflow = MENU_MIN - menu;
      c = Math.max(CAT_MIN, c - overflow);
      menu = 100f - c - k;
    }
    return clamp(c, menu, k);
  }

  /** Drag menu↔cart: change cart, keep cat fixed. */
  public static Weights adjustCart(float cat, float cart) {
    float c = clamp(cat, CAT_MIN, SIDE_MAX);
    float k = clamp(cart, CART_MIN, SIDE_MAX);
    float menu = 100f - c - k;
    if (menu < MENU_MIN) {
      float overflow = MENU_MIN - menu;
      k = Math.max(CART_MIN, k - overflow);
      menu = 100f - c - k;
    }
    return clamp(c, menu, k);
  }

  public static Weights clamp(float cat, float menu, float cart) {
    float c = clamp(cat, CAT_MIN, SIDE_MAX);
    float k = clamp(cart, CART_MIN, SIDE_MAX);
    float m = clamp(menu, MENU_MIN, 100f - CAT_MIN - CART_MIN);
    float sum = c + m + k;
    if (sum <= 0.01f) {
      return new Weights(CAT_DEFAULT, MENU_DEFAULT, CART_DEFAULT);
    }
    // Renormalize to 100 while re-applying mins/maxes once.
    c = clamp(c * 100f / sum, CAT_MIN, SIDE_MAX);
    k = clamp(k * 100f / sum, CART_MIN, SIDE_MAX);
    m = Math.max(MENU_MIN, 100f - c - k);
    if (c + k + m > 100.01f) {
      m = Math.max(MENU_MIN, 100f - c - k);
    }
    return new Weights(c, m, k);
  }

  private static float clamp(float v, float lo, float hi) {
    return Math.max(lo, Math.min(hi, v));
  }
}
