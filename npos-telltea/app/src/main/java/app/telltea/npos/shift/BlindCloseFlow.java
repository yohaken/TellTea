package app.telltea.npos.shift;

import android.app.Activity;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

import app.telltea.npos.R;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposNumberPad;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Wongnai-style blind close on native POS:
 * count cash first (no expected) → optional note/float → reveal summary → print + sync.
 */
public final class BlindCloseFlow {
  public interface Done {
    void onClosed();
  }

  private BlindCloseFlow() {}

  public static void start(Activity activity, SaleSync saleSync, Done done) {
    if (activity == null || saleSync == null) return;
    if (!ShiftPrefs.isOpen(activity)) {
      Toast.makeText(activity, R.string.shift_closed, Toast.LENGTH_SHORT).show();
      return;
    }
    // Do not block on outbox / heartbeat countdown — flush happens inside close.
    askCountedCash(activity, saleSync, done);
  }

  private static void askCountedCash(Activity activity, SaleSync saleSync, Done done) {
    UiScale ui = UiScale.from(activity);
    int chrome = NposNumberPad.CHROME_STANDARD_DP;
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, ui.dp(4), pad, 0);

    TextView hint = NposUi.caption(activity, activity.getString(R.string.blind_close_count_hint));
    hint.setPadding(0, 0, 0, ui.dp(6));
    box.addView(hint);

    final String[] valueHolder = {""};
    TextView amount = moneyDisplay(activity, ui, "฿0", chrome);
    box.addView(amount);
    box.addView(moneyPad(activity, valueHolder, amount, chrome));

