package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.SessionHistory;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposNumberPad;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Shift / sales-session panel — left rail actions · right TellTea dashboard cards.
 */
public class ShiftActivity extends Activity {
  private static final int TAB_DASH = 0;
  private static final int TAB_HISTORY = 1;

  private final SaleSync saleSync = new SaleSync();
  private final Handler dutyHandler = new Handler(Looper.getMainLooper());
  private LinearLayout dashHost;
  private LinearLayout historyHost;
  private TextView navDash;
  private TextView navHistory;
  private TextView staffLine;
  private TextView cashCardBody;
  private TextView transferCardBody;
  private TextView summaryCardBody;
  private int activeTab = TAB_DASH;
  private final Runnable dutyTick =
      new Runnable() {
        @Override
        public void run() {
          refreshDashboard();
          if (ShiftPrefs.isOpen(ShiftActivity.this)) {
            dutyHandler.postDelayed(this, 1000L);
          }
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    UiScale ui = UiScale.from(this);

    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    page.addView(NposUi.headerBar(this, getString(R.string.nav_shift)));

    LinearLayout split = new LinearLayout(this);
    split.setOrientation(LinearLayout.HORIZONTAL);
    split.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
    split.setPadding(ui.dp(10), ui.dp(8), ui.dp(10), ui.dp(10));

    // Left ~30%: sub-menu
    LinearLayout left = new LinearLayout(this);
    left.setOrientation(LinearLayout.VERTICAL);
    left.setBackgroundColor(NposUi.color(this, R.color.npos_surface));
    left.setPadding(ui.dp(10), ui.dp(12), ui.dp(10), ui.dp(12));
    LinearLayout.LayoutParams leftLp =
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 30f);
    leftLp.setMarginEnd(ui.dp(8));
    left.setLayoutParams(leftLp);

    TextView leftTitle = NposUi.caption(this, getString(R.string.shift_nav_title));
    leftTitle.setPadding(0, 0, 0, ui.dp(10));
    left.addView(leftTitle);

    navDash = navItem(getString(R.string.shift_nav_dashboard), true);
    navDash.setOnClickListener(v -> showTab(TAB_DASH));
    left.addView(navDash);

    navHistory = navItem(getString(R.string.shift_nav_history), false);
    navHistory.setOnClickListener(v -> showTab(TAB_HISTORY));
    left.addView(navHistory);

    TextView drop = NposUi.secondary(this, getString(R.string.shift_cash_drop_btn));
    drop.setLayoutParams(matchRow(ui, 12));
    drop.setOnClickListener(v -> askCashDrop());
    left.addView(drop);

    TextView x = NposUi.secondary(this, getString(R.string.btn_x_report));
    x.setLayoutParams(matchRow(ui, 8));
    x.setOnClickListener(
        v -> {
          Toast.makeText(this, R.string.sell_printing_x, Toast.LENGTH_SHORT).show();
          saleSync.printShiftReport(
              this,
              "snapshot",
              () ->
                  runOnUiThread(
                      () -> Toast.makeText(this, R.string.sell_x_printed, Toast.LENGTH_SHORT).show()));
        });
    left.addView(x);

    TextView z = NposUi.primary(this, getString(R.string.btn_close_shift));
    z.setLayoutParams(matchRow(ui, 8));
    z.setOnClickListener(v -> closeShift());
    left.addView(z);

    // Right ~70%: dashboard / history
    LinearLayout right = new LinearLayout(this);
    right.setOrientation(LinearLayout.VERTICAL);
    right.setLayoutParams(
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 70f));

    staffLine = NposUi.body(this, "");
    staffLine.setTypeface(NposFonts.semibold(this));
    staffLine.setTextColor(NposUi.color(this, R.color.npos_ink));
    staffLine.setPadding(ui.dp(4), 0, ui.dp(4), ui.dp(8));
    right.addView(staffLine);

    dashHost = new LinearLayout(this);
    dashHost.setOrientation(LinearLayout.VERTICAL);
    ScrollView dashScroll = new ScrollView(this);
    dashScroll.setFillViewport(true);
    LinearLayout dashInner = new LinearLayout(this);
    dashInner.setOrientation(LinearLayout.VERTICAL);
    cashCardBody = addDashCard(dashInner, getString(R.string.shift_card_cash_title), ui);
    transferCardBody = addDashCard(dashInner, getString(R.string.shift_card_transfer_title), ui);
    summaryCardBody = addDashCard(dashInner, getString(R.string.shift_card_summary_title), ui);
    dashScroll.addView(dashInner);
    dashHost.addView(
        dashScroll,
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
    right.addView(
        dashHost,
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));

