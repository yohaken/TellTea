package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposNumberPad;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Mid-shift overview — duration, payments, voids, cash drop, X-report, close.
 */
public class ShiftActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private final Handler dutyHandler = new Handler(Looper.getMainLooper());
  private TextView overviewView;
  private final Runnable dutyTick =
      new Runnable() {
        @Override
        public void run() {
          refreshOverview();
          if (ShiftPrefs.isOpen(ShiftActivity.this)) {
            dutyHandler.postDelayed(this, 1000L);
          }
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout root = NposUi.pageColumn(this);
    root.addView(NposUi.headerBar(this, getString(R.string.nav_shift)));

    overviewView = NposUi.body(this, "");
    overviewView.setTextColor(NposUi.color(this, R.color.npos_ink));
    overviewView.setTypeface(NposFonts.medium(this));
    overviewView.setPadding(0, NposUi.dp(this, 12), 0, NposUi.dp(this, 16));
    root.addView(overviewView);

    TextView drop = NposUi.secondary(this, getString(R.string.shift_cash_drop_btn));
    drop.setLayoutParams(NposUi.cta(this, 10));
    drop.setOnClickListener(v -> askCashDrop());
    root.addView(drop);

    TextView x = NposUi.secondary(this, getString(R.string.btn_x_report));
    x.setLayoutParams(NposUi.cta(this, 10));
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
    root.addView(x);

    TextView z = NposUi.primary(this, getString(R.string.btn_close_shift));
    z.setLayoutParams(NposUi.cta(this, 0));
    z.setOnClickListener(v -> closeShift());
    root.addView(z);

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    scroll.addView(root);
    setContentView(scroll);
    NposFonts.applyActivity(this);
    refreshOverview();
  }

  private void refreshOverview() {
    if (overviewView == null) return;
    if (!ShiftPrefs.isOpen(this)) {
      overviewView.setText(getString(R.string.shift_panel_status_closed));
      return;
    }

    long opened = ShiftPrefs.openedAt(this);
    SimpleDateFormat when = new SimpleDateFormat("d MMM HH:mm", Locale.getDefault());
    String openedAt = opened > 0 ? when.format(new Date(opened)) : "—";
    String duration = formatElapsed(opened);

    double cash = ShiftPrefs.cashTotal(this);
    double pp = ShiftPrefs.promptpayTotal(this);
    double transfer = ShiftPrefs.transferTotal(this);
    double net = cash + pp + transfer;
    SaleSync.VoidSessionStats voids = saleSync.voidSessionStats(this);
    String reasons =
        voids.reasonsText.isEmpty()
            ? getString(R.string.shift_panel_void_none)
            : voids.reasonsText;

    StringBuilder sb = new StringBuilder();
    sb.append(getString(R.string.shift_panel_status_open)).append('\n');
    sb.append(getString(R.string.shift_panel_opened_at, openedAt)).append('\n');
    sb.append(getString(R.string.shift_panel_duration, duration)).append('\n');
    sb.append(getString(R.string.shift_panel_opening, ShiftPrefs.moneyPlain(ShiftPrefs.openingCash(this))))
        .append('\n');
    sb.append(
            getString(
                R.string.shift_panel_cash,
                ShiftPrefs.cashBillCount(this),
                ShiftPrefs.moneyPlain(cash)))
        .append('\n');
    sb.append(
            getString(
                R.string.shift_panel_pp,
                ShiftPrefs.promptpayBillCount(this),
                ShiftPrefs.moneyPlain(pp)))
        .append('\n');
    sb.append(
            getString(
                R.string.shift_panel_transfer,
                ShiftPrefs.transferBillCount(this),
                ShiftPrefs.moneyPlain(transfer)))
        .append('\n');
    sb.append(getString(R.string.shift_panel_net, ShiftPrefs.moneyPlain(net))).append('\n');
    sb.append(
            getString(
                R.string.shift_panel_discount,
                ShiftPrefs.moneyPlain(ShiftPrefs.discountTotal(this))))
        .append('\n');
    sb.append(
            getString(
                R.string.shift_panel_void,
                voids.count,
                ShiftPrefs.moneyPlain(voids.amount)))
        .append('\n');
    sb.append(getString(R.string.shift_panel_void_reasons, reasons)).append('\n');
    sb.append(
            getString(
                R.string.shift_panel_cash_drop,
                ShiftPrefs.moneyPlain(ShiftPrefs.cashOutTotal(this)),
                ShiftPrefs.cashDropCount(this)))
        .append('\n');
    sb.append(
        getString(
            R.string.shift_panel_expected,
            ShiftPrefs.moneyPlain(ShiftPrefs.expectedCash(this))));
    overviewView.setText(sb.toString());
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
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(16);
    box.setPadding(pad, pad, pad, pad);

    TextView hint = NposUi.caption(this, getString(R.string.shift_cash_drop_hint));
    hint.setPadding(0, 0, 0, ui.dp(10));
    box.addView(hint);

    final String[] valueHolder = {""};
    TextView amount = NposUi.title(this, "฿0");
    amount.setGravity(Gravity.CENTER);
    amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 8f);
    amount.setTypeface(NposFonts.semibold(this));
    amount.setMinHeight(ui.payPrimaryMinPx);
    amount.setPadding(0, ui.dp(8), 0, ui.dp(12));
    box.addView(amount);
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
            }));

    ScrollView scroll = new ScrollView(this);
    scroll.addView(box);

    NposConfirmDialog.custom(
        this,
        getString(R.string.shift_cash_drop_title),
        scroll,
        getString(R.string.shift_cash_drop_confirm),
        () -> {
          double amt = parseMoney(valueHolder[0]);
          if (amt <= 0) {
            Toast.makeText(this, R.string.shift_cash_drop_invalid, Toast.LENGTH_SHORT).show();
            return false;
          }
          ShiftPrefs.recordCashDrop(this, amt);
          Toast.makeText(
                  this,
                  getString(R.string.shift_cash_drop_ok, ShiftPrefs.moneyPlain(amt)),
                  Toast.LENGTH_SHORT)
              .show();
          refreshOverview();
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
    refreshOverview();
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
