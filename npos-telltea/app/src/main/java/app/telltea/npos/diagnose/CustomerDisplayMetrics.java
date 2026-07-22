package app.telltea.npos.diagnose;

import android.util.DisplayMetrics;
import android.view.Display;

/**
 * Smart scale for customer Presentation across portrait emu and landscape shop panels.
 *
 * <p>Policy: measure secondary display → pick orientation → pane split → type/QR scale from
 * shortest edge (not primary tablet density).
 */
public final class CustomerDisplayMetrics {
    public final int widthPx;
    public final int heightPx;
    public final boolean landscape;
    /** 0.65 media / 0.35 receipt in landscape; portrait stacks media 0.58 / receipt 0.42. */
    public final float mediaWeight;
    public final float receiptWeight;
    /** sp multiplier relative to a 720-short-edge reference. */
    public final float scale;
    public final int qrEdgePx;
    public final int padDp;
    public final float titleSp;
    public final float bodySp;
    public final float totalSp;
    public final float brandSp;

    private CustomerDisplayMetrics(
            int widthPx,
            int heightPx,
            boolean landscape,
            float mediaWeight,
            float receiptWeight,
            float scale,
            int qrEdgePx,
            int padDp,
            float titleSp,
            float bodySp,
            float totalSp,
            float brandSp) {
        this.widthPx = widthPx;
        this.heightPx = heightPx;
        this.landscape = landscape;
        this.mediaWeight = mediaWeight;
        this.receiptWeight = receiptWeight;
        this.scale = scale;
        this.qrEdgePx = qrEdgePx;
        this.padDp = padDp;
        this.titleSp = titleSp;
        this.bodySp = bodySp;
        this.totalSp = totalSp;
        this.brandSp = brandSp;
    }

    public static CustomerDisplayMetrics from(Display display) {
        DisplayMetrics dm = new DisplayMetrics();
        try {
            display.getRealMetrics(dm);
        } catch (Exception e) {
            display.getMetrics(dm);
        }
        int w = Math.max(1, dm.widthPixels);
        int h = Math.max(1, dm.heightPixels);
        boolean landscape = w >= h;
        int shortEdge = Math.min(w, h);
        int longEdge = Math.max(w, h);
        // Reference: 720px short edge (common 1080×1920 portrait / 1280×800 landscape short).
        float scale = clamp(shortEdge / 720f, 0.72f, 1.55f);

        float mediaWeight;
        float receiptWeight;
        if (landscape) {
            // Spec: main 60–70% / side 30–40%. Prefer 65/35; ultra-wide → 70/30.
            float aspect = longEdge / (float) shortEdge;
            if (aspect >= 1.9f) {
                mediaWeight = 0.70f;
                receiptWeight = 0.30f;
            } else {
                mediaWeight = 0.65f;
                receiptWeight = 0.35f;
            }
        } else {
            // Portrait (emu): stack — media on top, receipt below (still readable).
            mediaWeight = 0.58f;
            receiptWeight = 0.42f;
        }

        int mediaShort = landscape ? shortEdge : Math.round(h * mediaWeight);
        int mediaLong = landscape ? Math.round(w * mediaWeight) : w;
        int qrCap = Math.min(mediaShort, mediaLong);
        int qrEdge = Math.round(qrCap * (landscape ? 0.62f : 0.55f));
        qrEdge = clampInt(qrEdge, 160, 520);

        int padDp = Math.round(clamp(12f * scale, 10f, 22f));
        return new CustomerDisplayMetrics(
                w,
                h,
                landscape,
                mediaWeight,
                receiptWeight,
                scale,
                qrEdge,
                padDp,
                20f * scale,
                15f * scale,
                34f * scale,
                26f * scale);
    }

    public String debugLabel() {
        return widthPx
                + "x"
                + heightPx
                + (landscape ? " landscape" : " portrait")
                + " · media="
                + Math.round(mediaWeight * 100)
                + "%"
                + " · scale="
                + String.format(java.util.Locale.US, "%.2f", scale);
    }

    private static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }

    private static int clampInt(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
