package app.telltea.npos;

import android.app.Activity;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.sell.SaleSync;

/** Local receipt history (N6.5). */
public class ReceiptsActivity extends Activity {
    private final SaleSync saleSync = new SaleSync();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 24, 24, 24);
        root.setBackgroundColor(0xFFF7F7F5);
        TextView title = new TextView(this);
        title.setText(R.string.receipts_title);
        title.setTextSize(22);
        title.setTextColor(0xFF1A2E24);
        title.setPadding(0, 0, 0, 16);
        root.addView(title);

        List<JSONObject> rows = saleSync.recentReceipts(this);
        if (rows.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.receipts_empty);
            empty.setTextColor(0xFF666666);
            root.addView(empty);
        } else {
            SimpleDateFormat fmt = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
            for (JSONObject row : rows) {
                TextView line = new TextView(this);
                String bill = row.optString("billNo", "—");
                double total = row.optDouble("total", 0);
                String pay = row.optString("paymentMethod", "");
                String when = fmt.format(new Date(row.optLong("at", 0)));
                int n = 0;
                JSONArray lines = row.optJSONArray("lines");
                if (lines != null) n = lines.length();
                line.setText(
                        String.format(
                                Locale.getDefault(),
                                "%s · %s · ฿%.0f · %s · %d รายการ",
                                when,
                                bill,
                                total,
                                pay,
                                n));
                line.setTextSize(13);
                line.setTextColor(0xFF333333);
                line.setPadding(0, 8, 0, 8);
                root.addView(line);
            }
        }
        setContentView(root);
    }

    @Override
    protected void onDestroy() {
        saleSync.shutdown();
        super.onDestroy();
    }
}
