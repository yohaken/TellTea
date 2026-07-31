package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.MenuSyncCoordinator;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/**
 * Native menu catalog admin — BOH /menu/ parity (P1–P4).
 * Hub「เมนู」 · requires open shift.
 */
public class MenuAdminActivity extends Activity implements MenuSyncCoordinator.Listener {
  public static final String EXTRA_FOCUS_ITEM_ID = "focusItemId";
  private static final int REQ_EDIT = 7201;

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
  private boolean showArchived;

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

    TextView hint = NposUi.caption(this, getString(R.string.menu_admin_hint_full));
    hint.setPadding(0, 0, 0, NposUi.dp(this, 8));
    page.addView(hint);

    page.addView(buildTabRow());

    statusLine = NposUi.caption(this, getString(R.string.sell_loading_menu));
    statusLine.setPadding(0, 0, 0, NposUi.dp(this, 6));
    page.addView(statusLine);

    LinearLayout tools = new LinearLayout(this);
    tools.setOrientation(LinearLayout.HORIZONTAL);
    tools.setGravity(Gravity.CENTER_VERTICAL);
    TextView refresh = NposUi.secondary(this, getString(R.string.btn_refresh_menu));
    refresh.setOnClickListener(v -> reload(true));
    TextView add = NposUi.primary(this, getString(R.string.menu_admin_add));
    add.setOnClickListener(v -> onAdd());
    TextView arch = NposUi.chip(this, getString(R.string.menu_admin_show_archived));
    arch.setOnClickListener(
        v -> {
          showArchived = !showArchived;
          NposUi.applyBtn(arch, showArchived ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
          render();
        });
    refresh.setLayoutParams(NposUi.wrap(this, 8, 8));
    add.setLayoutParams(NposUi.wrap(this, 8, 8));
    arch.setLayoutParams(NposUi.wrap(this, 0, 8));
    tools.addView(refresh);
    tools.addView(add);
    tools.addView(arch);
    page.addView(tools);

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
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
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == REQ_EDIT && resultCode == RESULT_OK) reload(true);
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
          reload(true);
        });
  }

  private LinearLayout buildTabRow() {
    HorizontalScrollView hsv = new HorizontalScrollView(this);
    hsv.setHorizontalScrollBarEnabled(false);
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
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
    tabItems.setLayoutParams(NposUi.wrap(this, 8, 0));
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
    NposUi.applyBtn(tabItems, tab == Tab.ITEMS ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
    NposUi.applyBtn(tabGroups, tab == Tab.GROUPS ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
    NposUi.applyBtn(tabPrices, tab == Tab.PRICES ? NposUi.Btn.CHIP_PRIMARY : NposUi.Btn.CHIP);
  }

  private void reload(boolean forceNetwork) {
    statusLine.setText(forceNetwork ? R.string.sell_menu_syncing : R.string.sell_loading_menu);
    menuRepo.loadAdminMenu(
        this,
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

  private void onAdd() {
    if (menu != null && menu.demo) {
      Toast.makeText(this, R.string.sold_out_demo_blocked, Toast.LENGTH_SHORT).show();
      return;
    }
    if (tab == Tab.GROUPS) {
      promptText(
          getString(R.string.menu_group_new_title),
          "",
          name -> mutate("addGroup", new JSONObject().put("name", name), true));
      return;
    }
    if (tab == Tab.PRICES) {
      tab = Tab.ITEMS;
      paintTabs();
      render();
    }
    // Category or item
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = NposUi.dp(this, 12);
    box.setPadding(pad, pad, pad, pad);
    final AlertDialog[] holder = new AlertDialog[1];
    TextView addCat = NposUi.primary(this, getString(R.string.menu_admin_add_category));
    addCat.setMaxWidth(Integer.MAX_VALUE);
    addCat.setLayoutParams(NposUi.matchWidth(this, 8));
    addCat.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          promptText(
              getString(R.string.menu_admin_add_category),
              "",
              name -> mutate("addCategory", new JSONObject().put("name", name), true));
        });
    box.addView(addCat);
    TextView addItem = NposUi.secondary(this, getString(R.string.menu_admin_add_item));
    addItem.setMaxWidth(Integer.MAX_VALUE);
    addItem.setLayoutParams(NposUi.matchWidth(this, 8));
    addItem.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          Intent intent = new Intent(this, MenuItemEditActivity.class);
          if (menu != null && menu.categories != null) {
            for (MenuModels.Category c : menu.categories) {
              if (c.active) {
                intent.putExtra(MenuItemEditActivity.EXTRA_CATEGORY_ID, c.id);
                break;
              }
            }
          }
          startActivityForResult(intent, REQ_EDIT);
        });
    box.addView(addItem);
    TextView cancel = NposUi.ghost(this, getString(android.R.string.cancel));
    cancel.setMaxWidth(Integer.MAX_VALUE);
    cancel.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
        });
    box.addView(cancel);
    holder[0] =
        new AlertDialog.Builder(this).setTitle(R.string.menu_admin_add).setView(box).create();
    holder[0].show();
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
    for (MenuModels.Category cat : menu.categories) {
      if (!showArchived && !cat.active) continue;
      List<MenuModels.Item> inCat = itemsInCategory(cat.id);
      LinearLayout head = new LinearLayout(this);
      head.setOrientation(LinearLayout.HORIZONTAL);
      head.setGravity(Gravity.CENTER_VERTICAL);
      head.setPadding(0, NposUi.dp(this, 12), 0, NposUi.dp(this, 4));
      TextView catHead =
          NposUi.section(
              this,
              cat.name
                  + (cat.active ? "" : " · " + getString(R.string.menu_admin_archived))
                  + " ("
                  + inCat.size()
                  + ")");
      catHead.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
      head.addView(catHead);
      TextView rename = NposUi.chip(this, getString(R.string.menu_admin_rename));
      rename.setOnClickListener(
          v ->
              promptText(
                  getString(R.string.menu_admin_rename),
                  cat.name,
                  name ->
                      mutate(
                          "updateCategory",
                          new JSONObject().put("id", cat.id).put("name", name),
                          true)));
      head.addView(rename);
      listRoot.addView(head);
      if (inCat.isEmpty()) {
        listRoot.addView(NposUi.caption(this, getString(R.string.menu_admin_empty_items)));
        continue;
      }
      for (MenuModels.Item item : inCat) {
        if (!showArchived && item.isArchived()) continue;
        listRoot.addView(itemRow(item));
      }
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
    textCol.setLayoutParams(
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f));
    TextView name = NposUi.body(this, item.name);
    name.setTextColor(NposUi.color(this, R.color.npos_ink));
    name.setTypeface(NposFonts.semibold(this));
    textCol.addView(name);
    textCol.addView(
        NposUi.caption(
            this,
            String.format(
                Locale.getDefault(),
                "฿%.0f%s%s",
                item.price,
                Double.isNaN(item.deliveryPrice)
                    ? ""
                    : String.format(Locale.getDefault(), " · ส่ง ฿%.0f", item.deliveryPrice),
                item.isArchived() ? " · " + getString(R.string.menu_admin_archived) : "")));
    row.addView(textCol);

    TextView status =
        NposUi.caption(
            this,
            getString(
                item.isArchived()
                    ? R.string.menu_admin_archived
                    : item.active
                        ? R.string.menu_admin_status_on
                        : R.string.menu_admin_status_off));
    status.setTextColor(
        item.active && !item.isArchived()
            ? NposUi.color(this, R.color.npos_ink)
            : NposUi.color(this, R.color.npos_orange));
    status.setLayoutParams(
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.6f));
    row.addView(status);

    if (!item.isArchived()) {
      TextView toggle =
          item.active
              ? NposUi.secondary(this, getString(R.string.menu_admin_btn_sold_out))
              : NposUi.primary(this, getString(R.string.menu_admin_btn_restore));
      toggle.setMaxWidth(NposUi.dp(this, 140));
      toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f);
      toggle.setEnabled(!toggleBusy && menu != null && !menu.demo);
      toggle.setOnClickListener(v -> runToggle(item));
      row.addView(toggle);
    } else {
      TextView restore = NposUi.primary(this, getString(R.string.menu_admin_restore));
      restore.setMaxWidth(NposUi.dp(this, 140));
      restore.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f);
      restore.setOnClickListener(
          v -> mutate("restoreItem", jsonId(item.id), true));
      row.addView(restore);
    }

    row.setOnClickListener(
        v -> {
          Intent intent = new Intent(this, MenuItemEditActivity.class);
          intent.putExtra(MenuItemEditActivity.EXTRA_ITEM_ID, item.id);
          startActivityForResult(intent, REQ_EDIT);
        });
    itemRowById.put(item.id, row);
    return row;
  }

  private void renderGroups() {
    if (menu.optionGroups == null || menu.optionGroups.isEmpty()) {
      listRoot.addView(emptyLine(getString(R.string.menu_admin_empty_groups)));
      return;
    }
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      if (!showArchived && !g.active) continue;
      int used = countItemsUsingGroup(g.id);
      String line =
          g.name
              + (g.active ? "" : " · " + getString(R.string.menu_admin_archived))
              + (g.required ? " · " + getString(R.string.menu_admin_required) : "")
              + " · "
              + getString(R.string.menu_admin_used_by_fmt, used);
      TextView head = NposUi.section(this, line);
      head.setPadding(0, NposUi.dp(this, 10), 0, NposUi.dp(this, 4));
      head.setOnClickListener(
          v -> {
            Intent intent = new Intent(this, MenuGroupEditActivity.class);
            intent.putExtra(MenuGroupEditActivity.EXTRA_GROUP_ID, g.id);
            startActivityForResult(intent, REQ_EDIT);
          });
      listRoot.addView(head);
      if (g.options != null) {
        for (MenuModels.Option opt : g.options) {
          if (!showArchived && !opt.active) continue;
          String price =
              String.format(
                  Locale.getDefault(),
                  "%s  +฿%.0f%s%s",
                  opt.name,
                  opt.priceDelta,
                  Double.isNaN(opt.deliveryPriceDelta)
                      ? ""
                      : String.format(
                          Locale.getDefault(), " · ส่ง +฿%.0f", opt.deliveryPriceDelta),
                  opt.active ? "" : " · " + getString(R.string.menu_admin_status_off));
          TextView row = NposUi.body(this, price);
          row.setPadding(NposUi.dp(this, 12), NposUi.dp(this, 4), 0, NposUi.dp(this, 4));
          row.setOnClickListener(
              v -> {
                Intent intent = new Intent(this, MenuGroupEditActivity.class);
                intent.putExtra(MenuGroupEditActivity.EXTRA_GROUP_ID, g.id);
                startActivityForResult(intent, REQ_EDIT);
              });
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
      if (!showArchived && item.isArchived()) continue;
      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 6), NposUi.dp(this, 8), NposUi.dp(this, 6));
      TextView name = NposUi.body(this, item.name);
      name.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f));
      row.addView(name);
      TextView store =
          NposUi.secondary(
              this, String.format(Locale.getDefault(), "฿%.0f", item.price));
      store.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
      store.setOnClickListener(v -> editPrice(item, false));
      store.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.7f));
      row.addView(store);
      String del =
          Double.isNaN(item.deliveryPrice)
              ? "—"
              : String.format(Locale.getDefault(), "฿%.0f", item.deliveryPrice);
      TextView delivery = NposUi.secondary(this, del);
      delivery.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
      delivery.setOnClickListener(v -> editPrice(item, true));
      delivery.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.7f));
      row.addView(delivery);
      listRoot.addView(row);
    }
    TextView note = NposUi.caption(this, getString(R.string.menu_admin_prices_hint));
    note.setPadding(0, NposUi.dp(this, 12), 0, 0);
    listRoot.addView(note);
  }

  private void editPrice(MenuModels.Item item, boolean delivery) {
    String current =
        delivery
            ? (Double.isNaN(item.deliveryPrice) ? "" : String.format(Locale.US, "%.0f", item.deliveryPrice))
            : String.format(Locale.US, "%.0f", item.price);
    promptText(
        getString(delivery ? R.string.menu_admin_col_delivery : R.string.menu_admin_col_store)
            + " · "
            + item.name,
        current,
        value -> {
          JSONObject body = new JSONObject();
          body.put("action", "updateItem");
          body.put("id", item.id);
          if (delivery) {
            if (value.trim().isEmpty()) body.put("deliveryPrice", JSONObject.NULL);
            else body.put("deliveryPrice", Double.parseDouble(value.replaceAll("[^\\d.]", "")));
          } else {
            body.put("price", Double.parseDouble(value.replaceAll("[^\\d.]", "")));
          }
          mutate("updateItem", body, true);
        });
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
    c.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.7f));
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
                    return;
                  }
                  Toast.makeText(
                          this,
                          active
                              ? R.string.menu_admin_restored_toast
                              : R.string.menu_admin_sold_out_toast,
                          Toast.LENGTH_SHORT)
                      .show();
                  reload(true);
                }));
  }

  private interface TextConsumer {
    void accept(String value) throws Exception;
  }

  private void promptText(String title, String initial, TextConsumer onOk) {
    EditText field = NposUi.field(this);
    field.setInputType(InputType.TYPE_CLASS_TEXT);
    field.setText(initial == null ? "" : initial);
    field.setSelectAllOnFocus(true);
    NposConfirmDialog.custom(
        this,
        title,
        null,
        field,
        getString(android.R.string.ok),
        getString(android.R.string.cancel),
        true,
        () -> {
          try {
            onOk.accept(field.getText() == null ? "" : field.getText().toString().trim());
          } catch (Exception e) {
            Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
          }
          return true;
        },
        null);
  }

  private JSONObject jsonId(String id) {
    try {
      return new JSONObject().put("id", id);
    } catch (Exception e) {
      return new JSONObject();
    }
  }

  private void mutate(String action, JSONObject body, boolean reloadAfter) {
    try {
      if (body == null) body = new JSONObject();
      body.put("action", action);
      statusLine.setText(R.string.menu_admin_saving);
      menuRepo.mutate(
          this,
          body,
          (ok, res, err) ->
              runOnUiThread(
                  () -> {
                    if (!ok) {
                      statusLine.setText(R.string.menu_admin_save_fail);
                      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
                      return;
                    }
                    statusLine.setText(R.string.menu_admin_saved);
                    if (reloadAfter) reload(true);
                  }));
    } catch (Exception e) {
      Toast.makeText(this, R.string.menu_admin_save_fail, Toast.LENGTH_LONG).show();
    }
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
