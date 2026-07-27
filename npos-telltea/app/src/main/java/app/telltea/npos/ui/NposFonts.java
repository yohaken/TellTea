package app.telltea.npos.ui;

import android.app.Activity;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import app.telltea.npos.R;

/**
 * Prompt typeface helpers — friendly Thai UI. Loads from {@code res/font} on API 26+,
 * otherwise {@code assets/fonts}.
 */
public final class NposFonts {
  private static Typeface regular;
  private static Typeface medium;
  private static Typeface semibold;
  private static Typeface bold;

  private NposFonts() {}

  public static Typeface regular(Context context) {
    if (regular == null) regular = load(context, R.font.prompt_regular, "fonts/Prompt-Regular.ttf");
    return regular;
  }

  public static Typeface medium(Context context) {
    if (medium == null) medium = load(context, R.font.prompt_medium, "fonts/Prompt-Medium.ttf");
    return medium;
  }

  public static Typeface semibold(Context context) {
    if (semibold == null) {
      semibold = load(context, R.font.prompt_semibold, "fonts/Prompt-SemiBold.ttf");
    }
    return semibold;
  }

  public static Typeface bold(Context context) {
    if (bold == null) bold = load(context, R.font.prompt_bold, "fonts/Prompt-Bold.ttf");
    return bold;
  }

  /** Apply Prompt to every TextView under the activity content root. */
  public static void applyActivity(Activity activity) {
    if (activity == null) return;
    View root = activity.findViewById(android.R.id.content);
    if (root != null) applyTree(root);
  }

  public static void applyTree(View root) {
    if (root == null) return;
    applyView(root);
    if (root instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) root;
      for (int i = 0; i < group.getChildCount(); i++) {
        applyTree(group.getChildAt(i));
      }
    }
  }

  public static void applyView(View view) {
    if (!(view instanceof TextView)) return;
    TextView tv = (TextView) view;
    Context context = tv.getContext();
    Typeface current = tv.getTypeface();
    int style = current != null ? current.getStyle() : Typeface.NORMAL;
    float sizeSp = tv.getTextSize() / context.getResources().getDisplayMetrics().scaledDensity;
    Typeface next;
    if ((style & Typeface.BOLD) != 0 || sizeSp >= 20f) {
      next = sizeSp >= 24f ? bold(context) : semibold(context);
    } else if (sizeSp >= 15f) {
      next = medium(context);
    } else {
      next = regular(context);
    }
    tv.setTypeface(next);
    // Soften default Material letter spacing for Thai.
    if (tv.getLetterSpacing() == 0f && sizeSp >= 18f) {
      tv.setLetterSpacing(-0.01f);
    }
  }

  private static Typeface load(Context context, int fontRes, String assetPath) {
    Context app = context.getApplicationContext();
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        return app.getResources().getFont(fontRes);
      }
    } catch (Exception ignored) {
      /* fall through to assets */
    }
    try {
      return Typeface.createFromAsset(app.getAssets(), assetPath);
    } catch (Exception e) {
      return Typeface.SANS_SERIF;
    }
  }
}
