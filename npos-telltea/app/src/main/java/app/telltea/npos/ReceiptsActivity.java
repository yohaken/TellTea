package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
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

/** Local receipt history — reprint + void (web PosReceiptsView parity). */
public class ReceiptsActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private LinearLayout listRoot;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(24, 24, 24, 24);
    root.setBackgroundColor(0xFFF7F7F5);
    LinearLayout top = new LinearLayout(this);
    top.setOrientation(LinearLayout.HORIZONTAL);
    Button back = new Button(this);
    back.setText(R.string.btn_back);
    back.setAllCaps(false);
    back.setOnClickListener(v -> finish());
    top.addView(back);
    TextView title = new TextView(this);
    title.setText(R.string.receipts_title);
    title.setTextSize(22);
    title.setTextColor(0xFF1A2E24);
    title.setPadding(16, 12, 0, 0);
    top.addView(title);
    root.addView(top);

    TextView hint = new TextView(this);
    hint.setText(R.string.receipts_actions_hint);
    hint.setTextColor(0xFF666666);
    hint.setTextSize(12);
    hint.setPadding(0, 0, 0, 16);
    root.addView(hint);

    listRoot = new LinearLayout(this);
    listRoot.setOrientation(LinearLayout.VERTICAL);
    root.addView(listRoot);
    setContentView(root);
    renderList();
  }

  private void renderList() {
    listRoot.removeAllViews();
    List<JSONObject> rows = saleSync.recentReceipts(this);
    if (rows.isEmpty()) {
      TextView empty = new TextView(this);
      empty.setText(R.string.receipts_empty);
      empty.setTextColor(0xFF666666);
      listRoot.addView(empty);
      return;
    }
    SimpleDateFormat fmt = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
    for (JSONObject row : rows) {
      TextView line = new TextView(this);
      boolean voided = row.optBoolean("voided", false);
      String bill = row.optString("billNo", "—");
      double total = row.optDouble("total", 0);
      String pay = row.optString("paymentMethod", "");
      String when = fmt.format(new Date(row.optLong("at", 0)));
      int n = 0;
      JSONArray lines = row.optJSONArray("lines");
      if (lines != null) n = lines.length();
      String label =
          String.format(
              Locale.getDefault(),
              "%s · %s · ฿%.0f · %s · %d รายการ%s",
              when,
              bill,
              total,
              pay,
              n,
              voided ? " · ทำลายแล้ว" : "");
      line.setText(label);
      line.setTextSize(13);
      line.setTextColor(voided ? 0xFF999999 : 0xFF333333);
      line.setPadding(0, 12, 0, 12);
      line.setBackgroundColor(voided ? 0xFFEEEEEE : 0xFFFFFFFF);
      final JSONObject receipt = row;
      line.setOnClickListener(v -> showActions(receipt));
      listRoot.addView(line);
    }
  }

  private void showActions(JSONObject receipt) {
    boolean voided = receipt.optBoolean("voided", false);
    String bill = receipt.optString("billNo", "—");
    if (voided) {
      new AlertDialog.Builder(this)
          .setTitle(bill)
          .setMessage(R.string.receipts_already_voided)
          .setPositiveButton(android.R.string.ok, null)
          .show();
      return;
    }
    new AlertDialog.Builder(this)
        .setTitle(bill)
        .setItems(
            new CharSequence[] {
              getString(R.string.btn_reprint), getString(R.string.btn_void_receipt)
            },
            (d, which) -> {
              if (which == 0) confirmReprint(receipt);
              else confirmVoid(receipt);
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
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
                              Toast.makeText(
                                      this, R.string.receipts_reprint_done, Toast.LENGTH_SHORT)
                                  .show()));
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void confirmVoid(JSONObject receipt) {
    EditText reason = new EditText(this);
    reason.setInputType(InputType.TYPE_CLASS_TEXT);
    reason.setHint(R.string.void_reason_hint);
    new AlertDialog.Builder(this)
        .setTitle(R.string.void_confirm_title)
        .setMessage(getString(R.string.void_confirm_msg, receipt.optString("billNo", "—")))
        .setView(reason)
        .setPositiveButton(
            R.string.btn_void_receipt,
            (d, w) -> {
              String r = reason.getText().toString().trim();
              saleSync.voidReceipt(
                  this,
                  receipt,
                  r.isEmpty() ? "ทำลายบิล" : r,
                  () ->
                      runOnUiThread(
                          () -> {
                            Toast.makeText(this, R.string.void_done, Toast.LENGTH_SHORT).show();
                            renderList();
                          }));
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
