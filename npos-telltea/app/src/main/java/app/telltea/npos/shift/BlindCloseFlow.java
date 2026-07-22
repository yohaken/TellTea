package app.telltea.npos.shift;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.Locale;

import org.json.JSONObject;

import app.telltea.npos.R;
import app.telltea.npos.sell.SaleSync;
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
    List<JSONObject> pending = saleSync.listPending(activity);
    if (pending != null && !pending.isEmpty()) {
      new AlertDialog.Builder(activity)
          .setTitle(R.string.blind_close_pending_title)
          .setMessage(activity.getString(R.string.blind_close_pending_msg, pending.size()))
          .setPositiveButton(
              R.string.outbox_sync_all,
              (d, w) -> {
                saleSync.flushPending(activity);
                Toast.makeText(activity, R.string.blind_close_pending_retry, Toast.LENGTH_LONG)
                    .show();
              })
          .setNegativeButton(android.R.string.cancel, null)
          .show();
      return;
    }
    askCountedCash(activity, saleSync, done);
  }

  private static void askCountedCash(Activity activity, SaleSync saleSync, Done done) {
    UiScale ui = UiScale.from(activity);
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(16);
    box.setPadding(pad, pad, pad, pad);

    TextView hint = new TextView(activity);
    hint.setText(R.string.blind_close_count_hint);
    hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
    hint.setTextColor(0xFF4B5563);
    hint.setPadding(0, 0, 0, ui.dp(10));
    box.addView(hint);

    EditText count = moneyField(activity, ui);
    count.setHint(R.string.blind_close_count_hint_field);
    box.addView(count);

    new AlertDialog.Builder(activity)
        .setTitle(R.string.blind_close_count_title)
        .setView(box)
        .setPositiveButton(
            R.string.blind_close_next,
            (d, w) -> {
              double counted = parseMoney(count.getText().toString());
              askNoteAndFloat(activity, saleSync, done, counted);
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private static void askNoteAndFloat(
      Activity activity, SaleSync saleSync, Done done, double counted) {
    UiScale ui = UiScale.from(activity);
    // Keep blind: do not compute or hint expected/diff until revealSummary.
    double opening = ShiftPrefs.openingCash(activity);
    double cashSales = ShiftPrefs.cashTotal(activity);

    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(16);
    box.setPadding(pad, pad, pad, pad);

    TextView floatLabel = new TextView(activity);
    floatLabel.setText(R.string.blind_close_leave_float);
    floatLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.captionSp);
    floatLabel.setTextColor(0xFF4B5563);
    box.addView(floatLabel);

    EditText leave = moneyField(activity, ui);
    leave.setHint("0");
    leave.setText("0");
    box.addView(leave);

    TextView noteLabel = new TextView(activity);
    noteLabel.setText(R.string.blind_close_note_optional);
    noteLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.captionSp);
    noteLabel.setTextColor(0xFF4B5563);
    noteLabel.setPadding(0, ui.dp(10), 0, ui.dp(4));
    box.addView(noteLabel);

    EditText note = new EditText(activity);
    note.setHint(R.string.blind_close_note_hint);
    note.setMinHeight(ui.touchMinPx);
    note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    box.addView(note);

    new AlertDialog.Builder(activity)
        .setTitle(R.string.blind_close_extra_title)
        .setView(box)
        .setPositiveButton(
            R.string.blind_close_next,
            (d, w) -> {
              BlindCloseReport report =
                  new BlindCloseReport(
                      opening,
                      cashSales,
                      ShiftPrefs.promptpayTotal(activity),
                      ShiftPrefs.cashBillCount(activity),
                      ShiftPrefs.promptpayBillCount(activity),
                      ShiftPrefs.saleCount(activity),
                      ShiftPrefs.voidedCount(activity),
                      ShiftPrefs.discountTotal(activity),
                      counted,
                      parseMoney(leave.getText().toString()),
                      note.getText() == null ? "" : note.getText().toString());
              revealSummary(activity, saleSync, done, report);
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private static void revealSummary(
      Activity activity, SaleSync saleSync, Done done, BlindCloseReport report) {
    UiScale ui = UiScale.from(activity);
    ScrollView scroll = new ScrollView(activity);
    TextView body = new TextView(activity);
    body.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
    body.setTextColor(0xFF15202B);
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
            report.discountTotal,
            report.voidedCount,
            report.openingCash,
            report.expectedCash,
            report.countedCash,
            report.discrepancyLabel(),
            report.cashDifference,
            report.leaveFloat,
            report.discrepancyNote.isEmpty() ? "—" : report.discrepancyNote));
    scroll.addView(body);

    new AlertDialog.Builder(activity)
        .setTitle(R.string.blind_close_confirm_title)
        .setView(scroll)
        .setPositiveButton(
            R.string.blind_close_confirm_btn,
            (d, w) -> {
              Toast.makeText(activity, R.string.sell_closing_shift, Toast.LENGTH_SHORT).show();
              saleSync.printShiftReport(
                  activity,
                  "close",
                  report,
                  () ->
                      saleSync.closeSession(
                          activity,
                          report,
                          () ->
                              activity.runOnUiThread(
                                  () -> {
                                    Toast.makeText(
                                            activity, R.string.shift_closed, Toast.LENGTH_SHORT)
                                        .show();
                                    if (done != null) done.onClosed();
                                  })));
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private static EditText moneyField(Activity activity, UiScale ui) {
    EditText ed = new EditText(activity);
    ed.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    ed.setMinHeight(ui.paySecondaryMinPx);
    ed.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 2f);
    ed.setGravity(Gravity.CENTER);
    ed.setBackgroundResource(R.drawable.npos_touch_ghost);
    ed.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10));
    return ed;
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
