package app.telltea.npos.shift;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import app.telltea.npos.R;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Confirm opening float before openSession — passes amount explicitly (no prefs race).
 */
public final class OpenShiftFlow {
  public interface Done {
    void onOpened();
  }

  private OpenShiftFlow() {}

  public static void start(Activity activity, SaleSync saleSync, Done done) {
    start(activity, saleSync, done, null);
  }

  public static void start(Activity activity, SaleSync saleSync, Done done, Runnable onCancel) {
    if (activity == null || saleSync == null) {
      if (onCancel != null) onCancel.run();
      return;
    }
    if (ShiftPrefs.isOpen(activity)) {
      Toast.makeText(activity, R.string.shift_opened, Toast.LENGTH_SHORT).show();
      if (done != null) done.onOpened();
      return;
    }
    askOpeningFloat(activity, saleSync, done, onCancel);
  }

  private static void askOpeningFloat(
      Activity activity, SaleSync saleSync, Done done, Runnable onCancel) {
    UiScale ui = UiScale.from(activity);
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(16);
    box.setPadding(pad, pad, pad, pad);

    TextView hint = NposUi.caption(activity, activity.getString(R.string.open_shift_float_hint));
    hint.setPadding(0, 0, 0, ui.dp(10));
    box.addView(hint);

    EditText field = NposUi.field(activity);
    field.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    field.setMinHeight(ui.paySecondaryMinPx);
    field.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 1f);
    field.setGravity(Gravity.CENTER);
    field.setTypeface(NposFonts.semibold(activity));
    double seed = ShiftPrefs.nextOpeningCash(activity);
    field.setText(ShiftPrefs.moneyPlain(seed));
    field.setHint(R.string.open_shift_float_hint_field);
    field.selectAll();
    box.addView(field);

    new AlertDialog.Builder(activity)
        .setTitle(R.string.open_shift_float_title)
        .setView(box)
        .setCancelable(true)
        .setPositiveButton(
            R.string.open_shift_float_confirm,
            (d, w) -> {
              double amount = parseMoney(field.getText() == null ? "" : field.getText().toString());
              amount = Math.max(0, amount);
              Toast.makeText(activity, R.string.shift_opening, Toast.LENGTH_SHORT).show();
              saleSync.openSession(
                  activity,
                  amount,
                  () ->
                      activity.runOnUiThread(
                          () -> {
                            if (activity.isFinishing()) return;
                            try {
                              if (!ShiftPrefs.isOpen(activity)) {
                                Toast.makeText(
                                        activity,
                                        R.string.store_claim_blocked,
                                        Toast.LENGTH_LONG)
                                    .show();
                                if (onCancel != null) onCancel.run();
                                return;
                              }
                              Toast.makeText(
                                      activity,
                                      ShiftPrefs.consumeLastResumed(activity)
                                          ? R.string.shift_resumed
                                          : R.string.shift_opened,
                                      Toast.LENGTH_SHORT)
                                  .show();
                              if (done != null) done.onOpened();
                            } catch (Exception e) {
                              OpsLogger.error(
                                  activity,
                                  "shift",
                                  "เปิดกะ UI ล้ม",
                                  e.getMessage() == null ? "" : e.getMessage());
                              if (ShiftPrefs.isOpen(activity) && done != null) {
                                try {
                                  done.onOpened();
                                } catch (Exception ignored) {
                                  /* hub update best-effort */
                                }
                              } else if (onCancel != null) {
                                onCancel.run();
                              }
                            }
                          }));
            })
        .setNegativeButton(
            android.R.string.cancel,
            (d, w) -> {
              if (onCancel != null) onCancel.run();
            })
        .setOnCancelListener(
            d -> {
              if (onCancel != null) onCancel.run();
            })
        .show();
  }

  private static double parseMoney(String raw) {
    if (raw == null) return 0;
    String s = raw.trim().replace(",", "");
    if (s.isEmpty()) return 0;
    try {
      return Double.parseDouble(s);
    } catch (Exception e) {
      return 0;
    }
  }
}
