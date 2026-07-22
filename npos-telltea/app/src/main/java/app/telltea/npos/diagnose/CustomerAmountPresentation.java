package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.widget.TextView;

import app.telltea.npos.R;

/**
 * Settings test helper — payment overlay with fixed amount on two-pane layout.
 * Live sell uses {@link CustomerDisplayController}.
 */
public final class CustomerAmountPresentation extends Presentation {
    private final String amountText;
    private final String hint;

    public CustomerAmountPresentation(
            Context context, Display display, String amountText, String hint) {
        super(context, display);
        this.amountText = amountText;
        this.hint = hint == null ? "" : hint;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.presentation_customer);
        findViewById(R.id.panelSuccess).setVisibility(View.GONE);
        findViewById(R.id.receiptIdle).setVisibility(View.GONE);
        findViewById(R.id.receiptOrder).setVisibility(View.VISIBLE);
        findViewById(R.id.mediaPayOverlay).setVisibility(View.VISIBLE);
        findViewById(R.id.mediaCaptionBar).setVisibility(View.GONE);
        findViewById(R.id.payQr).setVisibility(View.GONE);
        findViewById(R.id.payCashDetail).setVisibility(View.GONE);

        TextView orderTitle = findViewById(R.id.receiptOrderTitle);
        orderTitle.setText(R.string.customer_caption);
        TextView total = findViewById(R.id.receiptTotal);
        total.setText(amountText);
        TextView sub = findViewById(R.id.receiptSubtotal);
        sub.setText(hint);
        findViewById(R.id.receiptDiscount).setVisibility(View.GONE);

        TextView payTitle = findViewById(R.id.payTitle);
        TextView payTotal = findViewById(R.id.payTotal);
        TextView payHint = findViewById(R.id.payHint);
        payTitle.setText(R.string.customer_caption);
        payTotal.setText(amountText);
        payHint.setText(hint);
    }
}
