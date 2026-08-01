package app.telltea.npos.shell;

import android.app.Activity;
import android.content.Intent;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import app.telltea.npos.MainActivity;
import app.telltea.npos.MenuAdminActivity;
import app.telltea.npos.R;
import app.telltea.npos.ReceiptsActivity;
import app.telltea.npos.SellActivity;
import app.telltea.npos.SettingsActivity;
import app.telltea.npos.ShiftActivity;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.UiScale;

/**
 * Left rail matching web PosAppShell / POS_NAV_ITEMS — width + type from {@link UiScale}.
 * Native MenuAdmin is on the rail (hub order 2); web menu-admin route stays cut.
 */
public final class PosShellNav {
  public static final String ACTIVE_SELL = "sell";
  public static final String ACTIVE_MENU = "menu";
  public static final String ACTIVE_RECEIPTS = "receipts";
  public static final String ACTIVE_SHIFT = "shift";
  public static final String ACTIVE_SETTINGS = "settings";
  public static final String ACTIVE_HUB = "hub";

  public interface RefreshHook {
    void onRefresh();
  }

  private PosShellNav() {}

  public static void bind(Activity activity, String activeId, RefreshHook refreshHook) {
    UiScale ui = UiScale.from(activity);
    View sidebar = activity.findViewById(R.id.posSidebar);
    if (sidebar != null) {
      ViewGroup.LayoutParams lp = sidebar.getLayoutParams();
      if (lp != null) {
        lp.width = ui.navWidthPx;
        sidebar.setLayoutParams(lp);
      }
    }
    TextView brand = activity.findViewById(R.id.sidebarBrand);
    if (brand != null) {
      brand.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.brandSp);
      brand.setTypeface(NposFonts.bold(activity));
    }
    // Front-store refresh removed — menu/version sync rides BO countdown pulse.
    View refreshBtn = activity.findViewById(R.id.sidebarRefreshBtn);
    if (refreshBtn != null) {
      refreshBtn.setVisibility(View.GONE);
    }

    LinearLayout nav = activity.findViewById(R.id.sidebarNav);
    TextView lock = activity.findViewById(R.id.sidebarLock);
    if (nav == null) return;
    nav.removeAllViews();

    addLink(
        activity,
        nav,
        ui,
        R.string.nav_sell,
        ACTIVE_SELL.equals(activeId),
        () -> openNative(activity, SellActivity.class, activeId));
    // Native catalog admin (same as MainActivity hub #2) — not web BO.
    addLink(
        activity,
        nav,
        ui,
        R.string.nav_menu,
        ACTIVE_MENU.equals(activeId),
        () -> openMenuAdmin(activity));
    // members hidden until real CRM (F3)
    addLink(
        activity,
        nav,
        ui,
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
        ui,
        R.string.nav_receipts,
        ACTIVE_RECEIPTS.equals(activeId),
        () -> openNative(activity, ReceiptsActivity.class, activeId));
    addLink(
        activity,
        nav,
        ui,
        R.string.nav_shift,
        ACTIVE_SHIFT.equals(activeId),
        () -> openNative(activity, ShiftActivity.class, activeId));
    addLink(
        activity,
        nav,
        ui,
        R.string.btn_settings_device,
        ACTIVE_SETTINGS.equals(activeId),
        () -> openNative(activity, SettingsActivity.class, activeId));