    NposConfirmDialog.custom(
        activity,
        activity.getString(R.string.blind_close_count_title),
        box,
        activity.getString(R.string.blind_close_next),
        () -> {
          askNoteAndFloat(activity, saleSync, done, parseMoney(valueHolder[0]));
          return true;
        },
        null);
  }

  private static void askNoteAndFloat(
      Activity activity, SaleSync saleSync, Done done, double counted) {
    UiScale ui = UiScale.from(activity);
    // Keep blind: do not compute or hint expected/diff until revealSummary.
    double opening = ShiftPrefs.openingCash(activity);
    double cashSales = ShiftPrefs.cashTotal(activity);
    // Seed leave float from this shift's opening (Wongnai: leave float for next shift).
    double leaveSeed = Math.min(opening, Math.max(0, counted));

    int chrome = NposNumberPad.CHROME_FLOAT_NOTE_DP;
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, ui.dp(4), pad, 0);

    TextView floatLabel = NposUi.caption(activity, activity.getString(R.string.blind_close_leave_float));
    box.addView(floatLabel);

    final String[] leaveHolder = {ShiftPrefs.moneyPlain(leaveSeed)};
    TextView leaveAmount = moneyDisplay(activity, ui, formatBaht(leaveHolder[0]), chrome);
    box.addView(leaveAmount);
    box.addView(moneyPad(activity, leaveHolder, leaveAmount, chrome));

    TextView noteLabel = NposUi.caption(activity, activity.getString(R.string.blind_close_note_optional));
    noteLabel.setPadding(0, ui.dp(8), 0, ui.dp(4));
    box.addView(noteLabel);

    EditText note = NposUi.field(activity);
    note.setHint(R.string.blind_close_note_hint);
    note.setMinHeight(ui.touchMinPx);
    note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    box.addView(note);

    // Nested scroll OK here — note field can grow; dialog still fitCardToWindow.
    ScrollView scroll = new ScrollView(activity);
    scroll.addView(box);

    NposConfirmDialog.custom(
        activity,
        activity.getString(R.string.blind_close_extra_title),
        scroll,
        activity.getString(R.string.blind_close_next),
        () -> {
          double leaveAmt = parseMoney(leaveHolder[0]);
          if (leaveAmt > counted + 0.009) {
            Toast.makeText(activity, R.string.blind_close_leave_too_high, Toast.LENGTH_LONG)
                .show();
            askNoteAndFloat(activity, saleSync, done, counted);
            return true;
          }
          BlindCloseReport report =
              new BlindCloseReport(
                  opening,
                  cashSales,
                  ShiftPrefs.promptpayTotal(activity),
                  ShiftPrefs.transferTotal(activity),
                  ShiftPrefs.cashBillCount(activity),
                  ShiftPrefs.promptpayBillCount(activity),
                  ShiftPrefs.transferBillCount(activity),
                  ShiftPrefs.saleCount(activity),
                  ShiftPrefs.voidedCount(activity),
                  ShiftPrefs.discountTotal(activity),
                  ShiftPrefs.cashOutTotal(activity),
                  ShiftPrefs.cashInTotal(activity),
                  ShiftPrefs.cashDropCount(activity),
                  counted,
                  leaveAmt,
                  note.getText() == null ? "" : note.getText().toString());
          revealSummary(activity, saleSync, done, report);
          return true;
        },
        null);
  }

  private static void revealSummary(
      Activity activity, SaleSync saleSync, Done done, BlindCloseReport report) {
    UiScale ui = UiScale.from(activity);
    ScrollView scroll = new ScrollView(activity);
    TextView body = NposUi.body(activity, "");
    body.setTextColor(NposUi.color(activity, R.color.npos_ink));
    body.setTypeface(NposFonts.regular(activity));
    body.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
    body.setPadding(ui.dp(16), ui.dp(12), ui.dp(16), ui.dp(12));
    body.setText(
        String.format(
            Locale.getDefault(),
            activity.getString(R.string.blind_close_summary_fmt),
            report.saleCount,
            report.cashBills,
            report.cashSales,
            report.promptpayBills,
            report.promptpaySales,
            report.transferBills,
            report.transferSales,
            report.discountTotal,
            report.voidedCount,
            report.openingCash,
            report.cashOutTotal,
            report.cashDropCount,
            report.expectedCash,
            report.countedCash,
            report.discrepancyLabel(),
            report.cashDifference,
            report.leaveFloat,
            report.discrepancyNote.isEmpty() ? "—" : report.discrepancyNote));
    scroll.addView(body);

    NposConfirmDialog.custom(
        activity,
        activity.getString(R.string.blind_close_confirm_title),
        scroll,
        activity.getString(R.string.blind_close_confirm_btn),
        () -> {
          Toast.makeText(activity, R.string.sell_closing_shift, Toast.LENGTH_SHORT).show();
          saleSync.printShiftReport(
              activity,
              "close",
              report,
              () ->
                  saleSync.flushThenCloseSession(
                      activity,
                      report,
                      ok ->
                          activity.runOnUiThread(
                              () -> {
                                if (ok) {
                                  Toast.makeText(
                                          activity, R.string.shift_closed, Toast.LENGTH_SHORT)
                                      .show();
                                  if (done != null) done.onClosed();
                                } else if (SaleSync.hasUnsyncedWork(activity)) {
                                  Toast.makeText(
                                          activity,
                                          R.string.blind_close_sync_required,
                                          Toast.LENGTH_LONG)
                                      .show();
                                } else {
                                  Toast.makeText(
                                          activity,
                                          R.string.blind_close_server_failed,
                                          Toast.LENGTH_LONG)
                                      .show();
                                }
                              })));
          return true;
        },
        null);
  }

  private static TextView moneyDisplay(
      Activity activity, UiScale ui, CharSequence seed, int chromeDp) {
    TextView amount = NposUi.title(activity, seed);
    amount.setGravity(Gravity.CENTER);
    amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(20f, ui.titleSp + 6f));
    amount.setTypeface(NposFonts.semibold(activity));
    amount.setMinHeight(ui.padAmountMinPx(chromeDp));
    amount.setPadding(0, ui.dp(4), 0, ui.dp(6));
    return amount;
  }

  private static LinearLayout moneyPad(
      Activity activity, String[] valueHolder, TextView amountView, int chromeDp) {
    return NposNumberPad.attach(
        activity,
        new NposNumberPad.Listener() {
          @Override
          public void onDigit(String digit) {
            NposNumberPad.applyKey(valueHolder, digit, false, 9);
            amountView.setText(formatBaht(valueHolder[0]));
          }

          @Override
          public void onBackspace() {
            NposNumberPad.applyKey(valueHolder, null, true, 9);
            amountView.setText(formatBaht(valueHolder[0]));
          }
        },
        true,
        chromeDp);
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
}
