package app.telltea.npos;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
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
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/** Local receipt history — reprint + void (web PosReceiptsView parity). */
public class ReceiptsActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private LinearLayout listRoot;
  private UiScale ui;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    ui = UiScale.from(this);
    LinearLayout root = NposUi.pageColumn(this);
    root.addView(NposUi.headerBar(this, getString(R.string.receipts_title)));

    TextView hint = NposUi.caption(this, getString(R.string.receipts_actions_hint));
    hint.setPadding(0, NposUi.dp(this, 8), 0, NposUi.dp(this, 16));
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
      String billRaw = row.optString("billNo", "—");
      if (billRaw.isEmpty() || "รอส่ง".equals(billRaw)) {
        billRaw = SaleSync.provisionalBillNo(row.optString("mutationId", ""));
      }
      String bill = SaleSync.formatBillDisplay(billRaw);
      double total = row.optDouble("total", 0);
      String pay = row.optString("paymentMethod", "");
      String when = fmt.format(new Date(row.optLong("at", 0)));
      int n = 0;
      JSONArray lines = row.optJSONArray("lines");
      if (lines != null) n = lines.length();

      LinearLayout card = new LinearLayout(this);
      card.setOrientation(LinearLayout.VERTICAL);
      card.setBackgroundResource(
          voided ? R.drawable.npos_touch_ghost : R.drawable.npos_card_surface);
      int pad = ui.dp(14);
      card.setPadding(pad, pad, pad, pad);
      LinearLayout.LayoutParams cardLp = NposUi.matchWidth(this, 10);
      card.setLayoutParams(cardLp);

      TextView billTv = NposUi.section(this, bill + (voided ? " · ทำลายแล้ว" : ""));
      billTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.titleSp);
      if (voided) billTv.setTextColor(NposUi.color(this, R.color.npos_muted));
      card.addView(billTv);

      TextView meta =
          NposUi.caption(
              this,
              String.format(
                  Locale.getDefault(),
                  "%s · %s · %d รายการ",
                  when,
                  payLabel(pay),
                  n));
      meta.setPadding(0, ui.dp(4), 0, ui.dp(8));
      card.addView(meta);

      TextView totalTv =
          NposUi.title(this, String.format(Locale.getDefault(), "฿%.0f", total));
      totalTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 2f);
      if (voided) totalTv.setTextColor(NposUi.color(this, R.color.npos_muted));
      card.addView(totalTv);

      if (!voided) {
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.END);
        actions.setPadding(0, ui.dp(10), 0, 0);

        TextView reprint = NposUi.chip(this, getString(R.string.btn_reprint));
        final String billForConfirm = bill;
        reprint.setOnClickListener(v -> confirmReprint(row, billForConfirm));
        actions.addView(reprint, NposUi.wrap(this, 8, 0));

        TextView voidBtn = NposUi.ghost(this, getString(R.string.btn_void_receipt));
        voidBtn.setOnClickListener(v -> confirmVoid(row, billForConfirm));
        actions.addView(voidBtn);

        card.addView(actions);
      } else {
        final String billForAlert = bill;
        card.setOnClickListener(v -> showAlreadyVoided(billForAlert));
      }
      listRoot.addView(card);
    }
  }

  private static String payLabel(String pay) {
    if (pay == null || pay.isEmpty()) return "—";
    if ("promptpay".equalsIgnoreCase(pay)) return "PromptPay";
    if ("cash".equalsIgnoreCase(pay)) return "เงินสด";
    return pay;
  }

  private void showAlreadyVoided(String bill) {
    NposConfirmDialog.alert(
        this, bill, getString(R.string.receipts_already_voided), getString(android.R.string.ok), true, null);
  }

  private void confirmReprint(JSONObject receipt, String bill) {
    NposConfirmDialog.confirm(
        this,
        getString(R.string.receipts_reprint_title),
        getString(R.string.receipts_reprint_msg, bill),
        getString(R.string.btn_reprint),
        () -> {
          Toast.makeText(this, R.string.receipts_reprinting, Toast.LENGTH_SHORT).show();
          saleSync.reprintReceipt(
              this,
              receipt,
              () ->
                  runOnUiThread(
                      () ->
                          Toast.makeText(this, R.string.receipts_reprint_done, Toast.LENGTH_SHORT)
                              .show()));
        });
  }

  private void confirmVoid(JSONObject receipt, String bill) {
    EditText reason = NposUi.field(this);
    reason.setInputType(InputType.TYPE_CLASS_TEXT);
    reason.setHint(R.string.void_reason_hint);
    NposConfirmDialog.custom(
        this,
        getString(R.string.void_confirm_title),
        getString(R.string.void_confirm_msg, bill),
        reason,
        getString(R.string.btn_void_receipt),
        getString(android.R.string.cancel),
        true,
        () -> {
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
          return true;
        },
        null);
  }

  @Override
  protected void onDestroy() {
    saleSync.shutdown();
    super.onDestroy();
  }
}