    if (lock != null) {
      lock.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.navSp);
      lock.setTypeface(NposFonts.medium(activity));
      lock.setMinHeight(ui.touchMinPx);
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
    if (SellActivity.class.equals(cls)) {
      i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    }
    activity.startActivity(i);
    if (!(activity instanceof MainActivity) && !SellActivity.class.equals(activity.getClass())) {
      if (!SellActivity.class.equals(cls)) {
        activity.finish();
      }
    }
  }

  /** Public openers for Gpos header hub (same destinations as the left rail). */
  public static void openSell(Activity activity) {
    openNative(activity, SellActivity.class, ACTIVE_SELL);
  }

  /** Open native menu admin — requires an open shift (same gate as MainActivity hub). */
  public static void openMenuAdmin(Activity activity) {
    if (activity instanceof MenuAdminActivity) return;
    if (!ShiftPrefs.isOpen(activity)) {
      Toast.makeText(activity, R.string.menu_admin_need_shift, Toast.LENGTH_LONG).show();
      return;
    }
    activity.startActivity(new Intent(activity, MenuAdminActivity.class));
  }

  public static void openReceipts(Activity activity) {
    openNative(activity, ReceiptsActivity.class, ACTIVE_RECEIPTS);
  }

  public static void openShift(Activity activity) {
    openNative(activity, ShiftActivity.class, ACTIVE_SHIFT);
  }

  public static void openSettings(Activity activity) {
    openNative(activity, SettingsActivity.class, ACTIVE_SETTINGS);
  }

  public static void openOpenBillsHint(Activity activity) {
    if (HoldCart.hasHold(activity)) {
      openNative(activity, SellActivity.class, ACTIVE_SELL);
      Toast.makeText(activity, R.string.hub_open_bills_hint, Toast.LENGTH_LONG).show();
    } else {
      Toast.makeText(activity, R.string.hold_empty, Toast.LENGTH_SHORT).show();
    }
  }

  public static void openLockHub(Activity activity) {
    Intent i = new Intent(activity, MainActivity.class);
    i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    activity.startActivity(i);
    if (!(activity instanceof MainActivity)) activity.finish();
  }

  /** Hide left rail on sell (hub lives in header grid). Other screens keep the rail. */
  public static void hideSidebar(Activity activity) {
    View sidebar = activity.findViewById(R.id.posSidebar);
    if (sidebar != null) sidebar.setVisibility(View.GONE);
  }

  private static void addLink(
      Activity activity,
      LinearLayout nav,
      UiScale ui,
      int labelRes,
      boolean active,
      Runnable action) {
    TextView row = new TextView(activity);
    row.setText(labelRes);
    row.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.navSp);
    row.setTypeface(NposFonts.medium(activity));
    row.setGravity(Gravity.CENTER_VERTICAL);
    int padH = ui.dp(10);
    int padV = Math.max(ui.dp(8), Math.round(ui.touchMinPx * 0.22f));
    row.setPadding(padH, padV, padH, padV);
    row.setMinHeight(ui.touchMinPx);
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = ui.dp(2);
    row.setLayoutParams(lp);
    if (active) {
      row.setBackgroundResource(R.drawable.npos_nav_active);
      row.setTextColor(0xFFFFFFFF);
    } else {
      row.setBackgroundResource(R.drawable.npos_nav_idle);
      row.setTextColor(0xFFD5DBE3);
    }
    row.setOnClickListener(v -> action.run());
    nav.addView(row);
  }

  /** Show back-office brand logo in the left rail when shop settings include it. */
  public static void applyBrandLogo(Activity activity, JSONObject shop) {
    if (activity == null) return;
    ImageView logo = activity.findViewById(R.id.sidebarBrandLogo);
    TextView brand = activity.findViewById(R.id.sidebarBrand);
    String logoSrc = shop != null ? shop.optString("brandLogo", "").trim() : "";
    String shopName =
        shop != null
            ? firstNonEmpty(shop.optString("shopName", ""), shop.optString("shopNameTh", ""))
            : "";
    if (brand != null && !shopName.isEmpty()) {
      brand.setText(shopName);
    }
    if (logo == null) return;
    if (logoSrc.isEmpty()) {
      logo.setVisibility(View.GONE);
      logo.setImageDrawable(null);
      return;
    }
    logo.setVisibility(View.VISIBLE);
    ImageLoader.bind(logo, logoSrc, 0xFF3A424A);
  }

  private static String firstNonEmpty(String a, String b) {
    if (a != null && !a.trim().isEmpty()) return a.trim();
    if (b != null && !b.trim().isEmpty()) return b.trim();
    return "";
  }
}
