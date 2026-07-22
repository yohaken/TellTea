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
 * Owns secondary-display Presentation for sell: standby / cart / pay / success.
 * Keeps one Presentation and updates panels (smooth realtime).
 */
public final class CustomerDisplayController {
    public static final long SUCCESS_HOLD_MS = 3500L;
    private static final long STANDBY_ROTATE_MS = 4500L;

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
        stopRotate();
        applyStandbyFrame();
        startRotate();
    }

    public void showSelecting(List<CustomerDisplayPresentation.Line> lines, double discount, double total) {
        cancelSuccess();
        stopRotate();
        if (!ensurePresentation()) return;
        presentation.showSelecting(lines, discount, total);
    }

    public void showPaymentCash(double total, double received, double change, boolean enough) {
        cancelSuccess();
        stopRotate();
        if (!ensurePresentation()) return;
        presentation.showPaymentCash(total, received, change, enough);
    }

    public void showPaymentQr(double total, Bitmap qr) {
        cancelSuccess();
        stopRotate();
        if (!ensurePresentation()) return;
        presentation.showPaymentQr(total, qr);
    }

    public void showSuccessThenStandby(String message, double total) {
        stopRotate();
        cancelSuccess();
        if (!ensurePresentation()) return;
        presentation.showSuccess(message, total);
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
                    OpsLogger.info(
                            activity,
                            "display",
                            "จอลูกค้าพร้อม",
                            secondary.sizeLabel()
                                    + " · "
                                    + secondary.orientation
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

    private void applyStandbyFrame() {
        if (presentation == null) return;
        String promoText;
        String imageUrl = "";
        if (promos.isEmpty()) {
            promoText = host != null
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
        presentation.showStandby(shopName, tagline, promoText, imageUrl, footerNote);
    }

    private void startRotate() {
        stopRotate();
        if (promos.size() <= 1) return;
        rotateTask =
                new Runnable() {
                    @Override
                    public void run() {
                        if (presentation == null
                                || presentation.getMode()
                                        != CustomerDisplayPresentation.Mode.STANDBY) {
                            return;
                        }
                        promoIndex = (promoIndex + 1) % promos.size();
                        applyStandbyFrame();
                        main.postDelayed(this, STANDBY_ROTATE_MS);
                    }
                };
        main.postDelayed(rotateTask, STANDBY_ROTATE_MS);
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
