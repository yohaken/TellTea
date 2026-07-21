package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;
import android.widget.TextView;

import app.telltea.npos.R;

/** Customer-facing amount on a secondary display (N3). */
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
        TextView amountView = findViewById(R.id.customerAmount);
        TextView hintView = findViewById(R.id.customerHint);
        amountView.setText(amountText);
        hintView.setText(hint);
    }
}
