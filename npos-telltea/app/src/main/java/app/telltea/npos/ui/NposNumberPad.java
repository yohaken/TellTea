package app.telltea.npos.ui;

import android.content.Context;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Large POS digit pad — cash / float / claim code. Uses restored tall keys ({@link
 * UiScale#padKeyMinPx}), not the compact chip CTAs.
 */
public final class NposNumberPad {
  public interface Listener {
    void onDigit(String digit);

    void onBackspace();
  }

  private NposNumberPad() {}

  /** 7–9 / 4–6 / 1–3 / 0 ⌫ — large touch targets for counter use. */
  public static LinearLayout attach(Context context, Listener listener) {
    return attach(context, listener, true);
  }

  /**
   * @param wideZero stretch {@code 0} across two columns (cash pad). Claim pads use equal keys.
   */
  public static LinearLayout attach(Context context, Listener listener, boolean wideZero) {
    UiScale ui = UiScale.from(context);
    LinearLayout pad = new LinearLayout(context);
    pad.setOrientation(LinearLayout.VERTICAL);
    String[][] rows = {
      {"7", "8", "9"},
      {"4", "5", "6"},
      {"1", "2", "3"},
      {"0", "⌫"}
    };
    int gap = Math.max(ui.dp(4), ui.gapPx);
    for (String[] row : rows) {
      LinearLayout line = new LinearLayout(context);
      line.setOrientation(LinearLayout.HORIZONTAL);
      line.setPadding(0, gap / 2, 0, gap / 2);
      for (String key : row) {
        TextView b = keyButton(context, ui, key);
        float weight = wideZero && "0".equals(key) ? 2f : 1f;
        b.setOnClickListener(
            v -> {
              if (listener == null) return;
              if ("⌫".equals(key)) listener.onBackspace();
              else listener.onDigit(key);
            });
        LinearLayout.LayoutParams lp =
            new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight);
        lp.setMargins(gap / 2, 0, gap / 2, 0);
        line.addView(b, lp);
      }
      if (!wideZero && row.length == 2) {
        // Equal third column spacer so 0/⌫ align under 1–3.
        TextView spacer = keyButton(context, ui, "");
        spacer.setVisibility(android.view.View.INVISIBLE);
        spacer.setClickable(false);
        LinearLayout.LayoutParams lp =
            new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(gap / 2, 0, gap / 2, 0);
        line.addView(spacer, lp);
      }
      pad.addView(line);
    }
    return pad;
  }

  /** Append digit / backspace into a mutable string holder (money or code). */
  public static void applyKey(String[] holder, String digitOrNull, boolean backspace, int maxLen) {
    if (holder == null || holder.length == 0) return;
    if (holder[0] == null) holder[0] = "";
    if (backspace) {
      if (!holder[0].isEmpty()) {
        holder[0] = holder[0].substring(0, holder[0].length() - 1);
      }
      return;
    }
    if (digitOrNull == null || digitOrNull.isEmpty()) return;
    if (maxLen > 0 && holder[0].length() >= maxLen) return;
    holder[0] = holder[0] + digitOrNull;
  }

  private static TextView keyButton(Context context, UiScale ui, String label) {
    TextView b = NposUi.chip(context, label);
    b.setAllCaps(false);
    b.setGravity(Gravity.CENTER);
    b.setMinHeight(ui.padKeyMinPx);
    b.setMinimumHeight(ui.padKeyMinPx);
    b.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(18f, ui.titleSp + 2f));
    b.setTypeface(NposFonts.semibold(context));
    // Pad keys must span the dialog width — drop compact CTA maxWidth.
    b.setMaxWidth(Integer.MAX_VALUE);
    int padH = ui.dp(8);
    int padV = ui.dp(10);
    b.setPadding(padH, padV, padH, padV);
    return b;
  }
}
