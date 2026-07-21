package app.telltea.npos.diagnose;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;
import android.widget.TextView;

import app.telltea.npos.R;

/** Full-screen numbered test image on a secondary (or primary) display. */
public final class NumberPresentation extends Presentation {
    private final int number;
    private final String label;

    public NumberPresentation(Context context, Display display, int number, String label) {
        super(context, display);
        this.number = number;
        this.label = label;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.presentation_number);
        TextView numberView = findViewById(R.id.presentationNumber);
        TextView labelView = findViewById(R.id.presentationLabel);
        numberView.setText(String.valueOf(number));
        labelView.setText(label);
    }
}
