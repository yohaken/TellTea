package app.telltea.npos.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import app.telltea.npos.R;

/**
 * Friendly confirm / alert / content dialogs — large clear CTAs via {@link NposUi},
 * not Material {@code setPositiveButton} chrome.
 *
 * <p>Policy: {@code docs/npos-friendly-ui-checklist.md}.
 */
public final class NposConfirmDialog {
  /** Return {@code true} to dismiss. */
  public interface ConfirmAction {
    boolean onConfirm();
  }

  private NposConfirmDialog() {}

  public static void confirm(
      Activity activity,
      CharSequence title,
      CharSequence message,
      CharSequence confirmLabel,
      Runnable onConfirm) {
    confirm(activity, title, message, confirmLabel, false, onConfirm, null);
  }

  public static void confirmDestructive(
      Activity activity,
      CharSequence title,
      CharSequence message,
      CharSequence confirmLabel,
      Runnable onConfirm) {
    confirm(activity, title, message, confirmLabel, true, onConfirm, null);
  }

  public static void confirm(
      Activity activity,
      CharSequence title,
      CharSequence message,
      CharSequence confirmLabel,
      boolean destructive,
      Runnable onConfirm,
      Runnable onCancel) {
    show(
        activity,
        title,
        message,
        null,
        confirmLabel,
        activity.getString(android.R.string.cancel),
        destructive,
        true,
        () -> {
          if (onConfirm != null) onConfirm.run();
          return true;
        },
        onCancel);
  }

  /** Single OK — used for kick / already-voided. */
  public static void alert(
      Activity activity,
      CharSequence title,
      CharSequence message,
      CharSequence okLabel,
      boolean cancelable,
      Runnable onOk) {
    show(
        activity,
        title,
        message,
        null,
        okLabel,
        null,
        false,
        cancelable,
        () -> {
          if (onOk != null) onOk.run();
          return true;
        },
        null);
  }

  /** Title + optional message + custom content + friendly CTAs. */
  public static AlertDialog custom(
      Activity activity,
      CharSequence title,
      CharSequence message,
      View content,
      CharSequence confirmLabel,
      CharSequence cancelLabel,
      boolean cancelable,
      ConfirmAction onConfirm,
      Runnable onCancel) {
    return show(
        activity,
        title,
        message,
        content,
        confirmLabel,
        cancelLabel,
        false,
        cancelable,
        onConfirm,
        onCancel);
  }

  public static AlertDialog custom(
      Activity activity,
      CharSequence title,
      View content,
      CharSequence confirmLabel,
      ConfirmAction onConfirm,
      Runnable onCancel) {
    return custom(
        activity,
        title,
        null,
        content,
        confirmLabel,
        activity.getString(android.R.string.cancel),
        true,
        onConfirm,
        onCancel);
  }

  private static AlertDialog show(
      Activity activity,
      CharSequence title,
      CharSequence message,
      View content,
      CharSequence confirmLabel,
      CharSequence cancelLabel,
      boolean destructive,
      boolean cancelable,
      ConfirmAction onConfirm,
      Runnable onCancel) {
    if (activity == null || activity.isFinishing()) return null;

    LinearLayout root = new LinearLayout(activity);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(NposUi.color(activity, R.color.npos_surface));
    int pad = NposUi.dp(activity, 20);
    root.setPadding(pad, pad, pad, pad);

    if (title != null && title.length() > 0) {
      TextView titleTv = NposUi.section(activity, title);
      titleTv.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 18f);
      titleTv.setPadding(0, 0, 0, NposUi.dp(activity, 8));
      root.addView(titleTv);
    }

    if (message != null && message.length() > 0) {
      TextView msgTv = NposUi.body(activity, message);
      msgTv.setPadding(0, 0, 0, NposUi.dp(activity, 12));
      root.addView(msgTv);
    }

    if (content != null) {
      LinearLayout.LayoutParams clp =
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
      clp.bottomMargin = NposUi.dp(activity, 12);
      content.setLayoutParams(clp);
      root.addView(content);
    }

