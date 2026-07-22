package app.telltea.npos.shell;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import app.telltea.npos.MainActivity;
import app.telltea.npos.R;
import app.telltea.npos.ReceiptsActivity;
import app.telltea.npos.SellActivity;
import app.telltea.npos.SettingsActivity;
import app.telltea.npos.ShiftActivity;
import app.telltea.npos.sell.HoldCart;

/**
 * Left rail matching web PosAppShell / POS_NAV_ITEMS (colors + order).
 */
public final class PosShellNav {
  public static final String ACTIVE_SELL = "sell";
  public static final String ACTIVE_RECEIPTS = "receipts";
  public static final String ACTIVE_SHIFT = "shift";
  public static final String ACTIVE_SETTINGS = "settings";
  public static final String ACTIVE_HUB = "hub";

  public interface RefreshHook {
    void onRefresh();
  }

  private PosShellNav() {}

  public static void bind(Activity activity, String activeId, RefreshHook refreshHook) {
    LinearLayout nav = activity.findViewById(R.id.sidebarNav);
    View refresh = activity.findViewById(R.id.sidebarRefreshBtn);
    View lock = activity.findViewById(R.id.sidebarLock);
    if (nav == null) return;
    nav.removeAllViews();

    addLink(
        activity,
        nav,
        R.string.nav_sell,
        ACTIVE_SELL.equals(activeId),
        () -> openNative(activity, SellActivity.class, activeId));
    addLink(
        activity,
        nav,
        R.string.nav_members,
        false,
        () -> openWeb(activity, "https://telltea-pos.web.app/pos/members/", true));
    addLink(
        activity,
        nav,
        R.string.nav_open_bills,
        false,
        () -> {
          if (HoldCart.hasHold(activity)) {
            openNative(activity, SellActivity.class, activeId);
            Toast.makeText(activity, R.string.hub_open_bills_hint, Toast.LENGTH_LONG).show();
          } else {
            Toast.makeText(activity, R.string.hold_empty, Toast.LENGTH_SHORT).show();
          }
        });
    addLink(
        activity,
        nav,
        R.string.nav_receipts,
        ACTIVE_RECEIPTS.equals(activeId),
        () -> openNative(activity, ReceiptsActivity.class, activeId));
    addLink(
        activity,
        nav,
        R.string.nav_inventory,
        false,
        () -> openWeb(activity, "https://telltea-pos.web.app/pos/inventory/", false));
    addLink(
        activity,
        nav,
        R.string.nav_shift,
        ACTIVE_SHIFT.equals(activeId),
        () -> openNative(activity, ShiftActivity.class, activeId));
    addLink(
        activity,
        nav,
        R.string.nav_menu,
        false,
        () -> openWeb(activity, "https://telltea-pos.web.app/pos/menu/", false));
    addLink(
        activity,
        nav,
        R.string.nav_ops,
        false,
        () -> openWeb(activity, "https://telltea-pos.web.app/pos/ops/", false));
    addLink(
        activity,
        nav,
        R.string.nav_shop_settings,
        false,
        () -> openWeb(activity, "https://telltea-pos.web.app/pos/settings/", false));
    addLink(
        activity,
        nav,
        R.string.btn_settings_device,
        ACTIVE_SETTINGS.equals(activeId),
        () -> openNative(activity, SettingsActivity.class, activeId));

    if (refresh != null) {
      refresh.setOnClickListener(
          v -> {
            if (refreshHook != null) refreshHook.onRefresh();
            else Toast.makeText(activity, R.string.btn_refresh_menu, Toast.LENGTH_SHORT).show();
          });
    }
    if (lock != null) {
      lock.setOnClickListener(
          v -> {
            Intent i = new Intent(activity, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            activity.startActivity(i);
            if (!(activity instanceof MainActivity)) activity.finish();
          });
    }
  }

  private static void openNative(Activity activity, Class<?> cls, String activeId) {
    if (cls.isInstance(activity)) return;
    Intent i = new Intent(activity, cls);
    // Keep sell under the stack when hopping rails so back feels like web.
    if (SellActivity.class.equals(cls)) {
      i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    }
    activity.startActivity(i);
    if (activity instanceof SellActivity && !SellActivity.class.equals(cls)) {
      // leave sell open underneath
    } else if (!(activity instanceof MainActivity) && !cls.equals(activity.getClass())) {
      // receipts/shift/settings replace each other
      if (!SellActivity.class.equals(activity.getClass())) {
        activity.finish();
      }
    }
  }

  private static void openWeb(Activity activity, String url, boolean stubNote) {
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      activity.startActivity(i);
      if (stubNote) {
        Toast.makeText(activity, R.string.nav_web_stub_hint, Toast.LENGTH_SHORT).show();
      }
    } catch (Exception e) {
      Toast.makeText(activity, R.string.nav_web_open_fail, Toast.LENGTH_SHORT).show();
    }
  }

  private static void addLink(
      Activity activity, LinearLayout nav, int labelRes, boolean active, Runnable action) {
    TextView row = new TextView(activity);
    row.setText(labelRes);
    row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f);
    row.setTypeface(Typeface.DEFAULT_BOLD);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(dp(activity, 10), dp(activity, 10), dp(activity, 10), dp(activity, 10));
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = dp(activity, 2);
    row.setLayoutParams(lp);
    if (active) {
      row.setBackgroundColor(0xFF2D7FE0);
      row.setTextColor(0xFFFFFFFF);
    } else {
      row.setBackgroundColor(0x00000000);
      row.setTextColor(0xFFD5DBE3);
    }
    row.setOnClickListener(v -> action.run());
    nav.addView(row);
  }

  private static int dp(Activity activity, int v) {
    float d = activity.getResources().getDisplayMetrics().density;
    return Math.round(v * d);
  }
}
