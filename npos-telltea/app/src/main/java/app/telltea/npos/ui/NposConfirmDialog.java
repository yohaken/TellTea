package app.telltea.npos.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.Gravity;
import android.view.View;
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
      if (dialog.getWindow() != null) {
        dialog
            .getWindow()
            .setBackgroundDrawableResource(android.R.color.transparent);
      }
    } catch (RuntimeException e) {
      if (onCancel != null) onCancel.run();
      return null;
    }
    return dialog;
  }
}
