package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/** Local receipt history — reprint + void (web PosReceiptsView parity). */
public class ReceiptsActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private LinearLayout listRoot;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout root = NposUi.pageColumn(this);
    root.addView(NposUi.headerBar(this, getString(R.string.receipts_title)));

    TextView hint = NposUi.caption(this, getString(R.string.receipts_actions_hint));
    hint.setPadding(0, NposUi.dp(this, 8), 0, NposUi.dp(this, 12));
    root.addView(hint);

    listRoot = new LinearLayout(this);
    listRoot.setOrientation(LinearLayout.VERTICAL);
    root.addView(listRoot);

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    scroll.addView(root);
    setContentView(scroll);
    NposFonts.applyActivity(this);
    renderList();
  }

  private void renderList() {
    listRoot.removeAllViews();
    List<JSONObject> rows = saleSync.recentReceipts(this);
    if (rows.isEmpty()) {
      listRoot.addView(NposUi.caption(this, getString(R.string.receipts_empty)));
      return;
    }
    SimpleDateFormat fmt = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
    for (JSONObject row : rows) {
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
      TextView line = NposUi.body(this, label);
      line.setTextColor(
          voided
              ? NposUi.color(this, R.color.npos_muted)
              : NposUi.color(this, R.color.npos_ink));
      line.setTypeface(voided ? NposFonts.regular(this) : NposFonts.medium(this));
      line.setPadding(NposUi.dp(this, 12), NposUi.dp(this, 12), NposUi.dp(this, 12), NposUi.dp(this, 12));
      line.setBackgroundResource(voided ? R.drawable.npos_touch_ghost : R.drawable.npos_card_surface);
      LinearLayout.LayoutParams lp = NposUi.matchWidth(this, 8);
      line.setLayoutParams(lp);
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
                              Toast.makeText(this, R.string.receipts_reprint_done, Toast.LENGTH_SHORT)
                                  .show()));
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void confirmVoid(JSONObject receipt) {
    EditText reason = NposUi.field(this);
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
