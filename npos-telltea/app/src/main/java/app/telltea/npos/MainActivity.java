package app.telltea.npos;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.TextView;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView hello = new TextView(this);
        hello.setText("Hello World");
        hello.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        hello.setTextColor(Color.BLACK);
        hello.setGravity(Gravity.CENTER);
        hello.setBackgroundColor(Color.WHITE);
        setContentView(hello);
    }
}
