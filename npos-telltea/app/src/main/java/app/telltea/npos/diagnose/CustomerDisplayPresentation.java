package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;
import java.util.Locale;

import app.telltea.npos.R;
import app.telltea.npos.sell.ImageLoader;

/**
 * Two-pane customer UI (media 60–70% + receipt 30–40%) with auto-resize for
 * portrait emu / landscape shop panels. Modes: idle · ordering · payment · success.
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
        public final double unitPrice;
        public final double lineTotal;
        /** Option/topping summary (may be empty). */
        public final String detail;

        public Line(String name, int qty, double unitPrice, double lineTotal, String detail) {
            this.name = name == null ? "" : name;
            this.qty = qty;
            this.unitPrice = unitPrice;
            this.lineTotal = lineTotal;
            this.detail = detail == null ? "" : detail;
        }

        public Line(String name, int qty, double unitPrice, double lineTotal) {
            this(name, qty, unitPrice, lineTotal, "");
        }

        /** Backward-compatible ctor (unit inferred). */
        public Line(String name, int qty, double lineTotal) {
            this(name, qty, qty > 0 ? lineTotal / qty : lineTotal, lineTotal, "");
        }
    }

    private LinearLayout customerSplit;
    private FrameLayout paneMedia;
    private LinearLayout paneReceipt;

    private ImageView mediaImage;
    private LinearLayout mediaCaptionBar;
    private TextView mediaLabel;
    private TextView mediaTitle;
    private View mediaPayOverlay;
    private TextView payTitle;
    private TextView payTotal;
    private ImageView payQr;
    private TextView payHint;
    private TextView payCashDetail;

    private View receiptIdle;
    private View receiptOrder;
    private TextView receiptBrand;
    private TextView receiptWelcome;
    private TextView receiptFooter;
    private TextView receiptOrderTitle;
    private LinearLayout receiptLines;
    private TextView receiptSubtotal;
    private TextView receiptDiscount;
    private TextView receiptTotal;

    private View panelSuccess;
    private TextView successCheck;
    private TextView successTitle;
    private TextView successAmount;
    private TextView successChange;
    private TextView successMessage;

    private CustomerDisplayMetrics metrics;
    private Mode mode = Mode.STANDBY;

    public CustomerDisplayPresentation(Context context, Display display) {
        super(context, display);
        metrics = CustomerDisplayMetrics.from(display);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.presentation_customer);
        customerSplit = findViewById(R.id.customerSplit);
        paneMedia = findViewById(R.id.paneMedia);
        paneReceipt = findViewById(R.id.paneReceipt);

        mediaImage = findViewById(R.id.mediaImage);
        mediaCaptionBar = findViewById(R.id.mediaCaptionBar);
        mediaLabel = findViewById(R.id.mediaLabel);
        mediaTitle = findViewById(R.id.mediaTitle);
        mediaPayOverlay = findViewById(R.id.mediaPayOverlay);
        payTitle = findViewById(R.id.payTitle);
        payTotal = findViewById(R.id.payTotal);
        payQr = findViewById(R.id.payQr);
        payHint = findViewById(R.id.payHint);
        payCashDetail = findViewById(R.id.payCashDetail);

        receiptIdle = findViewById(R.id.receiptIdle);
        receiptOrder = findViewById(R.id.receiptOrder);
        receiptBrand = findViewById(R.id.receiptBrand);
        receiptWelcome = findViewById(R.id.receiptWelcome);
        receiptFooter = findViewById(R.id.receiptFooter);
        receiptOrderTitle = findViewById(R.id.receiptOrderTitle);
        receiptLines = findViewById(R.id.receiptLines);
        receiptSubtotal = findViewById(R.id.receiptSubtotal);
        receiptDiscount = findViewById(R.id.receiptDiscount);
        receiptTotal = findViewById(R.id.receiptTotal);

        panelSuccess = findViewById(R.id.panelSuccess);
        successCheck = findViewById(R.id.successCheck);
        successTitle = findViewById(R.id.successTitle);
        successAmount = findViewById(R.id.successAmount);
        successChange = findViewById(R.id.successChange);
        successMessage = findViewById(R.id.successMessage);

        applyMetricsLayout();
    }

    public Mode getMode() {
        return mode;
    }

    public CustomerDisplayMetrics getMetrics() {
        return metrics;
    }

    /** Idle: media = promo slideshow; side = logo / welcome. */
    public void showStandby(
            String shopName,
            String tagline,
            String promoText,
            String promoImageUrl,
            String footer) {
        mode = Mode.STANDBY;
        panelSuccess.setVisibility(View.GONE);
        mediaPayOverlay.setVisibility(View.GONE);
        mediaCaptionBar.setVisibility(View.VISIBLE);
        mediaImage.setVisibility(View.VISIBLE);
        receiptIdle.setVisibility(View.VISIBLE);
        receiptOrder.setVisibility(View.GONE);

        receiptBrand.setText(
                shopName == null || shopName.trim().isEmpty()
                        ? getContext().getString(R.string.app_name)
                        : shopName.trim());
        receiptWelcome.setText(
                tagline == null || tagline.trim().isEmpty()
                        ? getContext().getString(R.string.customer_standby_welcome)
                        : tagline.trim());
        receiptFooter.setText(footer == null ? "" : footer.trim());
        bindPromo(promoText, promoImageUrl);
    }

    /** Ordering: media keeps promo; side = live receipt. */
    public void showSelecting(
            List<Line> lines, double subtotal, double discountBaht, double total) {
        mode = Mode.SELECTING;
        panelSuccess.setVisibility(View.GONE);
        mediaPayOverlay.setVisibility(View.GONE);
        mediaCaptionBar.setVisibility(View.VISIBLE);
        mediaImage.setVisibility(View.VISIBLE);
        receiptIdle.setVisibility(View.GONE);
        receiptOrder.setVisibility(View.VISIBLE);
        bindReceipt(lines, subtotal, discountBaht, total);
    }

    /** Keep promo frame while ordering (controller rotates). */
    public void updatePromo(String promoText, String promoImageUrl) {
        if (mode != Mode.STANDBY && mode != Mode.SELECTING) return;
        bindPromo(promoText, promoImageUrl);
    }

    public void showPaymentCash(
            List<Line> lines,
            double subtotal,
            double discountBaht,
            double total,
            double received,
            double change,
            boolean enough) {
        mode = Mode.PAYMENT;
        panelSuccess.setVisibility(View.GONE);
        receiptIdle.setVisibility(View.GONE);
        receiptOrder.setVisibility(View.VISIBLE);
        bindReceipt(lines, subtotal, discountBaht, total);

        mediaPayOverlay.setVisibility(View.VISIBLE);
        mediaCaptionBar.setVisibility(View.GONE);
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

    public void showPaymentQr(
            List<Line> lines,
            double subtotal,
            double discountBaht,
            double total,
            Bitmap qrBitmap) {
        mode = Mode.PAYMENT;
        panelSuccess.setVisibility(View.GONE);
        receiptIdle.setVisibility(View.GONE);
        receiptOrder.setVisibility(View.VISIBLE);
        bindReceipt(lines, subtotal, discountBaht, total);

        mediaPayOverlay.setVisibility(View.VISIBLE);
        mediaCaptionBar.setVisibility(View.GONE);
        payTitle.setText(R.string.customer_pay_qr_title);
        payTotal.setText(String.format(Locale.getDefault(), "฿%.0f", total));
        payHint.setText(R.string.customer_pay_qr_hint);
        payCashDetail.setVisibility(View.GONE);
        if (qrBitmap != null) {
            payQr.setVisibility(View.VISIBLE);
            payQr.setImageBitmap(qrBitmap);
            sizeQr();
        } else {
            payQr.setVisibility(View.GONE);
            payQr.setImageDrawable(null);
            payHint.setText(R.string.customer_pay_qr_missing);
        }
    }

    public void showSuccess(String message, double total, double change) {
        mode = Mode.SUCCESS;
        panelSuccess.setVisibility(View.VISIBLE);
        mediaPayOverlay.setVisibility(View.GONE);
        successTitle.setText(R.string.customer_success_paid);
        successAmount.setText(String.format(Locale.getDefault(), "฿%.0f", total));
        if (change > 0.01) {
            successChange.setVisibility(View.VISIBLE);
            successChange.setText(
                    getContext().getString(R.string.customer_success_change_fmt, change));
        } else {
            successChange.setVisibility(View.GONE);
        }
        String msg =
                message == null || message.trim().isEmpty()
                        ? getContext().getString(R.string.customer_success_default)
                        : message.trim();
        successMessage.setText(msg);
        applyTextScale();
    }

    private void bindPromo(String promoText, String promoImageUrl) {
        mediaLabel.setText(R.string.customer_standby_recommend_label);
        String promo =
                promoText == null || promoText.trim().isEmpty()
                        ? getContext().getString(R.string.customer_standby_promo_fallback)
                        : promoText.trim();
        mediaTitle.setText(promo);
        if (promoImageUrl != null && !promoImageUrl.trim().isEmpty()) {
            ImageLoader.bind(mediaImage, promoImageUrl, 0xFF1A2A22);
        } else {
            mediaImage.setImageDrawable(null);
            mediaImage.setBackgroundColor(0xFF1A2A22);
        }
    }

    private void bindReceipt(
            List<Line> lines, double subtotal, double discountBaht, double total) {
        receiptLines.removeAllViews();
        if (lines != null) {
            for (Line line : lines) {
                LinearLayout row = new LinearLayout(getContext());
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(0, Math.round(4 * metrics.scale), 0, Math.round(6 * metrics.scale));

                TextView name = new TextView(getContext());
                name.setText(line.name);
                name.setTextColor(0xFFF3F6F2);
                name.setTextSize(TypedValue.COMPLEX_UNIT_SP, metrics.bodySp);
                name.setTypeface(name.getTypeface(), android.graphics.Typeface.BOLD);

                TextView meta = new TextView(getContext());
                meta.setText(
                        String.format(
                                Locale.getDefault(),
                                "×%d  ·  ฿%.0f  ·  ฿%.0f",
                                line.qty,
                                line.unitPrice,
                                line.lineTotal));
                meta.setTextColor(0xFFA8B5AE);
                meta.setTextSize(TypedValue.COMPLEX_UNIT_SP, metrics.bodySp * 0.9f);

                row.addView(name);
                row.addView(meta);
                if (line.detail != null && !line.detail.trim().isEmpty()) {
                    TextView detail = new TextView(getContext());
                    detail.setText(line.detail.trim());
                    detail.setTextColor(0xFF7A8A82);
                    detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, metrics.bodySp * 0.85f);
                    row.addView(detail);
                }
                receiptLines.addView(row);
            }
        }
        receiptSubtotal.setText(
                getContext().getString(R.string.customer_receipt_subtotal_fmt, subtotal));
        if (discountBaht > 0.01) {
            receiptDiscount.setVisibility(View.VISIBLE);
            receiptDiscount.setText(
                    getContext().getString(R.string.customer_select_discount_fmt, discountBaht));
        } else {
            receiptDiscount.setVisibility(View.GONE);
        }
        receiptTotal.setText(
                getContext().getString(R.string.customer_select_total_fmt, total));
        applyTextScale();
    }

    private void applyMetricsLayout() {
        if (customerSplit == null || metrics == null) return;
        customerSplit.setOrientation(
                metrics.landscape ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);

        LinearLayout.LayoutParams mediaLp =
                new LinearLayout.LayoutParams(
                        metrics.landscape ? 0 : ViewGroup.LayoutParams.MATCH_PARENT,
                        metrics.landscape ? ViewGroup.LayoutParams.MATCH_PARENT : 0,
                        metrics.mediaWeight);
        LinearLayout.LayoutParams receiptLp =
                new LinearLayout.LayoutParams(
                        metrics.landscape ? 0 : ViewGroup.LayoutParams.MATCH_PARENT,
                        metrics.landscape ? ViewGroup.LayoutParams.MATCH_PARENT : 0,
                        metrics.receiptWeight);
        paneMedia.setLayoutParams(mediaLp);
        paneReceipt.setLayoutParams(receiptLp);

        int pad = Math.round(metrics.padDp * getContext().getResources().getDisplayMetrics().density);
        paneReceipt.setPadding(pad, pad, pad, pad);
        sizeQr();
        applyTextScale();
    }

    private void sizeQr() {
        if (payQr == null || metrics == null) return;
        ViewGroup.LayoutParams lp = payQr.getLayoutParams();
        lp.width = metrics.qrEdgePx;
        lp.height = metrics.qrEdgePx;
        payQr.setLayoutParams(lp);
    }

    private void applyTextScale() {
        if (metrics == null) return;
        setSp(mediaLabel, metrics.bodySp * 0.85f);
        setSp(mediaTitle, metrics.titleSp);
        setSp(receiptBrand, metrics.brandSp);
        setSp(receiptWelcome, metrics.bodySp * 1.1f);
        setSp(receiptFooter, metrics.bodySp * 0.9f);
        setSp(receiptOrderTitle, metrics.titleSp * 0.85f);
        setSp(receiptSubtotal, metrics.bodySp);
        setSp(receiptDiscount, metrics.bodySp);
        setSp(receiptTotal, metrics.totalSp * 0.85f);
        setSp(payTitle, metrics.titleSp);
        setSp(payTotal, metrics.totalSp);
        setSp(payHint, metrics.bodySp);
        setSp(payCashDetail, metrics.titleSp * 0.9f);
        setSp(successCheck, metrics.totalSp * 1.8f);
        setSp(successTitle, metrics.titleSp * 1.15f);
        setSp(successAmount, metrics.totalSp);
        setSp(successChange, metrics.titleSp);
        setSp(successMessage, metrics.bodySp * 1.1f);
    }

    private static void setSp(TextView tv, float sp) {
        if (tv == null) return;
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    }
}
