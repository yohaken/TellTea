package app.telltea.npos;

import android.app.Activity;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Local receipt history — list + detail (web PosReceiptsView parity).
 * Filters: shift / today / recent · status · payment · bill search.
 */
public class ReceiptsActivity extends Activity {
  private enum TimeFilter {
    SHIFT,
    TODAY,
    RECENT
  }

  private enum StatusFilter {
    ALL,
    OK,
    VOIDED,
    PENDING
  }

  private enum PayFilter {
    ALL,
    CASH,
    PROMPTPAY
  }

  private final SaleSync saleSync = new SaleSync();
  private UiScale ui;
  private LinearLayout listRoot;
  private LinearLayout detailRoot;
  private TextView emptyDetail;
  private EditText searchField;

  private TimeFilter timeFilter = TimeFilter.SHIFT;
  private StatusFilter statusFilter = StatusFilter.ALL;
  private PayFilter payFilter = PayFilter.ALL;
  private String searchQuery = "";
  private String selectedMutationId = "";
  private List<JSONObject> visibleRows = new ArrayList<>();

  private TextView chipShift;
  private TextView chipToday;
  private TextView chipRecent;
  private TextView chipStatusAll;
  private TextView chipOk;
  private TextView chipVoid;
  private TextView chipPending;
  private TextView chipPayAll;
  private TextView chipCash;
  private TextView chipPp;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    ui = UiScale.from(this);

    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    int pad = NposUi.dp(this, 12);
    page.setPadding(pad, pad, pad, pad);

    page.addView(NposUi.headerBar(this, getString(R.string.receipts_title)));

    TextView hint = NposUi.caption(this, getString(R.string.receipts_actions_hint));
    hint.setPadding(0, NposUi.dp(this, 6), 0, NposUi.dp(this, 8));
    page.addView(hint);

    page.addView(buildChipRow());
    page.addView(buildStatusPayRow());

    searchField = NposUi.field(this);
    searchField.setHint(R.string.receipts_search_hint);
    searchField.setInputType(InputType.TYPE_CLASS_TEXT);
    searchField.setLayoutParams(NposUi.matchWidth(this, 8));
    searchField.addTextChangedListener(
        new TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence s, int start, int before, int count) {
            searchQuery = s == null ? "" : s.toString().trim();
            renderAll();
          }

