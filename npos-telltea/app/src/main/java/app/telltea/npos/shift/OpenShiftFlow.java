package app.telltea.npos.shift;

import android.app.Activity;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

import app.telltea.npos.R;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposNumberPad;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;

/**
 * Confirm opening float + pick who opened (employee roster) before openSession.
 * Roster is from shop settings — not linked to OT shift table.
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
    // Refresh shop/roster cache before picker (best-effort).
    try {
      new MenuRepository().loadShop(activity, shop -> {});
    } catch (Exception ignored) {
      /* optional */
    }
    askOpeningFloat(activity, saleSync, done, onCancel);
  }

  private static void askOpeningFloat(
      Activity activity, SaleSync saleSync, Done done, Runnable onCancel) {
    UiScale ui = UiScale.from(activity);
    int chrome = NposNumberPad.CHROME_STANDARD_DP;
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, ui.dp(4), pad, 0);

    TextView hint = NposUi.caption(activity, activity.getString(R.string.open_shift_float_hint));
    hint.setPadding(0, 0, 0, ui.dp(6));
    box.addView(hint);

    double seed = ShiftPrefs.nextOpeningCash(activity);
    final String[] valueHolder = {ShiftPrefs.moneyPlain(seed)};

    TextView amount = NposUi.title(activity, formatBaht(valueHolder[0]));
    amount.setGravity(Gravity.CENTER);
    amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(20f, ui.titleSp + 6f));
    amount.setTypeface(NposFonts.semibold(activity));
    amount.setMinHeight(ui.padAmountMinPx(chrome));
    amount.setPadding(0, ui.dp(4), 0, ui.dp(6));
    box.addView(amount);

    Runnable refresh = () -> amount.setText(formatBaht(valueHolder[0]));

    box.addView(
        NposNumberPad.attach(
            activity,
            new NposNumberPad.Listener() {
              @Override
              public void onDigit(String digit) {
                NposNumberPad.applyKey(valueHolder, digit, false, 9);
                refresh.run();
              }

              @Override
              public void onBackspace() {
                NposNumberPad.applyKey(valueHolder, null, true, 9);
                refresh.run();
              }
            },
            true,
            chrome));

    NposConfirmDialog.customMedium(
        activity,
        activity.getString(R.string.open_shift_float_title),
        null,
        box,
        activity.getString(R.string.open_shift_float_confirm),
        activity.getString(android.R.string.cancel),
        true,
        () -> {
          double amountVal = Math.max(0, parseMoney(valueHolder[0]));
          askWhoOpened(activity, saleSync, amountVal, done, onCancel);
          return true;
        },
        onCancel);
  }

  private static void askWhoOpened(
      Activity activity,
      SaleSync saleSync,
      double openingCash,
      Done done,
      Runnable onCancel) {
    UiScale ui = UiScale.from(activity);
    List<EmployeeRoster.Person> roster = EmployeeRoster.load(activity);
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = ui.dp(12);
    box.setPadding(pad, ui.dp(4), pad, 0);

    TextView hint = NposUi.caption(activity, activity.getString(R.string.open_shift_who_hint));
    hint.setPadding(0, 0, 0, ui.dp(8));
    box.addView(hint);

    final String[] pickId = {ShiftPrefs.lastOpenedByEmployeeId(activity)};
    final String[] pickName = {ShiftPrefs.lastOpenedByName(activity)};

    EditText typed = new EditText(activity);
    typed.setHint(R.string.open_shift_who_type_hint);
    typed.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(15f, ui.bodySp));
    typed.setTypeface(NposFonts.regular(activity));
    typed.setSingleLine(true);
    if (!pickName[0].isEmpty() && pickId[0].isEmpty()) {
      typed.setText(pickName[0]);
    }
    typed.setPadding(ui.dp(10), ui.dp(10), ui.dp(10), ui.dp(10));

    if (!roster.isEmpty()) {
      ScrollView sc = new ScrollView(activity);
      LinearLayout chips = new LinearLayout(activity);
      chips.setOrientation(LinearLayout.VERTICAL);
      sc.addView(chips);
      // Mid-size roster — not a full-screen profile wall.
      LinearLayout.LayoutParams scLp =
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.MATCH_PARENT, ui.dp(148));
      box.addView(sc, scLp);

      for (EmployeeRoster.Person p : roster) {
        TextView chip = new TextView(activity);
        chip.setText(p.label());
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(14f, ui.bodySp));
        chip.setTypeface(NposFonts.semibold(activity));
        chip.setPadding(ui.dp(10), ui.dp(8), ui.dp(10), ui.dp(8));
        chip.setBackgroundColor(
            p.id.equals(pickId[0]) || p.name.equals(pickName[0])
                ? 0xFF1B6B3A
                : 0xFFE8EEE9);
        chip.setTextColor(
            p.id.equals(pickId[0]) || p.name.equals(pickName[0])
                ? Color.WHITE
                : 0xFF1A1A1A);
        LinearLayout.LayoutParams lp =
            new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = ui.dp(4);
        chip.setLayoutParams(lp);
        chip.setOnClickListener(
            v -> {
              pickId[0] = p.id;
              pickName[0] = p.name;
              typed.setText("");
              for (int i = 0; i < chips.getChildCount(); i++) {
                View child = chips.getChildAt(i);
                if (!(child instanceof TextView)) continue;
                TextView tv = (TextView) child;
                boolean on = tv == chip;
                tv.setBackgroundColor(on ? 0xFF1B6B3A : 0xFFE8EEE9);
                tv.setTextColor(on ? Color.WHITE : 0xFF1A1A1A);
              }
            });
        chips.addView(chip);
      }
      TextView orType = NposUi.caption(activity, activity.getString(R.string.open_shift_who_or_type));
      orType.setPadding(0, ui.dp(8), 0, ui.dp(4));
      box.addView(orType);
    }

    box.addView(typed);

    NposConfirmDialog.customMedium(
        activity,
        activity.getString(R.string.open_shift_who_title),
        null,
        box,
        activity.getString(R.string.open_shift_who_confirm),
        activity.getString(android.R.string.cancel),
        true,
        () -> {
          String typedName = typed.getText() == null ? "" : typed.getText().toString().trim();
          String id = pickId[0] == null ? "" : pickId[0].trim();
          String name = pickName[0] == null ? "" : pickName[0].trim();
          if (!typedName.isEmpty()) {
            id = "";
            name = typedName;
          }
          if (name.isEmpty()) {
            Toast.makeText(activity, R.string.open_shift_who_required, Toast.LENGTH_SHORT).show();
            return false;
          }
          Toast.makeText(activity, R.string.shift_opening, Toast.LENGTH_SHORT).show();
          final String openerId = id;
          final String openerName = name;
          saleSync.openSession(
              activity,
              openingCash,
              openerId,
              openerName,
              () ->
                  activity.runOnUiThread(
                      () -> {
                        if (activity.isFinishing()) return;
                        try {
                          if (!ShiftPrefs.isOpen(activity)) {
                            Toast.makeText(
                                    activity, R.string.store_claim_blocked, Toast.LENGTH_LONG)
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
          return true;
        },
        onCancel);
  }

  private static String formatBaht(String raw) {
    double v = parseMoney(raw);
    if (raw == null || raw.trim().isEmpty()) return "฿0";
    return String.format(java.util.Locale.getDefault(), "฿%.0f", v);
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
