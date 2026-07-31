package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.MenuSyncCoordinator;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/**
 * Native menu catalog admin (BOH /menu/ parity — read + sold-out toggle in P1/P2).
 * Entry: Hub tile 「เมนู」 after Sell · requires open shift.
 */
public class MenuAdminActivity extends Activity implements MenuSyncCoordinator.Listener {
  public static final String EXTRA_FOCUS_ITEM_ID = "focusItemId";

  private enum Tab {
    ITEMS,
    GROUPS,
    PRICES
  }

  private final MenuRepository menuRepo = new MenuRepository();
  private MenuModels.Bundle menu;
  private Tab tab = Tab.ITEMS;
  private String focusItemId = "";
  private boolean toggleBusy;

  private TextView statusLine;
  private TextView tabItems;
  private TextView tabGroups;
  private TextView tabPrices;
  private LinearLayout listRoot;
  private final Map<String, View> itemRowById = new HashMap<>();

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      Toast.makeText(this, R.string.menu_admin_need_shift, Toast.LENGTH_LONG).show();
      finish();
      return;
    }
    NposFonts.applyActivity(this);

    Intent in = getIntent();
    if (in != null) {
      focusItemId = in.getStringExtra(EXTRA_FOCUS_ITEM_ID);
      if (focusItemId == null) focusItemId = "";
    }

    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    int pad = NposUi.dp(this, 12);
    page.setPadding(pad, pad, pad, pad);

    page.addView(NposUi.headerBar(this, getString(R.string.menu_admin_title)));

    TextView hint = NposUi.caption(this, getString(R.string.menu_admin_hint));
    hint.setPadding(0, 0, 0, NposUi.dp(this, 8));
    page.addView(hint);

    page.addView(buildTabRow());

    statusLine = NposUi.caption(this, getString(R.string.sell_loading_menu));
    statusLine.setPadding(0, 0, 0, NposUi.dp(this, 6));
    page.addView(statusLine);

    TextView refresh = NposUi.secondary(this, getString(R.string.btn_refresh_menu));
    refresh.setLayoutParams(NposUi.cta(this, 8));
    refresh.setOnClickListener(v -> reload(true));
    page.addView(refresh);

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout.LayoutParams slp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
    scroll.setLayoutParams(slp);
    listRoot = new LinearLayout(this);
    listRoot.setOrientation(LinearLayout.VERTICAL);
    scroll.addView(listRoot);
    page.addView(scroll);

    setContentView(page);
    MenuSyncCoordinator.bind(this);
    reload(true);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent != null) {
      String id = intent.getStringExtra(EXTRA_FOCUS_ITEM_ID);
      focusItemId = id == null ? "" : id;
      if (!focusItemId.isEmpty()) {
        tab = Tab.ITEMS;
        paintTabs();
        render();
        scrollFocusIntoView();
      }
    }
  }

  @Override
  protected void onDestroy() {
    MenuSyncCoordinator.unbind(this);
    menuRepo.shutdown();
    super.onDestroy();
  }

  @Override
  public void onMenuVersionChanged(long serverVersion) {
    runOnUiThread(
        () -> {
          if (isFinishing() || toggleBusy) return;
          // Quiet refresh — avoid double toast after our own sold-out write.
          reload(true);
        });
  }

  private LinearLayout buildTabRow() {
    HorizontalScrollView hsv = new HorizontalScrollView(this);
    hsv.setHorizontalScrollBarEnabled(false);
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    tabItems = NposUi.chip(this, getString(R.string.menu_admin_tab_items));
    tabGroups = NposUi.chip(this, getString(R.string.menu_admin_tab_groups));
    tabPrices = NposUi.chip(this, getString(R.string.menu_admin_tab_prices));
    tabItems.setOnClickListener(
        v -> {
          tab = Tab.ITEMS;
          paintTabs();
          render();
        });
    tabGroups.setOnClickListener(
        v -> {
          tab = Tab.GROUPS;
          paintTabs();
          render();
        });
    tabPrices.setOnClickListener(
        v -> {
          tab = Tab.PRICES;
          paintTabs();
          render();
        });
    LinearLayout.LayoutParams lp = NposUi.wrap(this, 8, 0);
    tabItems.setLayoutParams(lp);
    tabGroups.setLayoutParams(NposUi.wrap(this, 8, 0));
    tabPrices.setLayoutParams(NposUi.wrap(this, 0, 0));
    row.addView(tabItems);
    row.addView(tabGroups);
    row.addView(tabPrices);
    hsv.addView(row);
    LinearLayout wrap = new LinearLayout(this);
    wrap.setOrientation(LinearLayout.VERTICAL);
    wrap.addView(hsv);
    paintTabs();
    return wrap;
  }

  private void paintTabs() {
    styleTab(tabItems, tab == Tab.ITEMS);
    styleTab(tabGroups, tab == Tab.GROUPS);
    styleTab(tabPrices, tab == Tab.PRICES);
  }

  private void styleTab(TextView tv, boolean on) {
    if (tv == null) return;
    NposUi.applyBtn(tv, on ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
  }

  private void reload(boolean forceNetwork) {
    if (menu == null) {
      statusLine.setText(R.string.sell_loading_menu);
    } else if (forceNetwork) {
      statusLine.setText(R.string.sell_menu_syncing);
    }
    menuRepo.loadMenu(
        this,
        forceNetwork,
        bundle ->
            runOnUiThread(
                () -> {
                  if (isFinishing()) return;
                  menu = bundle;
                  if (bundle.demo) {
                    statusLine.setText(R.string.menu_admin_demo_banner);
                  } else {
                    statusLine.setText(
                        getString(
                            R.string.menu_admin_status_fmt,
                            bundle.items == null ? 0 : bundle.items.size(),
                            bundle.categories == null ? 0 : bundle.categories.size(),
                            bundle.optionGroups == null ? 0 : bundle.optionGroups.size()));
                  }
                  render();
                  scrollFocusIntoView();
                }));
  }

  private void render() {
    listRoot.removeAllViews();
    itemRowById.clear();
    if (menu == null) {
      listRoot.addView(NposUi.body(this, getString(R.string.sell_loading_menu)));
      return;
    }
    switch (tab) {
      case GROUPS:
        renderGroups();
        break;
      case PRICES:
        renderPrices();
        break;
      case ITEMS:
      default:
        renderItems();
        break;
    }
  }

  private void renderItems() {
    if (menu.categories == null || menu.categories.isEmpty()) {
      listRoot.addView(emptyLine(getString(R.string.menu_admin_empty_items)));
      return;
    }
    listRoot.addView(tableHeader(getString(R.string.menu_admin_col_name), getString(R.string.menu_admin_col_price), getString(R.string.menu_admin_col_status)));
    int shown = 0;
    for (MenuModels.Category cat : menu.categories) {
      List<MenuModels.Item> inCat = itemsInCategory(cat.id);
      if (inCat.isEmpty()) continue;
      TextView catHead = NposUi.section(this, cat.name);
      catHead.setPadding(0, NposUi.dp(this, 12), 0, NposUi.dp(this, 4));
      listRoot.addView(catHead);
      for (MenuModels.Item item : inCat) {
        listRoot.addView(itemRow(item));
        shown++;
      }
    }
    // Orphans (no matching category)
    List<MenuModels.Item> orphans = new ArrayList<>();
    for (MenuModels.Item item : menu.items) {
      if (findCategoryName(item.categoryId) == null) orphans.add(item);
    }
    if (!orphans.isEmpty()) {
      TextView catHead = NposUi.section(this, getString(R.string.menu_admin_uncategorized));
      catHead.setPadding(0, NposUi.dp(this, 12), 0, NposUi.dp(this, 4));
      listRoot.addView(catHead);
      for (MenuModels.Item item : orphans) {
        listRoot.addView(itemRow(item));
        shown++;
      }
    }
    if (shown == 0) {
      listRoot.addView(emptyLine(getString(R.string.menu_admin_empty_items)));
    }
  }

  private View itemRow(MenuModels.Item item) {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 8), NposUi.dp(this, 8), NposUi.dp(this, 8));
    boolean focus = focusItemId != null && focusItemId.equals(item.id);
    row.setBackgroundColor(focus ? 0x33E85D24 : Color.TRANSPARENT);

    LinearLayout textCol = new LinearLayout(this);
    textCol.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams tlp =
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f);
    textCol.setLayoutParams(tlp);

    TextView name = NposUi.body(this, item.name);
    name.setTextColor(NposUi.color(this, R.color.npos_ink));
    name.setTypeface(NposFonts.semibold(this));
    textCol.addView(name);

    TextView meta =
        NposUi.caption(
            this,
            String.format(
                Locale.getDefault(),
                "฿%.0f%s",
                item.price,
                Double.isNaN(item.deliveryPrice)
                    ? ""
                    : String.format(Locale.getDefault(), " · ส่ง ฿%.0f", item.deliveryPrice)));
    textCol.addView(meta);
    row.addView(textCol);

    TextView status =
        NposUi.caption(
            this,
            getString(item.active ? R.string.menu_admin_status_on : R.string.menu_admin_status_off));
    status.setTextColor(
        item.active
            ? NposUi.color(this, R.color.npos_ink)
            : NposUi.color(this, R.color.npos_orange));
    status.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams slp =
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.7f);
    status.setLayoutParams(slp);
    row.addView(status);

    TextView toggle =
        item.active
            ? NposUi.secondary(this, getString(R.string.menu_admin_btn_sold_out))
            : NposUi.primary(this, getString(R.string.menu_admin_btn_restore));
    toggle.setMaxWidth(NposUi.dp(this, 160));
    toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
    toggle.setMinHeight(NposUi.dp(this, 44));
    toggle.setEnabled(!toggleBusy && menu != null && !menu.demo);
    toggle.setOnClickListener(v -> runToggle(item));
    LinearLayout.LayoutParams blp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    blp.setMarginStart(NposUi.dp(this, 6));
    toggle.setLayoutParams(blp);
    row.addView(toggle);

    itemRowById.put(item.id, row);
    return row;
  }

  private void renderGroups() {
    if (menu.optionGroups == null || menu.optionGroups.isEmpty()) {
      listRoot.addView(emptyLine(getString(R.string.menu_admin_empty_groups)));
      return;
    }
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      int used = countItemsUsingGroup(g.id);
      String sel =
          g.isSingle()
              ? getString(R.string.menu_admin_sel_single)
              : "unlimited".equals(g.selectionType)
                  ? getString(R.string.menu_admin_sel_unlimited)
                  : getString(R.string.menu_admin_sel_multi);
      String line =
          g.name
              + (g.required ? " · " + getString(R.string.menu_admin_required) : "")
              + " · "
              + sel
              + " · "
              + getString(R.string.menu_admin_used_by_fmt, used);
      TextView head = NposUi.section(this, line);
      head.setPadding(0, NposUi.dp(this, 10), 0, NposUi.dp(this, 4));
      listRoot.addView(head);
      if (g.options != null) {
        for (MenuModels.Option opt : g.options) {
          String price =
              String.format(
                  Locale.getDefault(),
                  "%s  +฿%.0f%s",
                  opt.name,
                  opt.priceDelta,
                  Double.isNaN(opt.deliveryPriceDelta)
                      ? ""
                      : String.format(
                          Locale.getDefault(), " · ส่ง +฿%.0f", opt.deliveryPriceDelta));
          TextView row = NposUi.body(this, price);
          row.setPadding(NposUi.dp(this, 12), NposUi.dp(this, 4), 0, NposUi.dp(this, 4));
          listRoot.addView(row);
        }
      }
    }
  }

  private void renderPrices() {
    listRoot.addView(
        tableHeader(
            getString(R.string.menu_admin_col_name),
            getString(R.string.menu_admin_col_store),
            getString(R.string.menu_admin_col_delivery)));
    if (menu.items == null || menu.items.isEmpty()) {
      listRoot.addView(emptyLine(getString(R.string.menu_admin_empty_items)));
      return;
    }
    for (MenuModels.Item item : menu.items) {
      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 6), NposUi.dp(this, 8), NposUi.dp(this, 6));
      TextView name = NposUi.body(this, item.name);
      name.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f));
      row.addView(name);
      TextView store =
          NposUi.body(this, String.format(Locale.getDefault(), "฿%.0f", item.price));
      store.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.6f));
      store.setGravity(Gravity.END);
      row.addView(store);
      String del =
          Double.isNaN(item.deliveryPrice)
              ? "—"
              : String.format(Locale.getDefault(), "฿%.0f", item.deliveryPrice);
      TextView delivery = NposUi.body(this, del);
      delivery.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.6f));
      delivery.setGravity(Gravity.END);
      row.addView(delivery);
      listRoot.addView(row);
    }
    TextView note = NposUi.caption(this, getString(R.string.menu_admin_prices_readonly));
    note.setPadding(0, NposUi.dp(this, 12), 0, 0);
    listRoot.addView(note);
  }

  private LinearLayout tableHeader(String c1, String c2, String c3) {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 4), NposUi.dp(this, 8), NposUi.dp(this, 4));
    TextView a = NposUi.caption(this, c1);
    a.setTypeface(NposFonts.semibold(this));
    a.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f));
    TextView b = NposUi.caption(this, c2);
    b.setTypeface(NposFonts.semibold(this));
    b.setGravity(Gravity.CENTER);
    b.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.7f));
    TextView c = NposUi.caption(this, c3);
    c.setTypeface(NposFonts.semibold(this));
    c.setGravity(Gravity.END);
    c.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.8f));
    row.addView(a);
    row.addView(b);
    row.addView(c);
    return row;
  }

  private TextView emptyLine(String msg) {
    TextView tv = NposUi.body(this, msg);
    tv.setPadding(0, NposUi.dp(this, 16), 0, 0);
    return tv;
  }

  private List<MenuModels.Item> itemsInCategory(String categoryId) {
    List<MenuModels.Item> out = new ArrayList<>();
    if (menu == null || menu.items == null) return out;
    for (MenuModels.Item item : menu.items) {
      if (categoryId != null && categoryId.equals(item.categoryId)) out.add(item);
    }
    return out;
  }

  private String findCategoryName(String categoryId) {
    if (menu == null || menu.categories == null || categoryId == null) return null;
    for (MenuModels.Category c : menu.categories) {
      if (categoryId.equals(c.id)) return c.name;
    }
    return null;
  }

  private int countItemsUsingGroup(String groupId) {
    if (menu == null || menu.items == null || groupId == null) return 0;
    int n = 0;
    for (MenuModels.Item item : menu.items) {
      if (item.optionGroupIds != null && item.optionGroupIds.contains(groupId)) n++;
    }
    return n;
  }

  private void runToggle(MenuModels.Item item) {
    if (toggleBusy || item == null) return;
    if (menu != null && menu.demo) {
      Toast.makeText(this, R.string.sold_out_demo_blocked, Toast.LENGTH_SHORT).show();
      return;
    }
    boolean toSoldOut = item.active;
    toggleBusy = true;
    statusLine.setText(R.string.menu_admin_saving);
    render();
    menuRepo.toggleSoldOut(
        this,
        item.id,
        toSoldOut,
        (ok, active, err) ->
            runOnUiThread(
                () -> {
                  toggleBusy = false;
                  if (!ok) {
                    statusLine.setText(R.string.sold_out_fail);
                    Toast.makeText(this, R.string.sold_out_fail, Toast.LENGTH_LONG).show();
                    render();
                    return;
                  }
                  replaceItemActive(item.id, active);
                  statusLine.setText(R.string.menu_admin_saved);
                  Toast.makeText(
                          this,
                          active
                              ? R.string.menu_admin_restored_toast
                              : R.string.menu_admin_sold_out_toast,
                          Toast.LENGTH_SHORT)
                      .show();
                  render();
                  // Pull snapshot so cache + other listeners stay aligned.
                  reload(true);
                }));
  }

  private void replaceItemActive(String id, boolean active) {
    if (menu == null) return;
    List<MenuModels.Item> next = new ArrayList<>();
    for (MenuModels.Item it : menu.items) {
      if (it.id.equals(id)) {
        next.add(
            new MenuModels.Item(
                it.id,
                it.categoryId,
                it.name,
                it.price,
                it.deliveryPrice,
                it.optionGroupIds,
                it.imageUrl,
                active,
                it.recommended));
      } else {
        next.add(it);
      }
    }
    menu =
        new MenuModels.Bundle(
            menu.categories,
            next,
            menu.optionGroups,
            menu.demo,
            menu.fetchedAt,
            menu.menuArrangeMode);
  }

  private void scrollFocusIntoView() {
    if (focusItemId == null || focusItemId.isEmpty()) return;
    View row = itemRowById.get(focusItemId);
    if (row == null) return;
    row.post(
        () -> {
          Object parent = row.getParent();
          while (parent instanceof View && !(parent instanceof ScrollView)) {
            parent = ((View) parent).getParent();
          }
          if (parent instanceof ScrollView) {
            ((ScrollView) parent).requestChildFocus(row, row);
          }
          row.setBackgroundColor(0x55E85D24);
          row.postDelayed(() -> row.setBackgroundColor(0x22E85D24), 1200L);
        });
  }
}