          @Override
          public void afterTextChanged(Editable s) {}
        });
    page.addView(searchField);

    LinearLayout split = new LinearLayout(this);
    split.setOrientation(LinearLayout.HORIZONTAL);
    split.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

    ScrollView listScroll = new ScrollView(this);
    listScroll.setFillViewport(true);
    listRoot = new LinearLayout(this);
    listRoot.setOrientation(LinearLayout.VERTICAL);
    listScroll.addView(listRoot);
    LinearLayout.LayoutParams listLp =
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 38f);
    listLp.setMarginEnd(NposUi.dp(this, 8));
    listScroll.setLayoutParams(listLp);

    ScrollView detailScroll = new ScrollView(this);
    detailScroll.setFillViewport(true);
    detailRoot = new LinearLayout(this);
    detailRoot.setOrientation(LinearLayout.VERTICAL);
    detailRoot.setBackgroundResource(R.drawable.npos_card_surface);
    int dPad = NposUi.dp(this, 12);
    detailRoot.setPadding(dPad, dPad, dPad, dPad);
    emptyDetail = NposUi.caption(this, getString(R.string.receipts_select_hint));
    detailRoot.addView(emptyDetail);
    detailScroll.addView(detailRoot);
    detailScroll.setLayoutParams(
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 62f));

    split.addView(listScroll);
    split.addView(detailScroll);
    page.addView(split);

    setContentView(page);
    NposFonts.applyActivity(this);
    paintFilterChips();
    renderAll();
  }

  private LinearLayout buildChipRow() {
    LinearLayout row = chipHost();
    chipShift = addFilterChip(row, getString(R.string.receipts_filter_shift), () -> {
      timeFilter = TimeFilter.SHIFT;
      paintFilterChips();
      renderAll();
    });
    chipToday = addFilterChip(row, getString(R.string.receipts_filter_today), () -> {
      timeFilter = TimeFilter.TODAY;
      paintFilterChips();
      renderAll();
    });
    chipRecent = addFilterChip(row, getString(R.string.receipts_filter_recent), () -> {
      timeFilter = TimeFilter.RECENT;
      paintFilterChips();
      renderAll();
    });
    return wrapHorizontal(row);
  }

  private LinearLayout buildStatusPayRow() {
    LinearLayout row = chipHost();
    chipStatusAll = addFilterChip(row, getString(R.string.receipts_filter_all), () -> {
      statusFilter = StatusFilter.ALL;
      paintFilterChips();
      renderAll();
    });
    chipOk = addFilterChip(row, getString(R.string.receipts_filter_ok), () -> {
      statusFilter = StatusFilter.OK;
      paintFilterChips();
      renderAll();
    });
    chipVoid = addFilterChip(row, getString(R.string.receipts_filter_voided), () -> {
      statusFilter = StatusFilter.VOIDED;
      paintFilterChips();
      renderAll();
    });
    chipPending = addFilterChip(row, getString(R.string.receipts_filter_pending), () -> {
      statusFilter = StatusFilter.PENDING;
      paintFilterChips();
      renderAll();
    });
    chipPayAll = addFilterChip(row, getString(R.string.receipts_filter_pay_all), () -> {
      payFilter = PayFilter.ALL;
      paintFilterChips();
      renderAll();
    });
    chipCash = addFilterChip(row, getString(R.string.receipts_filter_cash), () -> {
      payFilter = PayFilter.CASH;
      paintFilterChips();
      renderAll();
    });
    chipPp = addFilterChip(row, getString(R.string.receipts_filter_pp), () -> {
      payFilter = PayFilter.PROMPTPAY;
      paintFilterChips();
      renderAll();
    });
    return wrapHorizontal(row);
  }

  private LinearLayout chipHost() {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    return row;
  }

  private LinearLayout wrapHorizontal(LinearLayout row) {
    HorizontalScrollView hsv = new HorizontalScrollView(this);
    hsv.setHorizontalScrollBarEnabled(false);
    hsv.addView(row);
    LinearLayout wrap = new LinearLayout(this);
    wrap.setOrientation(LinearLayout.VERTICAL);
    wrap.setLayoutParams(NposUi.matchWidth(this, 6));
    wrap.addView(hsv);
    return wrap;
  }

  private TextView addFilterChip(LinearLayout row, String label, Runnable onClick) {
    TextView chip = NposUi.chip(this, label);
    chip.setOnClickListener(v -> onClick.run());
    row.addView(chip, NposUi.wrap(this, 6, 4));
    return chip;
  }

  private void paintFilterChips() {
    paintChip(chipShift, timeFilter == TimeFilter.SHIFT);
    paintChip(chipToday, timeFilter == TimeFilter.TODAY);
    paintChip(chipRecent, timeFilter == TimeFilter.RECENT);
    paintChip(chipStatusAll, statusFilter == StatusFilter.ALL);
    paintChip(chipOk, statusFilter == StatusFilter.OK);
    paintChip(chipVoid, statusFilter == StatusFilter.VOIDED);
    paintChip(chipPending, statusFilter == StatusFilter.PENDING);
    paintChip(chipPayAll, payFilter == PayFilter.ALL);
    paintChip(chipCash, payFilter == PayFilter.CASH);
    paintChip(chipPp, payFilter == PayFilter.PROMPTPAY);
  }

  private void paintChip(TextView chip, boolean active) {
    if (chip == null) return;
    NposUi.applyBtn(chip, active ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
  }

  private void renderAll() {
    visibleRows = applyFilters(saleSync.listReceiptsNewestFirst(this));
    if (!selectedMutationId.isEmpty()) {
      boolean still = false;
      for (JSONObject r : visibleRows) {
        if (selectedMutationId.equals(r.optString("mutationId"))) {
          still = true;
          break;
        }
      }
      if (!still) selectedMutationId = "";
    }
    if (selectedMutationId.isEmpty() && !visibleRows.isEmpty()) {
      selectedMutationId = visibleRows.get(0).optString("mutationId", "");
    }
    renderList();
    renderDetail();
  }

  private List<JSONObject> applyFilters(List<JSONObject> src) {
    long dayStart = startOfLocalDayMs();
    String sessionId = ShiftPrefs.sessionId(this);
    String q = searchQuery.toLowerCase(Locale.US);
    List<JSONObject> out = new ArrayList<>();
    for (JSONObject row : src) {
      long at = row.optLong("at", 0);
      String sid = row.optString("sessionId", "");
      if (timeFilter == TimeFilter.SHIFT) {
        if (sessionId == null || sessionId.isEmpty()) {
          if (at < dayStart) continue;
        } else if (!sessionId.equals(sid) && !sid.isEmpty()) {
          continue;
        } else if (sid.isEmpty() && at < dayStart) {
          continue;
        }
      } else if (timeFilter == TimeFilter.TODAY) {
        if (at < dayStart) continue;
      } else if (out.size() >= 40) {
        break;
      }

      boolean voided = row.optBoolean("voided", false);
      boolean pending = isPending(row);
      if (statusFilter == StatusFilter.OK && (voided || pending)) continue;
      if (statusFilter == StatusFilter.VOIDED && !voided) continue;
      if (statusFilter == StatusFilter.PENDING && (voided || !pending)) continue;

      String pay = row.optString("paymentMethod", "");
      if (payFilter == PayFilter.CASH && !"cash".equalsIgnoreCase(pay)) continue;
      if (payFilter == PayFilter.PROMPTPAY && !"promptpay".equalsIgnoreCase(pay)) continue;

      if (!q.isEmpty()) {
        String bill = displayBillRaw(row).toLowerCase(Locale.US);
        String mid = row.optString("mutationId", "").toLowerCase(Locale.US);
        if (!bill.contains(q) && !mid.contains(q)) continue;
      }
      out.add(row);
    }
    return out;
  }

  private static long startOfLocalDayMs() {
    Calendar c = Calendar.getInstance();
    c.set(Calendar.HOUR_OF_DAY, 0);
    c.set(Calendar.MINUTE, 0);
    c.set(Calendar.SECOND, 0);
    c.set(Calendar.MILLISECOND, 0);
    return c.getTimeInMillis();
  }

  private static boolean isPending(JSONObject row) {
    if (row.optBoolean("voided", false)) return false;
    String bill = row.optString("billNo", "");
    if (bill.startsWith("รอส่ง") || "รอส่ง".equals(bill)) return true;
    String saleId = row.optString("saleId", "");
    return saleId.isEmpty() && (bill.isEmpty() || bill.startsWith("L-"));
  }

  private void renderList() {
    listRoot.removeAllViews();
    if (visibleRows.isEmpty()) {
      listRoot.addView(NposUi.caption(this, getString(R.string.receipts_empty)));
      return;
    }
    SimpleDateFormat fmt = new SimpleDateFormat("HH:mm", Locale.getDefault());
    for (JSONObject row : visibleRows) {
      boolean voided = row.optBoolean("voided", false);
      boolean pending = isPending(row);
      String bill = SaleSync.formatBillDisplay(displayBillRaw(row));
      String mid = row.optString("mutationId", "");
      boolean selected = mid.equals(selectedMutationId);

      LinearLayout card = new LinearLayout(this);
      card.setOrientation(LinearLayout.VERTICAL);
      card.setBackgroundResource(
          selected
              ? R.drawable.npos_touch_secondary
              : (voided ? R.drawable.npos_touch_ghost : R.drawable.npos_card_surface));
      int pad = ui.dp(10);
      card.setPadding(pad, pad, pad, pad);
      card.setLayoutParams(NposUi.matchWidth(this, 8));

      TextView billTv = NposUi.section(this, bill);
      billTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
      if (voided) billTv.setTextColor(NposUi.color(this, R.color.npos_muted));
      card.addView(billTv);

      String status =
          voided
              ? getString(R.string.receipts_badge_voided)
              : pending
                  ? getString(R.string.receipts_badge_pending)
                  : payLabel(row.optString("paymentMethod", ""));
      TextView meta =
          NposUi.caption(
              this,
              String.format(
                  Locale.getDefault(),
                  "%s · %s",
                  fmt.format(new Date(row.optLong("at", 0))),
                  status));
      card.addView(meta);

      TextView totalTv =
          NposUi.section(
              this, String.format(Locale.getDefault(), "฿%.0f", row.optDouble("total", 0)));
      totalTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
      if (voided) totalTv.setTextColor(NposUi.color(this, R.color.npos_muted));
      card.addView(totalTv);

      card.setOnClickListener(
          v -> {
            selectedMutationId = mid;
            renderList();
            renderDetail();
          });
      listRoot.addView(card);
    }
  }

  private void renderDetail() {
    detailRoot.removeAllViews();
    JSONObject row = findSelected();
    if (row == null) {
      detailRoot.addView(
          NposUi.caption(this, getString(R.string.receipts_select_hint)));
      return;
    }

    boolean voided = row.optBoolean("voided", false);
    boolean pending = isPending(row);
    String bill = SaleSync.formatBillDisplay(displayBillRaw(row));
    SimpleDateFormat fmt = new SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault());

    TextView title = NposUi.title(this, bill);
    detailRoot.addView(title);
    if (voided) {
      TextView badge = NposUi.caption(this, getString(R.string.receipts_badge_voided));
      badge.setTextColor(NposUi.color(this, R.color.npos_orange));
      detailRoot.addView(badge);
    } else if (pending) {
      detailRoot.addView(NposUi.caption(this, getString(R.string.receipts_badge_pending)));
    }

    detailRoot.addView(
        metaRow(
            getString(R.string.receipts_meta_time),
            fmt.format(new Date(row.optLong("at", 0)))));
    detailRoot.addView(
        metaRow(
            getString(R.string.receipts_meta_pay),
            payLabel(row.optString("paymentMethod", ""))));
    String staff = row.optString("staffName", "").trim();
    if (!staff.isEmpty()) {
      detailRoot.addView(metaRow(getString(R.string.receipts_meta_staff), staff));
    }
    String voidReason = row.optString("voidReason", "").trim();
    if (voided && !voidReason.isEmpty()) {
      detailRoot.addView(metaRow(getString(R.string.receipts_meta_void_reason), voidReason));
    }

    TextView itemsHead = NposUi.section(this, getString(R.string.receipts_items_head));
    itemsHead.setPadding(0, NposUi.dp(this, 12), 0, NposUi.dp(this, 6));
    detailRoot.addView(itemsHead);

    JSONArray lines = row.optJSONArray("lines");
    if (lines == null || lines.length() == 0) {
      detailRoot.addView(NposUi.caption(this, "—"));
    } else {
      for (int i = 0; i < lines.length(); i++) {
        JSONObject line = lines.optJSONObject(i);
        if (line == null) continue;
        String name = line.optString("name", "—");
        int qty = Math.max(1, line.optInt("qty", 1));
        double unit = line.optDouble("price", line.optDouble("unitPrice", 0));
        double lineTotal = unit * qty;

        LinearLayout lineBlock = new LinearLayout(this);
        lineBlock.setOrientation(LinearLayout.VERTICAL);
        lineBlock.setPadding(0, 0, 0, NposUi.dp(this, 8));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        TextView nameTv = NposUi.body(this, name);
        nameTv.setLayoutParams(
            new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        TextView priceTv =
            NposUi.body(this, String.format(Locale.getDefault(), "฿%.0f", lineTotal));
        priceTv.setGravity(Gravity.END);
        head.addView(nameTv);
        head.addView(priceTv);
        lineBlock.addView(head);

        TextView qtyTv =
            NposUi.caption(
                this, String.format(Locale.getDefault(), "×%d · ฿%.0f", qty, unit));
        lineBlock.addView(qtyTv);

        String opts = SaleSync.formatOptionsForReceipt(line.opt("options"));
        if (opts == null || opts.isEmpty()) {
          // also try optionsSummary-style nested choices
          opts = formatLineOptions(line.optJSONArray("options"));
        }
        if (opts != null && !opts.isEmpty()) {
          lineBlock.addView(NposUi.caption(this, opts));
        }
        detailRoot.addView(lineBlock);
      }
    }

    double sub =
        row.optDouble(
            "subtotal",
            row.optDouble("total", 0) + row.optDouble("discountBaht", 0));
    double discount = row.optDouble("discountBaht", 0);
    double total = row.optDouble("total", 0);

    TextView totalsHead = NposUi.section(this, getString(R.string.receipts_totals_head));
    totalsHead.setPadding(0, NposUi.dp(this, 8), 0, NposUi.dp(this, 4));
    detailRoot.addView(totalsHead);
    detailRoot.addView(
        metaRow(
            getString(R.string.cart_subtotal_label),
            String.format(Locale.getDefault(), "฿%.0f", sub)));
    detailRoot.addView(
        metaRow(
            getString(R.string.cart_discount_label),
            discount > 0
                ? String.format(Locale.getDefault(), "−฿%.0f", discount)
                : "—"));
    TextView net =
        metaRow(
            getString(R.string.cart_net_label),
            String.format(Locale.getDefault(), "฿%.0f", total));
    detailRoot.addView(net);

    if ("cash".equalsIgnoreCase(row.optString("paymentMethod", ""))) {
      detailRoot.addView(
          metaRow(
              getString(R.string.receipts_meta_received),
              String.format(
                  Locale.getDefault(), "฿%.0f", row.optDouble("cashReceived", 0))));
      detailRoot.addView(
          metaRow(
              getString(R.string.receipts_meta_change),
              String.format(Locale.getDefault(), "฿%.0f", row.optDouble("change", 0))));
    }

    if (!voided) {
      LinearLayout actions = new LinearLayout(this);
      actions.setOrientation(LinearLayout.VERTICAL);
      actions.setPadding(0, NposUi.dp(this, 12), 0, 0);

      TextView reprint = NposUi.primary(this, getString(R.string.btn_reprint));
      reprint.setMaxWidth(Integer.MAX_VALUE);
      reprint.setOnClickListener(v -> confirmReprint(row, bill));
      actions.addView(reprint, NposUi.matchWidth(this, 8));

      TextView voidBtn = NposUi.secondary(this, getString(R.string.btn_void_receipt));
      voidBtn.setMaxWidth(Integer.MAX_VALUE);
      voidBtn.setOnClickListener(v -> confirmVoid(row, bill));
      actions.addView(voidBtn, NposUi.matchWidth(this, 0));

      detailRoot.addView(actions);
    } else {
      TextView note = NposUi.caption(this, getString(R.string.receipts_already_voided));
      note.setPadding(0, NposUi.dp(this, 12), 0, 0);
      detailRoot.addView(note);
    }
  }

  private LinearLayout metaRow(String label, String value) {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setPadding(0, NposUi.dp(this, 2), 0, NposUi.dp(this, 2));
    TextView l = NposUi.caption(this, label);
    l.setLayoutParams(
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
    TextView v = NposUi.body(this, value);
    v.setGravity(Gravity.END);
    row.addView(l);
    row.addView(v);
    return row;
  }

  private JSONObject findSelected() {
    if (selectedMutationId == null || selectedMutationId.isEmpty()) return null;
    for (JSONObject r : visibleRows) {
      if (selectedMutationId.equals(r.optString("mutationId"))) return r;
    }
    return null;
  }

  private static String displayBillRaw(JSONObject row) {
    String billRaw = row.optString("billNo", "—");
    if (billRaw.isEmpty() || "รอส่ง".equals(billRaw)) {
      billRaw = SaleSync.provisionalBillNo(row.optString("mutationId", ""));
    }
    return billRaw;
  }

  private static String formatLineOptions(JSONArray groups) {
    if (groups == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < groups.length(); i++) {
      JSONObject g = groups.optJSONObject(i);
      if (g == null) continue;
      JSONArray choices = g.optJSONArray("choices");
      if (choices == null) continue;
      for (int j = 0; j < choices.length(); j++) {
        JSONObject c = choices.optJSONObject(j);
        if (c == null) continue;
        String n = c.optString("name", "").trim();
        if (n.isEmpty()) continue;
        if (sb.length() > 0) sb.append(" · ");
        sb.append(n);
      }
    }
    return sb.toString();
  }

  private static String payLabel(String pay) {
    if (pay == null || pay.isEmpty()) return "—";
    if ("promptpay".equalsIgnoreCase(pay)) return "PromptPay";
    if ("cash".equalsIgnoreCase(pay)) return "เงินสด";
    return pay;
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
                        renderAll();
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
