package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;
import java.util.Locale;

import app.telltea.npos.R;
import app.telltea.npos.sell.ImageLoader;

/**
 * Dual-screen customer UI: standby · selecting · payment · success.
 * Views update in place (no recreate) for smooth realtime cart/payment.
 */
public final class CustomerDisplayPresentation extends Presentation {
    public enum Mode {
        STANDBY,
        SELECTING,
        PAYMENT,
        SUCCESS
    }

    public static final class Line {
        public final String name;
        public final int qty;
        public final double lineTotal;

        public Line(String name, int qty, double lineTotal) {
            this.name = name == null ? "" : name;
            this.qty = qty;
            this.lineTotal = lineTotal;
        }
    }

    private View panelStandby;
    private View panelSelecting;
    private View panelPayment;
    private View panelSuccess;

    private TextView standbyBrand;
    private TextView standbyTagline;
    private TextView standbyPromo;
    private ImageView standbyPromoImage;
    private TextView standbyFooter;

    private LinearLayout selectLines;
    private TextView selectDiscount;
    private TextView selectTotal;

    private TextView payTitle;
    private TextView payTotal;
    private TextView payHint;
    private ImageView payQr;
    private TextView payCashDetail;

    private TextView successTitle;
    private TextView successAmount;
    private TextView successMessage;

    private Mode mode = Mode.STANDBY;

    public CustomerDisplayPresentation(Context context, Display display) {
        super(context, display);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.presentation_customer);
        panelStandby = findViewById(R.id.panelStandby);
        panelSelecting = findViewById(R.id.panelSelecting);
        panelPayment = findViewById(R.id.panelPayment);
        panelSuccess = findViewById(R.id.panelSuccess);

        standbyBrand = findViewById(R.id.standbyBrand);
        standbyTagline = findViewById(R.id.standbyTagline);
        standbyPromo = findViewById(R.id.standbyPromo);
        standbyPromoImage = findViewById(R.id.standbyPromoImage);
        standbyFooter = findViewById(R.id.standbyFooter);

        selectLines = findViewById(R.id.selectLines);
        selectDiscount = findViewById(R.id.selectDiscount);
        selectTotal = findViewById(R.id.selectTotal);

        payTitle = findViewById(R.id.payTitle);
        payTotal = findViewById(R.id.payTotal);
        payHint = findViewById(R.id.payHint);
        payQr = findViewById(R.id.payQr);
        payCashDetail = findViewById(R.id.payCashDetail);

        successTitle = findViewById(R.id.successTitle);
        successAmount = findViewById(R.id.successAmount);
        successMessage = findViewById(R.id.successMessage);
    }

    public Mode getMode() {
        return mode;
    }

    public void showStandby(
            String shopName,
            String tagline,
            String promoText,
            String promoImageUrl,
            String footer) {
        mode = Mode.STANDBY;
        setPanel(panelStandby);
        standbyBrand.setText(
                shopName == null || shopName.trim().isEmpty()
                        ? getContext().getString(R.string.app_name)
                        : shopName.trim());
        standbyTagline.setText(
                tagline == null || tagline.trim().isEmpty()
                        ? getContext().getString(R.string.customer_standby_welcome)
                        : tagline.trim());
        String promo =
                promoText == null || promoText.trim().isEmpty()
                        ? getContext().getString(R.string.customer_standby_promo_fallback)
                        : promoText.trim();
        standbyPromo.setText(promo);
        if (promoImageUrl != null && !promoImageUrl.trim().isEmpty()) {
            standbyPromoImage.setVisibility(View.VISIBLE);
            ImageLoader.bind(standbyPromoImage, promoImageUrl, 0xFF1A2A22);
        } else {
            standbyPromoImage.setVisibility(View.GONE);
            standbyPromoImage.setImageDrawable(null);
        }
        standbyFooter.setText(footer == null ? "" : footer.trim());
    }

    public void showSelecting(List<Line> lines, double discountBaht, double total) {
        mode = Mode.SELECTING;
        setPanel(panelSelecting);
        selectLines.removeAllViews();
        if (lines != null) {
            for (Line line : lines) {
                TextView row = new TextView(getContext());
                row.setText(
                        String.format(
                                Locale.getDefault(),
                                "%s  ×%d    ฿%.0f",
                                line.name,
                                line.qty,
                                line.lineTotal));
                row.setTextColor(0xFFF3F6F2);
                row.setTextSize(18);
                row.setPadding(0, 6, 0, 6);
                selectLines.addView(row);
            }
        }
        if (discountBaht > 0.01) {
            selectDiscount.setVisibility(View.VISIBLE);
            selectDiscount.setText(
                    getContext()
                            .getString(R.string.customer_select_discount_fmt, discountBaht));
        } else {
            selectDiscount.setVisibility(View.GONE);
        }
        selectTotal.setText(
                getContext().getString(R.string.customer_select_total_fmt, total));
    }

    public void showPaymentCash(double total, double received, double change, boolean enough) {
        mode = Mode.PAYMENT;
        setPanel(panelPayment);
        payTitle.setText(R.string.customer_pay_cash_title);
        payTotal.setText(String.format(Locale.getDefault(), "฿%.0f", total));
        payHint.setText(R.string.customer_pay_cash_hint);
        payQr.setVisibility(View.GONE);
        payQr.setImageDrawable(null);
        payCashDetail.setVisibility(View.VISIBLE);
        if (enough) {
            payCashDetail.setText(
                    getContext()
                            .getString(R.string.customer_pay_cash_detail_ok, received, change));
            payCashDetail.setTextColor(0xFF8FCB9B);
        } else {
            payCashDetail.setText(
                    getContext().getString(R.string.customer_pay_cash_detail_wait, received));
            payCashDetail.setTextColor(0xFFF3F6F2);
        }
    }

    public void showPaymentQr(double total, Bitmap qrBitmap) {
        mode = Mode.PAYMENT;
        setPanel(panelPayment);
        payTitle.setText(R.string.customer_pay_qr_title);
        payTotal.setText(String.format(Locale.getDefault(), "฿%.0f", total));
        payHint.setText(R.string.customer_pay_qr_hint);
        payCashDetail.setVisibility(View.GONE);
        if (qrBitmap != null) {
            payQr.setVisibility(View.VISIBLE);
            payQr.setImageBitmap(qrBitmap);
        } else {
            payQr.setVisibility(View.GONE);
            payQr.setImageDrawable(null);
            payHint.setText(R.string.customer_pay_qr_missing);
        }
    }

    public void showSuccess(String message, double total) {
        mode = Mode.SUCCESS;
        setPanel(panelSuccess);
        successTitle.setText(R.string.customer_success_title);
        successAmount.setText(String.format(Locale.getDefault(), "฿%.0f", total));
        successAmount.setGravity(Gravity.CENTER);
        String msg =
                message == null || message.trim().isEmpty()
                        ? getContext().getString(R.string.customer_success_default)
                        : message.trim();
        successMessage.setText(msg);
    }

    private void setPanel(View active) {
        panelStandby.setVisibility(active == panelStandby ? View.VISIBLE : View.GONE);
        panelSelecting.setVisibility(active == panelSelecting ? View.VISIBLE : View.GONE);
        panelPayment.setVisibility(active == panelPayment ? View.VISIBLE : View.GONE);
        panelSuccess.setVisibility(active == panelSuccess ? View.VISIBLE : View.GONE);
    }
}
