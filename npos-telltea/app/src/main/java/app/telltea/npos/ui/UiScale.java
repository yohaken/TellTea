package app.telltea.npos.ui;

import android.content.Context;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;

/**
 * Smart touch-first UI scale for nPos (tablet / landscape POS).
 *
 * <p>Same idea as web rem + {@code CustomerDisplayMetrics}: measure the shortest edge, clamp a
 * scale factor, then derive nav width, type sizes, and touch targets — no hand-tuned px per device.
 *
 * <p>Reference short-edge: 720px (common 1280×800 / 1080×1920). Touch targets stay ≥48dp.
 */
public final class UiScale {
  /** Short-edge reference (px). */
  private static final float REF_SHORT_PX = 720f;

  public final float density;
  /** 0.82–1.40 relative to 720 short-edge. */
  public final float scale;
  public final int widthPx;
  public final int heightPx;
  public final boolean landscape;

  public final int navWidthPx;
  public final float brandSp;
  public final float navSp;
  public final float titleSp;
  public final float bodySp;
  public final float captionSp;
  public final float priceSp;
  public final int touchMinPx;
  public final int payPrimaryMinPx;
  public final int paySecondaryMinPx;
  public final int menuMediaMaxPx;
  public final int menuCols;
  public final int gapPx;
  public final int cornerPx;

  private UiScale(
      float density,
      float scale,
      int widthPx,
      int heightPx,
      boolean landscape,
      int navWidthPx,
      float brandSp,
      float navSp,
      float titleSp,
      float bodySp,
      float captionSp,
      float priceSp,
      int touchMinPx,
      int payPrimaryMinPx,
      int paySecondaryMinPx,
      int menuMediaMaxPx,
      int menuCols,
      int gapPx,
      int cornerPx) {
    this.density = density;
    this.scale = scale;
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.landscape = landscape;
    this.navWidthPx = navWidthPx;
    this.brandSp = brandSp;
    this.navSp = navSp;
    this.titleSp = titleSp;
    this.bodySp = bodySp;
    this.captionSp = captionSp;
    this.priceSp = priceSp;
    this.touchMinPx = touchMinPx;
    this.payPrimaryMinPx = payPrimaryMinPx;
    this.paySecondaryMinPx = paySecondaryMinPx;
    this.menuMediaMaxPx = menuMediaMaxPx;
    this.menuCols = menuCols;
    this.gapPx = gapPx;
    this.cornerPx = cornerPx;
  }

  public static UiScale from(Context context) {
    DisplayMetrics dm = context.getResources().getDisplayMetrics();
    int w = Math.max(1, dm.widthPixels);
    int h = Math.max(1, dm.heightPixels);
    boolean landscape = w >= h;
    int shortEdge = Math.min(w, h);
    float density = dm.density <= 0 ? 1f : dm.density;
    float scale = clamp(shortEdge / REF_SHORT_PX, 0.82f, 1.40f);

    // Web --pos-nav-w: 11rem ≈ 176dp @ 16px rem; scale with short-edge.
    int navWidthPx = clampInt(Math.round(176f * density * (0.92f + 0.08f * scale)), dp(density, 148), dp(density, 220));

    float brandSp = sp(14f * scale);
    float navSp = sp(12.5f * scale);
    float titleSp = sp(15.5f * scale);
    float bodySp = sp(13.5f * scale);
    float captionSp = sp(12.5f * scale);
    float priceSp = sp(12f * scale);

    int touchMinPx = Math.max(dp(density, 48), Math.round(52 * density * scale));
    // Web pay primary ~3.25–3.6rem tall; keep cash CTA dominant.
    int payPrimaryMinPx = Math.max(dp(density, 56), Math.round(64 * density * scale));
    int paySecondaryMinPx = Math.max(dp(density, 48), Math.round(52 * density * scale));
    // Web media max-height ~5.5rem — shrink tiles so ~5 rows fit, scroll vertically.
    int menuMediaMaxPx = Math.max(dp(density, 48), Math.round(5.2f * 16f * density * scale));

    int contentW = Math.max(1, w - navWidthPx);
    int menuCols = contentW > dp(density, 900) ? 5 : contentW > dp(density, 640) ? 4 : 3;

    int gapPx = Math.max(dp(density, 3), Math.round(4 * density * scale));
    int cornerPx = Math.max(dp(density, 8), Math.round(10 * density * scale));

    return new UiScale(
        density,
        scale,
        w,
        h,
        landscape,
        navWidthPx,
        brandSp,
        navSp,
        titleSp,
        bodySp,
        captionSp,
        priceSp,
        touchMinPx,
        payPrimaryMinPx,
        paySecondaryMinPx,
        menuMediaMaxPx,
        menuCols,
        gapPx,
        cornerPx);
  }

  public int dp(float v) {
    return Math.round(v * density);
  }

  public void applyMinHeight(View view, int minPx) {
    if (view == null) return;
    view.setMinimumHeight(minPx);
  }

  public void applyWidth(View view, int widthPx) {
    if (view == null) return;
    ViewGroup.LayoutParams lp = view.getLayoutParams();
    if (lp == null) return;
    lp.width = widthPx;
    view.setLayoutParams(lp);
  }

  public static float sp(float v) {
    return v;
  }

  private static int dp(float density, float v) {
    return Math.round(v * density);
  }

  private static float clamp(float v, float lo, float hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  private static int clampInt(int v, int lo, int hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** Convert sp to px for Paint / programmatic TextView. */
  public float spToPx(float sp) {
    return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, densityMetrics());
  }

  private DisplayMetrics densityMetrics() {
    DisplayMetrics dm = new DisplayMetrics();
    dm.density = density;
    dm.scaledDensity = density;
    return dm;
  }
}
