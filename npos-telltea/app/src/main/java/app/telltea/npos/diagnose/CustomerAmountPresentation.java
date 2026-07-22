package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.widget.TextView;

import app.telltea.npos.R;

/**
 * Settings test helper — shows a fixed amount on the customer payment panel.
 * Live sell uses {@link CustomerDisplayController} instead.
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
        findViewById(R.id.panelStandby).setVisibility(View.GONE);
        findViewById(R.id.panelSelecting).setVisibility(View.GONE);
        findViewById(R.id.panelSuccess).setVisibility(View.GONE);
        findViewById(R.id.panelPayment).setVisibility(View.VISIBLE);
        findViewById(R.id.payQr).setVisibility(View.GONE);
        findViewById(R.id.payCashDetail).setVisibility(View.GONE);

        TextView title = findViewById(R.id.payTitle);
        TextView amountView = findViewById(R.id.payTotal);
        TextView hintView = findViewById(R.id.payHint);
        title.setText(R.string.customer_caption);
        amountView.setText(amountText);
        hintView.setText(hint);
    }
}
