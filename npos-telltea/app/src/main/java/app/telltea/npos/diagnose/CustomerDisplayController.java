package app.telltea.npos.diagnose;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.List;

import app.telltea.npos.R;
import app.telltea.npos.sell.MenuModels;

/**
 * Secondary-display controller: two-pane layout + auto-resize metrics.
 * Idle media slideshow continues during Ordering (upsell); QR overlays media on Payment.
 */
public final class CustomerDisplayController {
    public static final long SUCCESS_HOLD_MS = 3500L;
    private static final long PROMO_ROTATE_MS = 4500L;

    public static final class PromoItem {
        public final String name;
        public final String imageUrl;

        public PromoItem(String name, String imageUrl) {
            this.name = name == null ? "" : name;
            this.imageUrl = imageUrl == null ? "" : imageUrl;
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private CustomerDisplayPresentation presentation;
    private Activity host;
    private String shopName = "TellTea";
    private String footerNote = "";
    private final List<PromoItem> promos = new ArrayList<>();
    private int promoIndex;
    private Runnable rotateTask;
    private Runnable successTask;
    private boolean loggedReady;

    private List<CustomerDisplayPresentation.Line> lastLines = new ArrayList<>();
    private double lastSubtotal;
    private double lastDiscount;
    private double lastTotal;

    public void bind(Activity activity) {
        host = activity;
    }

    public void setShop(String name, String receiptFooterNote) {
        if (name != null && !name.trim().isEmpty()) shopName = name.trim();
        footerNote = receiptFooterNote == null ? "" : receiptFooterNote.trim();
    }

    public void setRecommended(List<MenuModels.Item> items) {
        promos.clear();
        if (items != null) {
            for (MenuModels.Item it : items) {
                if (it == null || !it.recommended || !it.active) continue;
                promos.add(new PromoItem(it.name, it.imageUrl));
            }
            // Fallback: top active items if none marked recommended.
            if (promos.isEmpty()) {
                int n = 0;
                for (MenuModels.Item it : items) {
                    if (it == null || !it.active) continue;
                    promos.add(new PromoItem(it.name, it.imageUrl));
                    if (++n >= 6) break;
                }
            }
        }
        promoIndex = 0;
    }

    public String statusLabel(Activity activity) {
        String st = DisplayProbe.customerDisplayStatus(activity);
        if ("ok".equals(st)) {
            return activity.getString(R.string.customer_status_ok);
        }
        return activity.getString(R.string.customer_status_missing);
    }

    public boolean hasSecondary(Activity activity) {
        return DisplayProbe.secondaryOrNull(activity) != null;
    }

    public void showStandby() {
        cancelSuccess();
        if (!ensurePresentation()) return;
        applyIdleOrPromoFrame(true);
        startRotate();
    }

    public void showSelecting(
            List<CustomerDisplayPresentation.Line> lines,
            double subtotal,
            double discount,
            double total) {
        cancelSuccess();
        if (!ensurePresentation()) return;
        rememberCart(lines, subtotal, discount, total);
        presentation.showSelecting(lastLines, lastSubtotal, lastDiscount, lastTotal);
        // Keep upsell media rotating while ordering.
        applyIdleOrPromoFrame(false);
        startRotate();
    }

    public void showPaymentCash(double total, double received, double change, boolean enough) {
        cancelSuccess();
        stopRotate();
        if (!ensurePresentation()) return;
        lastTotal = total;
        presentation.showPaymentCash(
                lastLines, lastSubtotal, lastDiscount, lastTotal, received, change, enough);
    }

    public void showPaymentQr(double total, Bitmap qr) {
        cancelSuccess();
        stopRotate();
        if (!ensurePresentation()) return;
        lastTotal = total;
        presentation.showPaymentQr(lastLines, lastSubtotal, lastDiscount, lastTotal, qr);
    }

    public void showSuccessThenStandby(String message, double total, double change) {
        stopRotate();
        cancelSuccess();
        if (!ensurePresentation()) return;
        presentation.showSuccess(message, total, change);
        successTask =
                () -> {
                    successTask = null;
                    showStandby();
                };
        main.postDelayed(successTask, SUCCESS_HOLD_MS);
    }

    public void release() {
        cancelSuccess();
        stopRotate();
        if (presentation != null) {
            try {
                presentation.dismiss();
            } catch (Exception ignored) {
                /* ignore */
            }
            presentation = null;
        }
        host = null;
    }

    private void rememberCart(
            List<CustomerDisplayPresentation.Line> lines,
            double subtotal,
            double discount,
            double total) {
        lastLines = lines == null ? new ArrayList<>() : new ArrayList<>(lines);
        lastSubtotal = subtotal;
        lastDiscount = discount;
        lastTotal = total;
    }

    private boolean ensurePresentation() {
        Activity activity = host;
        if (activity == null || activity.isFinishing()) return false;
        DisplayProbe.DisplayInfo secondary = DisplayProbe.secondaryOrNull(activity);
        if (secondary == null) return false;
        try {
            if (presentation == null || !presentation.isShowing()) {
                presentation = new CustomerDisplayPresentation(activity, secondary.display);
                presentation.show();
                if (!loggedReady) {
                    loggedReady = true;
                    CustomerDisplayMetrics m = presentation.getMetrics();
                    OpsLogger.info(
                            activity,
                            "display",
                            "จอลูกค้าพร้อม",
                            (m != null ? m.debugLabel() : secondary.sizeLabel())
                                    + " · จอ "
                                    + secondary.number);
                }
            }
            return true;
        } catch (Exception e) {
            OpsLogger.warn(
                    activity,
                    "display",
                    "อัปเดตจอลูกค้าไม่สำเร็จ",
                    e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            presentation = null;
            return false;
        }
    }

    private void applyIdleOrPromoFrame(boolean fullIdle) {
        if (presentation == null) return;
        String promoText;
        String imageUrl = "";
        if (promos.isEmpty()) {
            promoText =
                    host != null
                            ? host.getString(R.string.customer_standby_promo_fallback)
                            : "";
        } else {
            if (promoIndex < 0 || promoIndex >= promos.size()) promoIndex = 0;
            PromoItem p = promos.get(promoIndex);
            promoText = p.name;
            imageUrl = p.imageUrl;
        }
        String tagline =
                host != null ? host.getString(R.string.customer_standby_welcome) : "";
        if (fullIdle) {
            presentation.showStandby(shopName, tagline, promoText, imageUrl, footerNote);
        } else {
            presentation.updatePromo(promoText, imageUrl);
        }
    }

    private void startRotate() {
        stopRotate();
        if (promos.size() <= 1) return;
        rotateTask =
                new Runnable() {
                    @Override
                    public void run() {
                        if (presentation == null) return;
                        CustomerDisplayPresentation.Mode m = presentation.getMode();
                        if (m != CustomerDisplayPresentation.Mode.STANDBY
                                && m != CustomerDisplayPresentation.Mode.SELECTING) {
                            return;
                        }
                        promoIndex = (promoIndex + 1) % promos.size();
                        applyIdleOrPromoFrame(m == CustomerDisplayPresentation.Mode.STANDBY);
                        main.postDelayed(this, PROMO_ROTATE_MS);
                    }
                };
        main.postDelayed(rotateTask, PROMO_ROTATE_MS);
    }

    private void stopRotate() {
        if (rotateTask != null) {
            main.removeCallbacks(rotateTask);
            rotateTask = null;
        }
    }

    private void cancelSuccess() {
        if (successTask != null) {
            main.removeCallbacks(successTask);
            successTask = null;
        }
    }
}
