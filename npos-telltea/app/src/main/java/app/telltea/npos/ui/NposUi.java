package app.telltea.npos.ui;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.telltea.npos.R;

/**
 * Friendly nPos UI factory — <b>use this for every new control</b>.
 *
 * <p>Do not invent Material {@code Button} bars, {@code Typeface.DEFAULT}, or hard-coded
 * purple/cream themes. Styles live in {@code res/values/styles.xml} ({@code Npos.Btn.*}) and
 * Prompt fonts via {@link NposFonts}. Policy: {@code docs/npos-friendly-ui-checklist.md}.
 */
public final class NposUi {
  public enum Btn {
    PRIMARY,
    SECONDARY,
    GHOST,
    CHIP,
    CHIP_PRIMARY,
    BACK
  }

  private NposUi() {}

  /** Scroll/page root with soft TellTea background. */
  public static LinearLayout pageColumn(Context context) {
    LinearLayout root = new LinearLayout(context);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(color(context, R.color.npos_bg));
    int pad = dp(context, 20);
    root.setPadding(pad, pad, pad, pad);
    return root;
  }

  public static TextView title(Context context, CharSequence text) {
    TextView tv = new TextView(context);
    tv.setText(text);
    tv.setTextColor(color(context, R.color.npos_ink));
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f);
    tv.setTypeface(NposFonts.semibold(context));
    tv.setLetterSpacing(-0.01f);
    return tv;
  }

  public static TextView section(Context context, CharSequence text) {
    TextView tv = new TextView(context);
    tv.setText(text);
    tv.setTextColor(color(context, R.color.npos_ink));
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f);
    tv.setTypeface(NposFonts.semibold(context));
    return tv;
  }

  public static TextView body(Context context, CharSequence text) {
    TextView tv = new TextView(context);
    tv.setText(text);
    tv.setTextColor(color(context, R.color.npos_ink_soft));
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
    tv.setTypeface(NposFonts.regular(context));
    tv.setLineSpacing(0f, 1.25f);
    return tv;
  }

  public static TextView caption(Context context, CharSequence text) {
    TextView tv = new TextView(context);
    tv.setText(text);
    tv.setTextColor(color(context, R.color.npos_muted));
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
    tv.setTypeface(NposFonts.regular(context));
    tv.setLineSpacing(0f, 1.2f);
    return tv;
  }

  public static EditText field(Context context) {
    EditText ed = new EditText(context);
    ed.setBackgroundResource(R.drawable.npos_input_field);
    ed.setTextColor(color(context, R.color.npos_ink));
    ed.setHintTextColor(color(context, R.color.npos_muted));
    ed.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
    ed.setTypeface(NposFonts.regular(context));
    int padH = dp(context, 14);
    int padV = dp(context, 10);
    ed.setPadding(padH, padV, padH, padV);
    ed.setMinHeight(dp(context, 44));
    return ed;
  }

  public static TextView button(Context context, Btn kind, CharSequence label) {
    TextView btn = new TextView(context);
    btn.setText(label);
    btn.setGravity(Gravity.CENTER);
    btn.setClickable(true);
    btn.setFocusable(true);
    applyBtn(btn, kind);
    return btn;
  }

  public static TextView primary(Context context, CharSequence label) {
    return button(context, Btn.PRIMARY, label);
  }

  public static TextView secondary(Context context, CharSequence label) {
    return button(context, Btn.SECONDARY, label);
  }

  public static TextView ghost(Context context, CharSequence label) {
    return button(context, Btn.GHOST, label);
  }

  public static TextView chip(Context context, CharSequence label) {
    return button(context, Btn.CHIP, label);
  }

  public static TextView chipPrimary(Context context, CharSequence label) {
    return button(context, Btn.CHIP_PRIMARY, label);
  }

  public static TextView back(Context context) {
    return button(context, Btn.BACK, context.getString(R.string.btn_back));
  }

  /** Style an existing TextView as a friendly button (e.g. layout XML TextView). */
  public static void applyBtn(TextView btn, Btn kind) {
    Context context = btn.getContext();
    int padH = dp(context, 18);
    int padV;
    switch (kind) {
      case PRIMARY:
        btn.setBackgroundResource(R.drawable.npos_touch_primary);
        btn.setTextColor(0xFFFFFFFF);
        btn.setTypeface(NposFonts.semibold(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        btn.setMinHeight(dp(context, 52));
        padV = dp(context, 12);
        break;
      case SECONDARY:
        btn.setBackgroundResource(R.drawable.npos_touch_secondary);
        btn.setTextColor(color(context, R.color.npos_orange));
        btn.setTypeface(NposFonts.semibold(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        btn.setMinHeight(dp(context, 44));
        padV = dp(context, 10);
        break;
      case CHIP_PRIMARY:
        btn.setBackgroundResource(R.drawable.npos_touch_primary);
        btn.setTextColor(0xFFFFFFFF);
        btn.setTypeface(NposFonts.semibold(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        btn.setMinHeight(dp(context, 40));
        padH = dp(context, 14);
        padV = dp(context, 8);
        break;
      case CHIP:
        btn.setBackgroundResource(R.drawable.npos_touch_chip);
        btn.setTextColor(color(context, R.color.npos_ink));
        btn.setTypeface(NposFonts.medium(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        btn.setMinHeight(dp(context, 40));
        padH = dp(context, 14);
        padV = dp(context, 8);
        break;
      case BACK:
        btn.setBackgroundResource(R.drawable.npos_touch_ghost);
        btn.setTextColor(color(context, R.color.npos_ink));
        btn.setTypeface(NposFonts.medium(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        btn.setMinHeight(dp(context, 36));
        padH = dp(context, 12);
        padV = dp(context, 8);
        break;
      case GHOST:
      default:
        btn.setBackgroundResource(R.drawable.npos_touch_ghost);
        btn.setTextColor(color(context, R.color.npos_ink));
        btn.setTypeface(NposFonts.medium(context));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        btn.setMinHeight(dp(context, 40));
        padV = dp(context, 8);
        break;
    }
    btn.setPadding(padH, padV, padH, padV);
    btn.setAllCaps(false);
    try {
      btn.setMaxWidth(context.getResources().getDimensionPixelSize(R.dimen.npos_btn_max_w));
    } catch (RuntimeException ignored) {
      btn.setMaxWidth(dp(context, 280));
    }
    if (Build.VERSION.SDK_INT >= 21) {
      btn.setBackgroundTintList(null);
    }
  }

  public static LinearLayout.LayoutParams matchWidth(Context context, int bottomMarginDp) {
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = dp(context, bottomMarginDp);
    return lp;
  }

  /** Compact CTA — wrap content, centered, capped width (mockup). */
  public static LinearLayout.LayoutParams cta(Context context, int bottomMarginDp) {
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.gravity = Gravity.CENTER_HORIZONTAL;
    lp.bottomMargin = dp(context, bottomMarginDp);
    return lp;
  }

  public static LinearLayout.LayoutParams wrap(Context context, int endMarginDp, int bottomMarginDp) {
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.setMarginEnd(dp(context, endMarginDp));
    lp.bottomMargin = dp(context, bottomMarginDp);
    return lp;
  }

  /** Header row: back chip + title. */
  public static LinearLayout headerBar(Activity activity, CharSequence titleText) {
    LinearLayout top = new LinearLayout(activity);
    top.setOrientation(LinearLayout.HORIZONTAL);
    top.setGravity(Gravity.CENTER_VERTICAL);
    TextView back = back(activity);
    back.setOnClickListener(v -> activity.finish());
    top.addView(back);
    TextView title = title(activity, titleText);
    title.setPadding(dp(activity, 12), dp(activity, 4), 0, 0);
    LinearLayout.LayoutParams tlp =
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    title.setLayoutParams(tlp);
    top.addView(title);
    return top;
  }

  public static void paintPrompt(TextView tv, boolean bold) {
    if (tv == null) return;
    tv.setTypeface(bold ? NposFonts.semibold(tv.getContext()) : NposFonts.regular(tv.getContext()));
  }

  public static int color(Context context, int colorRes) {
    if (Build.VERSION.SDK_INT >= 23) {
      return context.getColor(colorRes);
    }
    return context.getResources().getColor(colorRes);
  }

  public static int dp(Context context, int v) {
    return Math.round(v * context.getResources().getDisplayMetrics().density);
  }

  /** Soften system Material buttons created before migration (best-effort). */
  public static void softenLegacyButton(View view) {
    if (!(view instanceof TextView)) return;
    TextView tv = (TextView) view;
    applyBtn(tv, Btn.GHOST);
    Drawable bg = tv.getBackground();
    if (bg != null && Build.VERSION.SDK_INT >= 21) {
      tv.setBackgroundTintList(ColorStateList.valueOf(color(tv.getContext(), R.color.npos_ghost)));
    }
  }
}