    historyHost = new LinearLayout(this);
    historyHost.setOrientation(LinearLayout.VERTICAL);
    historyHost.setVisibility(View.GONE);
    ScrollView histScroll = new ScrollView(this);
    histScroll.setFillViewport(true);
    LinearLayout histList = new LinearLayout(this);
    histList.setOrientation(LinearLayout.VERTICAL);
    histList.setId(View.generateViewId());
    histScroll.addView(histList);
    historyHost.setTag(histList);
    historyHost.addView(
        histScroll,
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
    right.addView(
        historyHost,
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));

    split.addView(left);
    split.addView(right);
    page.addView(
        split,
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
    setContentView(page);
    NposFonts.applyActivity(this);
    refreshDashboard();
    refreshHistory();
  }

  private TextView navItem(String label, boolean active) {
    TextView tv = NposUi.body(this, label);
    tv.setTypeface(NposFonts.semibold(this));
    tv.setMinHeight(UiScale.from(this).touchMinPx);
    tv.setGravity(Gravity.CENTER_VERTICAL);
    tv.setPadding(NposUi.dp(this, 10), NposUi.dp(this, 10), NposUi.dp(this, 10), NposUi.dp(this, 10));
    styleNav(tv, active);
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = NposUi.dp(this, 6);
    tv.setLayoutParams(lp);
    return tv;
  }

  private void styleNav(TextView tv, boolean active) {
    if (active) {
      tv.setBackgroundColor(NposUi.color(this, R.color.npos_orange_soft));
      tv.setTextColor(NposUi.color(this, R.color.npos_orange));
    } else {
      tv.setBackgroundColor(0x00000000);
      tv.setTextColor(NposUi.color(this, R.color.npos_ink));
    }
  }

  private void showTab(int tab) {
    activeTab = tab;
    boolean dash = tab == TAB_DASH;
    dashHost.setVisibility(dash ? View.VISIBLE : View.GONE);
    historyHost.setVisibility(dash ? View.GONE : View.VISIBLE);
    styleNav(navDash, dash);
    styleNav(navHistory, !dash);
    if (!dash) refreshHistory();
  }

  private TextView addDashCard(LinearLayout parent, String title, UiScale ui) {
    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setBackgroundColor(NposUi.color(this, R.color.npos_surface));
    card.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = ui.dp(10);
    card.setLayoutParams(lp);

    TextView h = NposUi.section(this, title);
    h.setPadding(0, 0, 0, ui.dp(6));
    card.addView(h);

    TextView body = NposUi.body(this, "");
    body.setTypeface(NposFonts.medium(this));
    body.setTextColor(NposUi.color(this, R.color.npos_ink));
    body.setLineSpacing(0f, 1.25f);
    card.addView(body);
    parent.addView(card);
    return body;
  }

  private static LinearLayout.LayoutParams matchRow(UiScale ui, int topDp) {
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.topMargin = ui.dp(topDp);
    return lp;
  }