    LinearLayout actions = new LinearLayout(activity);
    actions.setOrientation(LinearLayout.HORIZONTAL);
    actions.setGravity(Gravity.CENTER_HORIZONTAL);
    actions.setPadding(0, NposUi.dp(activity, 4), 0, 0);

    final AlertDialog[] holder = new AlertDialog[1];

    if (cancelLabel != null) {
      TextView cancelBtn = NposUi.ghost(activity, cancelLabel);
      cancelBtn.setOnClickListener(
          v -> {
            if (holder[0] != null) holder[0].dismiss();
            if (onCancel != null) onCancel.run();
          });
      LinearLayout.LayoutParams glp =
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
      glp.setMarginEnd(NposUi.dp(activity, 8));
      actions.addView(cancelBtn, glp);
    }

    TextView okBtn =
        destructive
            ? NposUi.secondary(activity, confirmLabel)
            : NposUi.primary(activity, confirmLabel);
    // Dialog CTAs: fill row, still capped by NposUi max width when wrap — here stretch for balance.
    okBtn.setMaxWidth(Integer.MAX_VALUE);
    okBtn.setOnClickListener(
        v -> {
          boolean dismiss = true;
          if (onConfirm != null) {
            try {
              dismiss = onConfirm.onConfirm();
            } catch (RuntimeException e) {
              dismiss = true;
            }
          }
          if (dismiss && holder[0] != null) holder[0].dismiss();
        });
    LinearLayout.LayoutParams olp =
        new LinearLayout.LayoutParams(
            cancelLabel != null ? 0 : LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            cancelLabel != null ? 1f : 0f);
    actions.addView(okBtn, olp);
    root.addView(actions);

    ScrollView scroll = new ScrollView(activity);
    scroll.setFillViewport(true);
    scroll.addView(root);

    AlertDialog dialog =
        new AlertDialog.Builder(activity).setView(scroll).setCancelable(cancelable).create();
    if (cancelable && onCancel != null) {
      dialog.setOnCancelListener(d -> onCancel.run());
    }
    holder[0] = dialog;
    try {
      dialog.show();
      Window window = dialog.getWindow();
      if (window != null) {
        window.setBackgroundDrawableResource(android.R.color.transparent);
        fitCardToWindow(window, scroll, root);
      }
    } catch (RuntimeException e) {
      if (onCancel != null) onCancel.run();
      return null;
    }
    return dialog;
  }

  /**
   * Cap dialog to ~92% of the screen; if content is still taller, scale the card uniformly so
   * number-pad proportions stay intact (no clipped keys).
   */
  static void fitCardToWindow(Window window, View scroll, View card) {
    if (window == null || scroll == null || card == null) return;
    DisplayMetrics dm = card.getResources().getDisplayMetrics();
    final int maxH = Math.round(dm.heightPixels * 0.92f);
    final int maxW = Math.round(dm.widthPixels * 0.94f);
    try {
      window.setLayout(Math.min(maxW, dm.widthPixels), ViewGroup.LayoutParams.WRAP_CONTENT);
    } catch (RuntimeException ignored) {
      /* some OEMs reject setLayout */
    }
    card.post(
        () -> {
          int h = card.getMeasuredHeight();
          int w = card.getMeasuredWidth();
          if (h <= 0 || w <= 0) return;
          float s = 1f;
          if (h > maxH) s = Math.min(s, maxH / (float) h);
          if (w > maxW) s = Math.min(s, maxW / (float) w);
          if (s >= 0.995f) return;
          s = Math.max(0.70f, s);
          scroll.setPivotX(w / 2f);
          scroll.setPivotY(0f);
          scroll.setScaleX(s);
          scroll.setScaleY(s);
          ViewGroup.LayoutParams lp = scroll.getLayoutParams();
          if (lp != null) {
            lp.height = Math.round(h * s);
            lp.width = Math.round(Math.min(w, maxW) * (w > maxW ? s : 1f));
            if (lp.width <= 0) lp.width = Math.round(w * s);
            scroll.setLayoutParams(lp);
          }
        });
  }
}
