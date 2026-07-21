package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.sell.SaleSync;

/** Local receipt history + reprint (N6.6 parity). */
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
    title.setPadding(0, 0, 0, 8);
    root.addView(title);

    TextView hint = new TextView(this);
    hint.setText(R.string.receipts_reprint_hint);
    hint.setTextColor(0xFF666666);
    hint.setTextSize(12);
    hint.setPadding(0, 0, 0, 16);
    root.addView(hint);

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
        line.setPadding(0, 12, 0, 12);
        line.setBackgroundColor(0xFFFFFFFF);
        final JSONObject receipt = row;
        line.setOnClickListener(v -> confirmReprint(receipt));
        root.addView(line);
      }
    }
    setContentView(root);
  }

  private void confirmReprint(JSONObject receipt) {
    String bill = receipt.optString("billNo", "—");
    new AlertDialog.Builder(this)
        .setTitle(R.string.receipts_reprint_title)
        .setMessage(getString(R.string.receipts_reprint_msg, bill))
        .setPositiveButton(
            R.string.btn_reprint,
            (d, w) -> {
              Toast.makeText(this, R.string.receipts_reprinting, Toast.LENGTH_SHORT).show();
              saleSync.reprintReceipt(
                  this,
                  receipt,
                  () ->
                      runOnUiThread(
                          () ->
                              Toast.makeText(this, R.string.receipts_reprint_done, Toast.LENGTH_SHORT)
                                  .show()));
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  @Override
  protected void onDestroy() {
    saleSync.shutdown();
    super.onDestroy();
  }
}