  private void refreshDashboard() {
    String staff = loadStaffName();
    String device = DeviceIdentity.pairingCode(this);
    if (!ShiftPrefs.isOpen(this)) {
      staffLine.setText(
          getString(R.string.shift_staff_line, staff.isEmpty() ? "—" : staff, device)
              + "\n"
              + getString(R.string.shift_panel_status_closed));
      if (cashCardBody != null) cashCardBody.setText("—");
      if (transferCardBody != null) transferCardBody.setText("—");
      if (summaryCardBody != null) summaryCardBody.setText("—");
      return;
    }

    long opened = ShiftPrefs.openedAt(this);
    SimpleDateFormat when = new SimpleDateFormat("d MMM HH:mm", Locale.getDefault());
    String openedAt = opened > 0 ? when.format(new Date(opened)) : "—";
    String duration = formatElapsed(opened);

    staffLine.setText(
        getString(R.string.shift_staff_line, staff.isEmpty() ? "—" : staff, device)
            + "\n"
            + getString(R.string.shift_panel_opened_at, openedAt)
            + " · "
            + getString(R.string.shift_panel_duration, duration));

    double cash = ShiftPrefs.cashTotal(this);
    double opening = ShiftPrefs.openingCash(this);
    double expected = ShiftPrefs.expectedCash(this);
    double drop = ShiftPrefs.cashOutTotal(this);
    cashCardBody.setText(
        getString(R.string.shift_panel_opening, ShiftPrefs.moneyPlain(opening))
            + "\n"
            + getString(
                R.string.shift_panel_cash,
                ShiftPrefs.cashBillCount(this),
                ShiftPrefs.moneyPlain(cash))
            + "\n"
            + getString(
                R.string.shift_panel_cash_drop,
                ShiftPrefs.moneyPlain(drop),
                ShiftPrefs.cashDropCount(this))
            + ShiftPrefs.cashDropNotesSummary(this)
            + "\n"
            + getString(R.string.shift_panel_expected, ShiftPrefs.moneyPlain(expected)));

    double transfer = ShiftPrefs.transferTotal(this);
    double pp = ShiftPrefs.promptpayTotal(this);
    transferCardBody.setText(
        getString(
                R.string.shift_panel_transfer,
                ShiftPrefs.transferBillCount(this),
                ShiftPrefs.moneyPlain(transfer))
            + (pp > 0.009
                ? "\n"
                    + getString(
                        R.string.shift_panel_pp,
                        ShiftPrefs.promptpayBillCount(this),
                        ShiftPrefs.moneyPlain(pp))
                : ""));

    SaleSync.VoidSessionStats voids = saleSync.voidSessionStats(this);
    double net = cash + pp + transfer;
    String reasons =
        voids.reasonsText.isEmpty()
            ? getString(R.string.shift_panel_void_none)
            : voids.reasonsText;
    summaryCardBody.setText(
        getString(R.string.shift_panel_net, ShiftPrefs.moneyPlain(net))
            + "\n"
            + getString(R.string.shift_orders_fmt, ShiftPrefs.saleCount(this))
            + "\n"
            + getString(
                R.string.shift_panel_discount,
                ShiftPrefs.moneyPlain(ShiftPrefs.discountTotal(this)))
            + "\n"
            + getString(
                R.string.shift_panel_void, voids.count, ShiftPrefs.moneyPlain(voids.amount))
            + "\n"
            + getString(R.string.shift_panel_void_reasons, reasons));
  }

  private void refreshHistory() {
    Object tag = historyHost.getTag();
    if (!(tag instanceof LinearLayout)) return;
    LinearLayout list = (LinearLayout) tag;
    list.removeAllViews();
    List<JSONObject> rows = SessionHistory.listNewestFirst(this);
    if (rows.isEmpty()) {
      TextView empty = NposUi.caption(this, getString(R.string.shift_history_empty));
      empty.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 16), NposUi.dp(this, 8), 0);
      list.addView(empty);
      return;
    }
    SimpleDateFormat when = new SimpleDateFormat("d MMM HH:mm", Locale.getDefault());
    UiScale ui = UiScale.from(this);
    for (JSONObject row : rows) {
      LinearLayout card = new LinearLayout(this);
      card.setOrientation(LinearLayout.VERTICAL);
      card.setBackgroundColor(NposUi.color(this, R.color.npos_surface));
      card.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10));
      LinearLayout.LayoutParams lp =
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
      lp.bottomMargin = ui.dp(8);
      card.setLayoutParams(lp);

      long openedAt = row.optLong("openedAt", 0L);
      long closedAt = row.optLong("closedAt", 0L);
      String sid = row.optString("sessionId", "");
      String shortId =
          sid.length() >= 6 ? sid.substring(sid.length() - 6).toUpperCase(Locale.US) : sid;
      TextView title = NposUi.section(this, getString(R.string.shift_history_id, shortId));
      card.addView(title);

      TextView meta =
          NposUi.caption(
              this,
              when.format(new Date(openedAt))
                  + " → "
                  + when.format(new Date(closedAt))
                  + "\n"
                  + getString(
                      R.string.shift_history_meta,
                      ShiftPrefs.moneyPlain(row.optDouble("cashSales", 0)
                          + row.optDouble("transferSales", 0)
                          + row.optDouble("promptpaySales", 0)),
                      row.optInt("saleCount", 0),
                      row.optString("discrepancyLabel", "—"),
                      ShiftPrefs.moneyPlain(Math.abs(row.optDouble("cashDifference", 0)))));
      meta.setPadding(0, ui.dp(4), 0, 0);
      card.addView(meta);
      list.addView(card);
    }
  }

  private String loadStaffName() {
    try {
      String raw =
          getSharedPreferences("npos_menu", MODE_PRIVATE).getString("shopJson", "{}");
      return new JSONObject(raw == null ? "{}" : raw).optString("receiptStaffName", "").trim();
    } catch (Exception e) {
      return "";
    }
  }

  private static String formatElapsed(long openedAt) {
    if (openedAt <= 0L) return "—";
    long elapsedSec = Math.max(0L, (System.currentTimeMillis() - openedAt) / 1000L);
    long h = elapsedSec / 3600L;
    long m = (elapsedSec % 3600L) / 60L;
    long s = elapsedSec % 60L;
    if (h > 0) {
      return String.format(Locale.getDefault(), "%d:%02d:%02d", h, m, s);
    }
    return String.format(Locale.getDefault(), "%02d:%02d", m, s);
  }

  private void askCashDrop() {
    if (!ShiftPrefs.isOpen(this)) {
      Toast.makeText(this, R.string.shift_cash_drop_need_open, Toast.LENGTH_SHORT).show();
      return;
    }
    UiScale ui = UiScale.from(this);
    int chrome = NposNumberPad.CHROME_STANDARD_DP;
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, ui.dp(4), pad, 0);

    TextView hint = NposUi.caption(this, getString(R.string.shift_cash_drop_hint));
    hint.setPadding(0, 0, 0, ui.dp(6));
    box.addView(hint);

    final String[] valueHolder = {""};
    TextView amount = NposUi.title(this, "฿0");
    amount.setGravity(Gravity.CENTER);
    amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(20f, ui.titleSp + 6f));
    amount.setTypeface(NposFonts.semibold(this));
    amount.setMinHeight(ui.padAmountMinPx(chrome));
    amount.setPadding(0, ui.dp(4), 0, ui.dp(6));
    box.addView(amount);

    TextView reasonLabel = NposUi.caption(this, getString(R.string.shift_cash_drop_reason_label));
    reasonLabel.setPadding(0, ui.dp(4), 0, ui.dp(4));
    box.addView(reasonLabel);
    EditText reason = NposUi.field(this);
    reason.setInputType(
        InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    reason.setHint(R.string.shift_cash_drop_reason_hint);
    reason.setMinLines(2);
    reason.setMaxLines(3);
    box.addView(reason);

    box.addView(
        NposNumberPad.attach(
            this,
            new NposNumberPad.Listener() {
              @Override
              public void onDigit(String digit) {
                NposNumberPad.applyKey(valueHolder, digit, false, 9);
                amount.setText(formatBaht(valueHolder[0]));
              }

              @Override
              public void onBackspace() {
                NposNumberPad.applyKey(valueHolder, null, true, 9);
                amount.setText(formatBaht(valueHolder[0]));
              }
            },
            true,
            chrome));

    NposConfirmDialog.custom(
        this,
        getString(R.string.shift_cash_drop_title),
        box,
        getString(R.string.shift_cash_drop_confirm),
        () -> {
          double amt = parseMoney(valueHolder[0]);
          if (amt <= 0) {
            Toast.makeText(this, R.string.shift_cash_drop_invalid, Toast.LENGTH_SHORT).show();
            return false;
          }
          String note = reason.getText().toString().trim();
          if (note.isEmpty()) {
            Toast.makeText(this, R.string.shift_cash_drop_reason_required, Toast.LENGTH_SHORT)
                .show();
            reason.requestFocus();
            return false;
          }
          ShiftPrefs.recordCashDrop(this, amt, note);
          Toast.makeText(
                  this,
                  getString(R.string.shift_cash_drop_ok, ShiftPrefs.moneyPlain(amt)),
                  Toast.LENGTH_SHORT)
              .show();
          refreshDashboard();
          return true;
        },
        null);
  }

  private static String formatBaht(String raw) {
    if (raw == null || raw.trim().isEmpty()) return "฿0";
    return String.format(Locale.getDefault(), "฿%.0f", parseMoney(raw));
  }

  private static double parseMoney(String raw) {
    if (raw == null) return 0;
    String s = raw.trim().replace(",", "");
    if (s.isEmpty()) return 0;
    try {
      return Math.max(0, Double.parseDouble(s));
    } catch (Exception e) {
      return 0;
    }
  }

  private void closeShift() {
    BlindCloseFlow.start(
        this,
        saleSync,
        () -> {
          Intent i = new Intent(this, MainActivity.class);
          i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
          startActivity(i);
          finish();
        });
  }

  @Override
  protected void onResume() {
    super.onResume();
    dutyHandler.removeCallbacks(dutyTick);
    refreshDashboard();
    if (activeTab == TAB_HISTORY) refreshHistory();
    if (ShiftPrefs.isOpen(this)) {
      dutyHandler.postDelayed(dutyTick, 1000L);
    }
  }

  @Override
  protected void onPause() {
    dutyHandler.removeCallbacks(dutyTick);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    dutyHandler.removeCallbacks(dutyTick);
    saleSync.shutdown();
    super.onDestroy();
  }
}
