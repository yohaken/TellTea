package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import app.telltea.npos.diagnose.CustomerDisplayController;
import app.telltea.npos.diagnose.CustomerDisplayPresentation;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.PromptPayPayload;
import app.telltea.npos.sell.QrBitmaps;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * Sell screen — clone web PosSellView: categories, menu images, options, cart, discount,
 * cash / PromptPay QR, sold-out long-press.
 */
public class SellActivity extends Activity {
  private LinearLayout categoryBar;
  private GridLayout menuGrid;
  private LinearLayout cartList;
  private TextView cartTotalView;
  private TextView sellSyncStatus;
  private TextView sellTitle;
  private TextView discountLabel;
  private TextView shiftSummary;
  private Button flushSyncButton;
  private Button restoreHoldButton;

  private MenuRepository menuRepo;
  private SaleSync saleSync;
  private MenuModels.Bundle menu;
  private JSONObject shop;
  private String selectedCategoryId = "";
  private final List<MenuModels.CartLine> cart = new ArrayList<>();
  private double discountBaht = 0;
  private CustomerDisplayController customerDisplay;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      finish();
      return;
    }
    setContentView(R.layout.activity_sell);

    categoryBar = findViewById(R.id.categoryBar);
    menuGrid = findViewById(R.id.menuGrid);
    cartList = findViewById(R.id.cartList);
    cartTotalView = findViewById(R.id.cartTotal);
    sellSyncStatus = findViewById(R.id.sellSyncStatus);
    sellTitle = findViewById(R.id.sellTitle);
    discountLabel = findViewById(R.id.discountLabel);
    shiftSummary = findViewById(R.id.shiftSummary);
    flushSyncButton = findViewById(R.id.flushSyncButton);
    restoreHoldButton = findViewById(R.id.restoreHoldButton);

    menuRepo = new MenuRepository();
    saleSync = new SaleSync();
    customerDisplay = new CustomerDisplayController();
    customerDisplay.bind(this);

    findViewById(R.id.backButton).setOnClickListener(v -> finish());
    findViewById(R.id.payCashButton).setOnClickListener(v -> startPay("cash"));
    findViewById(R.id.payPromptButton).setOnClickListener(v -> startPay("promptpay"));
    findViewById(R.id.discountButton).setOnClickListener(v -> showDiscountDialog());
    findViewById(R.id.holdBillButton).setOnClickListener(v -> holdBill());
    restoreHoldButton.setOnClickListener(v -> restoreHold());
    flushSyncButton.setOnClickListener(v -> flushPendingNow());
    findViewById(R.id.refreshMenuButton).setOnClickListener(v -> reloadMenu(true));
    findViewById(R.id.xReportButton).setOnClickListener(v -> printXReport());
    findViewById(R.id.receiptsButton)
        .setOnClickListener(v -> startActivity(new Intent(this, ReceiptsActivity.class)));
    findViewById(R.id.sellSettingsButton)
        .setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
    findViewById(R.id.sellCloseShiftButton).setOnClickListener(v -> closeShift());

    sellSyncStatus.setText(R.string.sell_loading_menu);
    menuRepo.loadShop(
        this,
        s ->
            runOnUiThread(
                () -> {
                  shop = s;
                  applyShopToCustomerDisplay();
                  syncCustomerDisplay();
                }));
    reloadMenu(false);
    saleSync.flushPending(this);
    updateShiftSummary();
    updateHoldRestoreButton();
    updatePendingBadge();
    syncCustomerDisplay();
  }

  private void holdBill() {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    try {
      HoldCart.save(this, cart, discountBaht);
      cart.clear();
      discountBaht = 0;
      renderCart();
      updateHoldRestoreButton();
      Toast.makeText(this, R.string.hold_saved, Toast.LENGTH_SHORT).show();
      OpsLogger.info(this, "sale", "พักบิล", "");
    } catch (Exception e) {
      Toast.makeText(this, R.string.hold_fail, Toast.LENGTH_SHORT).show();
    }
  }

  private void restoreHold() {
    if (!HoldCart.hasHold(this)) {
      Toast.makeText(this, R.string.hold_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    if (!cart.isEmpty()) {
      new AlertDialog.Builder(this)
          .setTitle(R.string.hold_restore_title)
          .setMessage(R.string.hold_restore_replace)
          .setPositiveButton(
              android.R.string.ok,
              (d, w) -> {
                cart.clear();
                doRestoreHold();
              })
          .setNegativeButton(android.R.string.cancel, null)
          .show();
      return;
    }
    doRestoreHold();
  }

  private void doRestoreHold() {
    try {
      HoldCart.Held held = HoldCart.restore(this);
      if (held == null || held.lines.isEmpty()) {
        Toast.makeText(this, R.string.hold_empty, Toast.LENGTH_SHORT).show();
        updateHoldRestoreButton();
        return;
      }
      cart.addAll(held.lines);
      discountBaht = held.discountBaht;
      renderCart();
      updateHoldRestoreButton();
      Toast.makeText(this, R.string.hold_restored, Toast.LENGTH_SHORT).show();
    } catch (Exception e) {
      Toast.makeText(this, R.string.hold_fail, Toast.LENGTH_SHORT).show();
    }
  }

  private void updateHoldRestoreButton() {
    if (restoreHoldButton == null) return;
    restoreHoldButton.setEnabled(HoldCart.hasHold(this));
  }

  private void flushPendingNow() {
    showPendingOutboxDialog();
  }

  /** W4: pending/failed outbox list — sync all, retry one, cancel local. */
  private void showPendingOutboxDialog() {
    List<JSONObject> rows = saleSync.listPending(this);
    if (rows.isEmpty()) {
      Toast.makeText(this, R.string.outbox_empty, Toast.LENGTH_SHORT).show();
      updatePendingBadge();
      return;
    }
    ScrollView scroll = new ScrollView(this);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) (12 * getResources().getDisplayMetrics().density);
    root.setPadding(pad, pad, pad, pad);
    for (JSONObject row : rows) {
      String mid = row.optString("clientMutationId", "");
      String status = row.optString("status", "pending");
      double total = row.optDouble("localTotal", 0);
      String err = row.optString("lastError", "");
      int attempts = row.optInt("attempts", 0);
      String shortId =
          mid.length() > 6 ? mid.substring(mid.length() - 6).toUpperCase(Locale.US) : mid;
      TextView line = new TextView(this);
      line.setText(
          getString(
              R.string.outbox_row_fmt,
              shortId,
              total,
              "failed".equals(status) ? "ล้มเหลว" : "รอส่ง",
              attempts,
              err.isEmpty() ? "—" : err));
      line.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
      line.setPadding(0, pad / 2, 0, pad / 2);
      root.addView(line);

      LinearLayout actions = new LinearLayout(this);
      actions.setOrientation(LinearLayout.HORIZONTAL);
      Button retry = new Button(this);
      retry.setText(R.string.outbox_retry_one);
      retry.setOnClickListener(
          v -> {
            sellSyncStatus.setText(R.string.sell_flushing);
            saleSync.retryPending(
                this,
                mid,
                () ->
                    runOnUiThread(
                        () -> {
                          updatePendingBadge();
                          Toast.makeText(this, R.string.outbox_retry_done, Toast.LENGTH_SHORT)
                              .show();
                        }));
          });
      Button cancel = new Button(this);
      cancel.setText(R.string.outbox_cancel_one);
      cancel.setOnClickListener(
          v ->
              new AlertDialog.Builder(this)
                  .setTitle(R.string.outbox_cancel_title)
                  .setMessage(R.string.outbox_cancel_msg)
                  .setPositiveButton(
                      android.R.string.ok,
                      (d, w) ->
                          saleSync.cancelPending(
                              this,
                              mid,
                              () ->
                                  runOnUiThread(
                                      () -> {
                                        updatePendingBadge();
                                        updateShiftSummary();
                                        Toast.makeText(
                                                this,
                                                R.string.outbox_cancel_done,
                                                Toast.LENGTH_SHORT)
                                            .show();
                                      })))
                  .setNegativeButton(android.R.string.cancel, null)
                  .show());
      actions.addView(retry);
      actions.addView(cancel);
      root.addView(actions);
    }
    scroll.addView(root);
    new AlertDialog.Builder(this)
        .setTitle(getString(R.string.outbox_title_n, rows.size()))
        .setView(scroll)
        .setPositiveButton(
            R.string.outbox_sync_all,
            (d, w) -> {
              sellSyncStatus.setText(R.string.sell_flushing);
              saleSync.flushPending(this);
              flushSyncButton.postDelayed(this::updatePendingBadge, 1200);
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void updatePendingBadge() {
    int n = saleSync.pendingCount(this);
    int failed = saleSync.failedCount(this);
    if (flushSyncButton != null) {
      if (n > 0) {
        flushSyncButton.setVisibility(View.VISIBLE);
        if (failed > 0) {
          flushSyncButton.setText(getString(R.string.btn_flush_sync_failed_n, n, failed));
        } else {
          flushSyncButton.setText(getString(R.string.btn_flush_sync_n, n));
        }
      } else {
        flushSyncButton.setVisibility(View.GONE);
      }
    }
    if (n > 0 && sellSyncStatus != null) {
      if (failed > 0) {
        sellSyncStatus.setText(getString(R.string.sell_pending_failed_n, n, failed));
      } else {
        sellSyncStatus.setText(getString(R.string.sell_pending_n, n));
      }
    }
  }

  private void updateShiftSummary() {
    if (shiftSummary == null) return;
    shiftSummary.setText(
        getString(
            R.string.shift_summary_fmt,
            ShiftPrefs.saleCount(this),
            ShiftPrefs.cashTotal(this),
            ShiftPrefs.promptpayTotal(this),
            ShiftPrefs.voidedCount(this)));
  }

  private void reloadMenu(boolean forceNetwork) {
    if (menu == null) {
      sellSyncStatus.setText(R.string.sell_loading_menu);
    } else if (forceNetwork) {
      sellSyncStatus.setText(R.string.sell_menu_syncing);
    }
    menuRepo.loadMenu(
        this,
        forceNetwork,
        bundle ->
            runOnUiThread(
                () -> {
                  menu = bundle;
                  if (bundle.demo) {
                    sellTitle.setText(R.string.sell_title_demo);
                    sellSyncStatus.setText(R.string.sell_menu_demo);
                  } else {
                    sellTitle.setText(R.string.sell_title);
                    sellSyncStatus.setText(R.string.sell_menu_ready);
                  }
                  if (!bundle.categories.isEmpty()
                      && (selectedCategoryId.isEmpty()
                          || !categoryExists(selectedCategoryId))) {
                    selectedCategoryId = bundle.categories.get(0).id;
                  }
                  renderCategories();
                  renderMenu();
                  renderCart();
                  prefetchMenuImages();
                  if (customerDisplay != null && menu != null) {
                    customerDisplay.setRecommended(menu.items);
                    if (cart.isEmpty()) customerDisplay.showStandby();
                  }
                }));
  }

  private void prefetchMenuImages() {
    if (menu == null) return;
    java.util.ArrayList<String> urls = new java.util.ArrayList<>();
    for (MenuModels.Item item : menu.items) {
      if (item.imageUrl != null && !item.imageUrl.isEmpty()) urls.add(item.imageUrl);
    }
    ImageLoader.prefetch(this, urls);
  }

  private boolean categoryExists(String id) {
    if (menu == null) return false;
    for (MenuModels.Category c : menu.categories) {
      if (c.id.equals(id)) return true;
    }
    return false;
  }

  @Override
  protected void onResume() {
    super.onResume();
    updateShiftSummary();
    updateHoldRestoreButton();
    updatePendingBadge();
    if (saleSync != null) saleSync.flushPending(this);
    if (customerDisplay != null && sellSyncStatus != null && cart.isEmpty()) {
      sellSyncStatus.setText(customerDisplay.statusLabel(this));
      syncCustomerDisplay();
    }
  }

  @Override
  protected void onDestroy() {
    if (customerDisplay != null) {
      customerDisplay.release();
      customerDisplay = null;
    }
    if (menuRepo != null) menuRepo.shutdown();
    if (saleSync != null) saleSync.shutdown();
    super.onDestroy();
  }

  private void applyShopToCustomerDisplay() {
    if (customerDisplay == null || shop == null) return;
    customerDisplay.setShop(
        shop.optString("shopName", "TellTea"),
        shop.optString("receiptFooterNote", getString(R.string.customer_success_default)));
  }

  private void closeShift() {
    sellSyncStatus.setText(R.string.sell_closing_shift);
    saleSync.printShiftReport(
        this,
        "close",
        () ->
            saleSync.closeSession(
                this,
                () ->
                    runOnUiThread(
                        () -> {
                          Toast.makeText(this, R.string.shift_closed, Toast.LENGTH_SHORT).show();
                          finish();
                        })));
  }

  private void printXReport() {
    sellSyncStatus.setText(R.string.sell_printing_x);
    saleSync.printShiftReport(
        this,
        "snapshot",
        () ->
            runOnUiThread(
                () -> {
                  sellSyncStatus.setText(R.string.sell_x_printed);
                  Toast.makeText(this, R.string.sell_x_printed, Toast.LENGTH_SHORT).show();
                }));
  }

  private void renderCategories() {
    categoryBar.removeAllViews();
    if (menu == null) return;
    applySavedCategoryOrder();
    float density = getResources().getDisplayMetrics().density;
    int padH = Math.round(12 * density);
    int padV = Math.round(8 * density);
    int gap = Math.round(6 * density);
    for (int i = 0; i < menu.categories.size(); i++) {
      final int idx = i;
      MenuModels.Category cat = menu.categories.get(i);
      Button b = new Button(this);
      b.setText(cat.name);
      b.setAllCaps(false);
      b.setMinHeight(Math.round(40 * density));
      b.setPadding(padH, padV, padH, padV);
      LinearLayout.LayoutParams lp =
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
      lp.setMargins(0, 0, gap, 0);
      b.setLayoutParams(lp);
      boolean active = cat.id.equals(selectedCategoryId);
      if (active) {
        b.setBackgroundColor(0xFF1E2D3D);
        b.setTextColor(0xFFFFFFFF);
      } else {
        b.setBackgroundColor(0xFFFFFFFF);
        b.setTextColor(0xFF1E2D3D);
      }
      b.setOnClickListener(
          v -> {
            selectedCategoryId = cat.id;
            renderCategories();
            renderMenu();
          });
      b.setOnLongClickListener(
          v -> {
            moveCategory(idx, idx == 0 ? 1 : -1);
            return true;
          });
      categoryBar.addView(b);
    }
  }

  /** Long-press: move left (or right if already first) — clone web sell category reorder. */
  private void moveCategory(int from, int delta) {
    if (menu == null) return;
    int to = from + delta;
    if (to < 0 || to >= menu.categories.size()) return;
    List<MenuModels.Category> next = new ArrayList<>(menu.categories);
    MenuModels.Category moved = next.remove(from);
    next.add(to, moved);
    menu =
        new MenuModels.Bundle(
            next, menu.items, menu.optionGroups, menu.demo, menu.fetchedAt);
    saveCategoryOrder();
    menuRepo.reorderCategories(this, next);
    renderCategories();
    Toast.makeText(this, R.string.category_reordered, Toast.LENGTH_SHORT).show();
  }

  private void applySavedCategoryOrder() {
    if (menu == null || menu.categories.size() < 2) return;
    String raw =
        getSharedPreferences("npos_menu", MODE_PRIVATE).getString("categoryOrder", null);
    if (raw == null || raw.isEmpty()) return;
    try {
      JSONArray ids = new JSONArray(raw);
      List<MenuModels.Category> ordered = new ArrayList<>();
      java.util.HashSet<String> seen = new java.util.HashSet<>();
      for (int i = 0; i < ids.length(); i++) {
        String id = ids.optString(i);
        for (MenuModels.Category c : menu.categories) {
          if (c.id.equals(id) && seen.add(c.id)) ordered.add(c);
        }
      }
      for (MenuModels.Category c : menu.categories) {
        if (seen.add(c.id)) ordered.add(c);
      }
      if (ordered.size() == menu.categories.size()) {
        menu =
            new MenuModels.Bundle(
                ordered, menu.items, menu.optionGroups, menu.demo, menu.fetchedAt);
      }
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private void saveCategoryOrder() {
    if (menu == null) return;
    try {
      JSONArray ids = new JSONArray();
      for (MenuModels.Category c : menu.categories) ids.put(c.id);
      getSharedPreferences("npos_menu", MODE_PRIVATE)
          .edit()
          .putString("categoryOrder", ids.toString())
          .apply();
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private void renderMenu() {
    if (menuGrid == null) return;
    menuGrid.removeAllViews();
    if (menu == null) return;
    float density = getResources().getDisplayMetrics().density;
    int gap = Math.round(4 * density);
    int colCount = Math.max(1, menuGrid.getColumnCount());
    int screenW = getResources().getDisplayMetrics().widthPixels;
    int cartW = Math.round(344 * density);
    int leftW = Math.max(200, screenW - cartW - Math.round(24 * density));
    int cellW = Math.max(72, (leftW - gap * (colCount + 1)) / colCount);
    int mediaH = Math.round(cellW * 10f / 16f);

    int shown = 0;
    for (MenuModels.Item item : menu.items) {
      if (!selectedCategoryId.isEmpty() && !selectedCategoryId.equals(item.categoryId)) continue;

      LinearLayout cell = new LinearLayout(this);
      cell.setOrientation(LinearLayout.VERTICAL);
      cell.setBackgroundColor(item.active ? 0xFFFFFFFF : 0xFFE8E8E8);
      cell.setPadding(gap, gap, gap, gap);
      GridLayout.LayoutParams glp = new GridLayout.LayoutParams();
      glp.width = cellW;
      glp.height = GridLayout.LayoutParams.WRAP_CONTENT;
      glp.setMargins(gap / 2, gap / 2, gap / 2, gap / 2);
      cell.setLayoutParams(glp);

      FrameLayout media = new FrameLayout(this);
      media.setLayoutParams(new LinearLayout.LayoutParams(cellW - gap, mediaH));
      ImageView img = new ImageView(this);
      img.setLayoutParams(
          new FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
      img.setScaleType(ImageView.ScaleType.CENTER_CROP);
      ImageLoader.bind(img, item.imageUrl, 0xFFD9E2DC);
      media.addView(img);

      int qty = cartQtyForItem(item.id);
      if (qty > 0) {
        TextView badge = new TextView(this);
        badge.setText(String.valueOf(qty));
        badge.setTextColor(0xFFFFFFFF);
        badge.setTextSize(12);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setBackgroundColor(0xFFE85D24);
        badge.setPadding(Math.round(8 * density), Math.round(2 * density), Math.round(8 * density), Math.round(2 * density));
        FrameLayout.LayoutParams blp =
            new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        blp.gravity = Gravity.TOP | Gravity.END;
        blp.setMargins(0, Math.round(4 * density), Math.round(4 * density), 0);
        badge.setLayoutParams(blp);
        media.addView(badge);
      }
      cell.addView(media);

      TextView name = new TextView(this);
      if (item.recommended) {
        name.setText(getString(R.string.menu_recommended_fmt, item.name));
      } else {
        name.setText(item.name);
      }
      name.setTextSize(12);
      name.setTextColor(0xFF1E2D3D);
      name.setTypeface(Typeface.DEFAULT_BOLD);
      name.setMaxLines(2);
      cell.addView(name);

      TextView price = new TextView(this);
      if (!item.active) {
        price.setText(R.string.menu_sold_out);
        price.setTextColor(0xFFB00020);
      } else {
        price.setText(String.format(Locale.getDefault(), "฿%.0f", item.price));
        price.setTextColor(0xFF555555);
      }
      price.setTextSize(11);
      cell.addView(price);

      if (item.active) {
        cell.setOnClickListener(v -> onTapItem(item));
      } else {
        cell.setOnClickListener(
            v -> Toast.makeText(this, R.string.menu_sold_out, Toast.LENGTH_SHORT).show());
      }
      cell.setOnLongClickListener(
          v -> {
            confirmToggleSoldOut(item);
            return true;
          });
      menuGrid.addView(cell);
      shown++;
    }
    if (shown == 0) {
      TextView empty = new TextView(this);
      empty.setText(R.string.sell_menu_empty);
      empty.setTextColor(0xFF666666);
      GridLayout.LayoutParams elp = new GridLayout.LayoutParams();
      elp.columnSpec = GridLayout.spec(0, colCount);
      elp.width = leftW;
      empty.setLayoutParams(elp);
      menuGrid.addView(empty);
    }
  }

  private int cartQtyForItem(String itemId) {
    int n = 0;
    for (MenuModels.CartLine line : cart) {
      if (itemId != null && itemId.equals(line.menuItemId)) n += line.qty;
    }
    return n;
  }

  private void onTapItem(MenuModels.Item item) {
    if (!item.active) return;
    if (!item.hasOptions()) {
      addItemWithOptions(item, new JSONArray(), item.price);
      return;
    }
    showOptionPicker(item);
  }

  private void confirmToggleSoldOut(MenuModels.Item item) {
    if (menu != null && menu.demo) {
      Toast.makeText(this, R.string.sold_out_demo_blocked, Toast.LENGTH_SHORT).show();
      return;
    }
    boolean toSoldOut = item.active;
    new AlertDialog.Builder(this)
        .setTitle(toSoldOut ? R.string.sold_out_confirm_title : R.string.sold_out_restore_title)
        .setMessage(item.name)
        .setPositiveButton(
            android.R.string.ok,
            (d, w) -> {
              menuRepo.toggleSoldOut(
                  this,
                  item.id,
                  toSoldOut,
                  (ok, active, err) ->
                      runOnUiThread(
                          () -> {
                            if (!ok) {
                              Toast.makeText(this, R.string.sold_out_fail, Toast.LENGTH_LONG)
                                  .show();
                              return;
                            }
                            replaceItemActive(item.id, active);
                            // Clear cart lines for sold-out item (web parity)
                            if (!active) {
                              for (int i = cart.size() - 1; i >= 0; i--) {
                                if (item.id.equals(cart.get(i).menuItemId)) cart.remove(i);
                              }
                              renderCart();
                            }
                            renderMenu();
                          }));
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
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
            menu.categories, next, menu.optionGroups, menu.demo, menu.fetchedAt);
  }

  private void showOptionPicker(MenuModels.Item item) {
    List<MenuModels.OptionGroup> groups = new ArrayList<>();
    for (String gid : item.optionGroupIds) {
      MenuModels.OptionGroup g = findGroup(gid);
      if (g != null && !g.options.isEmpty()) groups.add(g);
    }
    if (groups.isEmpty()) {
      addItemWithOptions(item, new JSONArray(), item.price);
      return;
    }

    ScrollView scroll = new ScrollView(this);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(32, 24, 32, 8);
    scroll.addView(root);

    Map<String, RadioGroup> singleGroups = new HashMap<>();
    Map<String, List<CheckBox>> multiGroups = new HashMap<>();

    for (MenuModels.OptionGroup group : groups) {
      TextView header = new TextView(this);
      String req = group.required ? " *" : "";
      String lim = "";
      if (!group.isSingle()) {
        int min = group.effectiveMin();
        int max = group.effectiveMax();
        if (max == Integer.MAX_VALUE) {
          lim = min > 0 ? " (อย่างน้อย " + min + ")" : " (ไม่จำกัด)";
        } else {
          lim = " (" + min + "–" + max + ")";
        }
      }
      header.setText(group.name + req + lim);
      header.setTextColor(0xFF1A2E24);
      header.setTypeface(Typeface.DEFAULT_BOLD);
      header.setPadding(0, 12, 0, 6);
      root.addView(header);

      if (group.isSingle()) {
        RadioGroup rg = new RadioGroup(this);
        rg.setOrientation(RadioGroup.VERTICAL);
        boolean first = true;
        for (MenuModels.Option opt : group.options) {
          RadioButton rb = new RadioButton(this);
          rb.setId(View.generateViewId());
          String label = opt.name;
          if (opt.priceDelta != 0) {
            label +=
                String.format(
                    Locale.getDefault(),
                    " (%s%.0f)",
                    opt.priceDelta > 0 ? "+" : "",
                    opt.priceDelta);
          }
          rb.setText(label);
          rb.setTag(opt);
          rg.addView(rb);
          if (first && group.effectiveMin() > 0) {
            rb.setChecked(true);
            first = false;
          }
        }
        root.addView(rg);
        singleGroups.put(group.id, rg);
      } else {
        List<CheckBox> boxes = new ArrayList<>();
        final MenuModels.OptionGroup gRef = group;
        for (MenuModels.Option opt : group.options) {
          CheckBox cb = new CheckBox(this);
          String label = opt.name;
          if (opt.priceDelta != 0) {
            label +=
                String.format(
                    Locale.getDefault(),
                    " (%s%.0f)",
                    opt.priceDelta > 0 ? "+" : "",
                    opt.priceDelta);
          }
          cb.setText(label);
          cb.setTag(opt);
          cb.setOnCheckedChangeListener(
              (buttonView, isChecked) -> {
                if (!isChecked) return;
                int selected = 0;
                for (CheckBox b : boxes) if (b.isChecked()) selected++;
                if (selected > gRef.effectiveMax()) {
                  buttonView.setChecked(false);
                  Toast.makeText(
                          SellActivity.this,
                          getString(R.string.option_max, gRef.name, gRef.effectiveMax()),
                          Toast.LENGTH_SHORT)
                      .show();
                }
              });
          root.addView(cb);
          boxes.add(cb);
        }
        multiGroups.put(group.id, boxes);
      }
    }

    new AlertDialog.Builder(this)
        .setTitle(item.name)
        .setView(scroll)
        .setPositiveButton(
            R.string.btn_add_to_cart,
            (d, w) -> {
              try {
                JSONArray optionsJson = new JSONArray();
                double unit = item.price;
                for (MenuModels.OptionGroup group : groups) {
                  List<MenuModels.Option> chosen = new ArrayList<>();
                  if (group.isSingle()) {
                    RadioGroup rg = singleGroups.get(group.id);
                    int checked = rg == null ? -1 : rg.getCheckedRadioButtonId();
                    if (checked != -1) {
                      RadioButton rb = rg.findViewById(checked);
                      if (rb != null && rb.getTag() instanceof MenuModels.Option) {
                        chosen.add((MenuModels.Option) rb.getTag());
                      }
                    }
                  } else {
                    List<CheckBox> boxes = multiGroups.get(group.id);
                    if (boxes != null) {
                      for (CheckBox cb : boxes) {
                        if (cb.isChecked() && cb.getTag() instanceof MenuModels.Option) {
                          chosen.add((MenuModels.Option) cb.getTag());
                        }
                      }
                    }
                  }
                  int min = group.effectiveMin();
                  int max = group.effectiveMax();
                  if (chosen.size() < min) {
                    Toast.makeText(
                            this,
                            getString(R.string.option_min, group.name, min),
                            Toast.LENGTH_LONG)
                        .show();
                    return;
                  }
                  if (chosen.size() > max) {
                    Toast.makeText(
                            this,
                            getString(R.string.option_max, group.name, max),
                            Toast.LENGTH_LONG)
                        .show();
                    return;
                  }
                  if (chosen.isEmpty()) continue;
                  JSONObject g = new JSONObject();
                  g.put("groupId", group.id);
                  g.put("groupName", group.name);
                  JSONArray choices = new JSONArray();
                  for (MenuModels.Option opt : chosen) {
                    JSONObject c = new JSONObject();
                    c.put("optionId", opt.id);
                    c.put("name", opt.name);
                    c.put("priceDelta", opt.priceDelta);
                    choices.put(c);
                    unit += opt.priceDelta;
                  }
                  g.put("choices", choices);
                  optionsJson.put(g);
                }
                addItemWithOptions(item, optionsJson, unit);
              } catch (Exception e) {
                Toast.makeText(this, R.string.option_pick_fail, Toast.LENGTH_SHORT).show();
              }
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void addItemWithOptions(MenuModels.Item item, JSONArray optionsJson, double unit) {
    cart.add(new MenuModels.CartLine(item.id, item.name, unit, 1, optionsJson));
    renderCart();
    OpsLogger.info(this, "sale", "เพิ่มเมนู", item.name);
  }

  private MenuModels.OptionGroup findGroup(String id) {
    if (menu == null) return null;
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      if (g.id.equals(id)) return g;
    }
    return null;
  }

  private void renderCart() {
    renderCartViewsOnly();
    syncCustomerDisplay();
  }

  /** Update cashier cart UI without touching customer Presentation (e.g. during SUCCESS). */
  private void renderCartViewsOnly() {
    cartList.removeAllViews();
    for (int i = 0; i < cart.size(); i++) {
      final int idx = i;
      MenuModels.CartLine line = cart.get(i);
      LinearLayout block = new LinearLayout(this);
      block.setOrientation(LinearLayout.VERTICAL);
      block.setPadding(0, 4, 0, 8);

      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      TextView label = new TextView(this);
      label.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
      label.setText(
          String.format(
              Locale.getDefault(), "%s x%d · ฿%.0f", line.name, line.qty, line.lineTotal()));
      label.setTextColor(0xFF222222);
      label.setTypeface(Typeface.DEFAULT_BOLD);
      Button plus = new Button(this);
      plus.setText("+");
      plus.setOnClickListener(
          v -> {
            line.qty += 1;
            renderCart();
          });
      Button minus = new Button(this);
      minus.setText("−");
      minus.setOnClickListener(
          v -> {
            line.qty -= 1;
            if (line.qty <= 0) cart.remove(idx);
            renderCart();
          });
      row.addView(label);
      row.addView(minus);
      row.addView(plus);
      block.addView(row);

      String opts = line.optionsSummary();
      if (!opts.isEmpty()) {
        TextView optView = new TextView(this);
        optView.setText(opts);
        optView.setTextColor(0xFF666666);
        optView.setTextSize(12);
        optView.setPadding(4, 0, 4, 0);
        block.addView(optView);
      }
      cartList.addView(block);
    }
    double total = cartTotal();
    cartTotalView.setText(getString(R.string.cart_total_fmt, total));
    if (discountLabel != null) {
      if (discountBaht > 0) {
        discountLabel.setVisibility(View.VISIBLE);
        discountLabel.setText(getString(R.string.discount_applied_fmt, discountBaht));
      } else {
        discountLabel.setVisibility(View.GONE);
      }
    }
  }

  private void syncCustomerDisplay() {
    if (customerDisplay == null) return;
    applyShopToCustomerDisplay();
    if (menu != null) customerDisplay.setRecommended(menu.items);
    if (cart.isEmpty()) {
      customerDisplay.showStandby();
      return;
    }
    List<CustomerDisplayPresentation.Line> lines = new ArrayList<>();
    for (MenuModels.CartLine line : cart) {
      lines.add(
          new CustomerDisplayPresentation.Line(
              line.name, line.qty, line.unitPrice, line.lineTotal(), line.optionsSummary()));
    }
    double sub = cartSubtotal();
    customerDisplay.showSelecting(lines, sub, discountBaht, Math.max(0, sub - discountBaht));
  }

  private double cartSubtotal() {
    double t = 0;
    for (MenuModels.CartLine line : cart) t += line.lineTotal();
    return t;
  }

  private double cartTotal() {
    return Math.max(0, cartSubtotal() - discountBaht);
  }

  private void showDiscountDialog() {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(40, 24, 40, 8);
    EditText input = new EditText(this);
    input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    input.setHint(R.string.discount_hint_baht);
    if (discountBaht > 0) {
      input.setText(String.format(Locale.US, "%.0f", discountBaht));
    }
    root.addView(input);

    LinearLayout presets = new LinearLayout(this);
    presets.setOrientation(LinearLayout.HORIZONTAL);
    double sub = cartSubtotal();
    int[] pcts = {5, 10, 20};
    for (int pct : pcts) {
      Button b = new Button(this);
      b.setText(pct + "%");
      b.setAllCaps(false);
      final int p = pct;
      b.setOnClickListener(
          v -> input.setText(String.format(Locale.US, "%.0f", Math.floor(sub * p / 100.0))));
      presets.addView(b);
    }
    root.addView(presets);

    new AlertDialog.Builder(this)
        .setTitle(R.string.discount_title)
        .setView(root)
        .setPositiveButton(
            android.R.string.ok,
            (d, w) -> {
              try {
                discountBaht = Double.parseDouble(input.getText().toString().trim());
              } catch (Exception e) {
                discountBaht = 0;
              }
              if (discountBaht < 0) discountBaht = 0;
              if (discountBaht > sub) discountBaht = sub;
              renderCart();
            })
        .setNeutralButton(
            R.string.discount_clear,
            (d, w) -> {
              discountBaht = 0;
              renderCart();
            })
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void startPay(String method) {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    double total = cartTotal();
    if ("cash".equals(method)) {
      showCashKeypad(total);
    } else {
      showPromptPayDialog(total);
    }
  }

  /** Clone web PosCashKeypad: exact · bills · digits · change. */
  private void showCashKeypad(double total) {
    final String[] valueHolder = {String.format(Locale.US, "%.0f", Math.ceil(total))};

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(28, 20, 28, 8);

    TextView due = new TextView(this);
    due.setText(getString(R.string.pay_cash_due, total));
    due.setTextColor(0xFF1A2E24);
    due.setTextSize(15);
    root.addView(due);

    TextView receivedLabel = new TextView(this);
    receivedLabel.setText(R.string.pay_cash_received_label);
    receivedLabel.setTextColor(0xFF666666);
    receivedLabel.setPadding(0, 12, 0, 0);
    root.addView(receivedLabel);

    TextView amountView = new TextView(this);
    amountView.setTextSize(28);
    amountView.setTypeface(Typeface.DEFAULT_BOLD);
    amountView.setTextColor(0xFF1A2E24);
    root.addView(amountView);

    TextView changeView = new TextView(this);
    changeView.setTextSize(14);
    changeView.setPadding(0, 4, 0, 12);
    root.addView(changeView);

    Runnable refresh =
        () -> {
          double received = parseCashAmount(valueHolder[0]);
          boolean enough = received >= total;
          double change = Math.max(0, received - total);
          amountView.setText(
              valueHolder[0].isEmpty()
                  ? "—"
                  : String.format(Locale.getDefault(), "฿%.0f", received));
          if (enough) {
            changeView.setText(getString(R.string.pay_cash_change_ok, change));
            changeView.setTextColor(0xFF1B6B3A);
          } else {
            changeView.setText(R.string.pay_cash_change_short);
            changeView.setTextColor(0xFFB00020);
          }
          if (customerDisplay != null) {
            customerDisplay.showPaymentCash(total, received, change, enough);
          }
        };
    refresh.run();

    Button exact = new Button(this);
    exact.setAllCaps(false);
    exact.setText(getString(R.string.pay_cash_exact, total));
    exact.setOnClickListener(
        v -> {
          valueHolder[0] = String.format(Locale.US, "%.0f", Math.ceil(total));
          refresh.run();
        });
    root.addView(exact);

    LinearLayout bills = new LinearLayout(this);
    bills.setOrientation(LinearLayout.HORIZONTAL);
    int[] billAmts = {20, 50, 100, 500, 1000};
    for (int amt : billAmts) {
      Button b = new Button(this);
      b.setAllCaps(false);
      b.setText("+" + amt);
      b.setTextSize(12);
      final int add = amt;
      b.setOnClickListener(
          v -> {
            double next = parseCashAmount(valueHolder[0]) + add;
            valueHolder[0] = String.format(Locale.US, "%.0f", next);
            refresh.run();
          });
      bills.addView(
          b,
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    }
    Button clear = new Button(this);
    clear.setAllCaps(false);
    clear.setText(R.string.pay_cash_clear);
    clear.setTextSize(12);
    clear.setOnClickListener(
        v -> {
          valueHolder[0] = "";
          refresh.run();
        });
    bills.addView(
        clear, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    root.addView(bills);

    LinearLayout pad = new LinearLayout(this);
    pad.setOrientation(LinearLayout.VERTICAL);
    String[][] rows = {
      {"7", "8", "9"},
      {"4", "5", "6"},
      {"1", "2", "3"},
      {"0", "⌫"}
    };
    for (String[] row : rows) {
      LinearLayout line = new LinearLayout(this);
      line.setOrientation(LinearLayout.HORIZONTAL);
      for (String key : row) {
        Button b = new Button(this);
        b.setText(key);
        b.setAllCaps(false);
        float weight = "0".equals(key) ? 2f : 1f;
        b.setOnClickListener(
            v -> {
              if ("⌫".equals(key)) {
                if (!valueHolder[0].isEmpty()) {
                  valueHolder[0] = valueHolder[0].substring(0, valueHolder[0].length() - 1);
                }
              } else {
                valueHolder[0] = valueHolder[0] + key;
              }
              refresh.run();
            });
        line.addView(
            b,
            new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight));
      }
      pad.addView(line);
    }
    root.addView(pad);

    ScrollView scroll = new ScrollView(this);
    scroll.addView(root);

    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle(R.string.pay_cash_title)
            .setView(scroll)
            .setPositiveButton(
                R.string.btn_confirm_sale,
                (d, w) -> {
                  double received = parseCashAmount(valueHolder[0]);
                  if (received < total) {
                    Toast.makeText(this, R.string.pay_cash_short, Toast.LENGTH_LONG).show();
                    syncCustomerDisplay();
                    return;
                  }
                  commitSale("cash", received);
                })
            .setNegativeButton(
                android.R.string.cancel, (d, w) -> syncCustomerDisplay())
            .setOnCancelListener(d -> syncCustomerDisplay())
            .create();
    dialog.show();
  }

  private static double parseCashAmount(String raw) {
    if (raw == null || raw.trim().isEmpty()) return 0;
    try {
      return Double.parseDouble(raw.replaceAll("[^\\d.]", ""));
    } catch (Exception e) {
      return 0;
    }
  }

  private void showPromptPayDialog(double total) {
    String pp = shop == null ? "" : shop.optString("promptPayId", "");
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER_HORIZONTAL);
    root.setPadding(32, 24, 32, 8);

    TextView msg = new TextView(this);
    msg.setGravity(Gravity.CENTER);
    android.graphics.Bitmap customerQr = null;
    if (pp.isEmpty() || !PromptPayPayload.isValid(pp)) {
      msg.setText(getString(R.string.pay_pp_no_id, total));
      root.addView(msg);
      if (customerDisplay != null) customerDisplay.showPaymentQr(total, null);
    } else {
      msg.setText(getString(R.string.pay_pp_msg, pp, total));
      root.addView(msg);
      try {
        String emv = PromptPayPayload.build(pp, total);
        ImageView qr = new ImageView(this);
        int size =
            (int)
                TypedValue.applyDimension(
                    TypedValue.COMPLEX_UNIT_DIP, 200, getResources().getDisplayMetrics());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
        lp.topMargin = 16;
        qr.setLayoutParams(lp);
        qr.setScaleType(ImageView.ScaleType.FIT_CENTER);
        qr.setBackgroundColor(0xFFFFFFFF);
        android.graphics.Bitmap bmp = QrBitmaps.encode(emv, size);
        if (bmp != null) {
          qr.setImageBitmap(bmp);
          customerQr = bmp;
        } else {
          // Fallback online QR only if local encode fails
          ImageLoader.bind(qr, PromptPayPayload.qrImageUrl(emv), 0xFFFFFFFF);
        }
        root.addView(qr);
      } catch (Exception e) {
        TextView err = new TextView(this);
        err.setText(R.string.pay_pp_qr_fail);
        err.setTextColor(0xFFB00020);
        root.addView(err);
      }
      if (customerDisplay != null) customerDisplay.showPaymentQr(total, customerQr);
    }

    new AlertDialog.Builder(this)
        .setTitle(R.string.pay_pp_title)
        .setView(root)
        .setPositiveButton(R.string.btn_confirm_sale, (d, w) -> commitSale("promptpay", 0))
        .setNegativeButton(android.R.string.cancel, (d, w) -> syncCustomerDisplay())
        .setOnCancelListener(d -> syncCustomerDisplay())
        .show();
  }

  private void commitSale(String method, double cashReceived) {
    sellSyncStatus.setText(R.string.sell_saving);
    List<MenuModels.CartLine> snapshot = new ArrayList<>(cart);
    double disc = discountBaht;
    final double changeForCustomer =
        "cash".equals(method) ? Math.max(0, cashReceived - cartTotal()) : 0;
    boolean autoPrint = shop == null || shop.optBoolean("autoPrintReceipt", true);
    saleSync.enqueueSale(
        this,
        snapshot,
        method,
        cashReceived,
        disc,
        shop,
        autoPrint,
        new SaleSync.SaleCallback() {
          @Override
                    public void onLocalSaved(String localId, double total) {
                      runOnUiThread(
                          () -> {
                            String thanks =
                                shop == null
                                    ? getString(R.string.customer_success_default)
                                    : shop.optString(
                                        "receiptFooterNote",
                                        getString(R.string.customer_success_default));
                            if (customerDisplay != null) {
                              customerDisplay.showSuccessThenStandby(
                                  thanks, total, changeForCustomer);
                            }
                            cart.clear();
                            discountBaht = 0;
                            renderCartViewsOnly();
                            updateShiftSummary();
                            updatePendingBadge();
                            sellSyncStatus.setText(R.string.sell_saved_local);
                            Toast.makeText(
                                    SellActivity.this,
                                    getString(R.string.sell_saved_toast, total),
                                    Toast.LENGTH_SHORT)
                                .show();
                          });
                    }

                    @Override
                    public void onSynced(String billNo, double change, double total) {
                      runOnUiThread(
                          () -> {
                            sellSyncStatus.setText(getString(R.string.sell_synced, billNo));
                            updatePendingBadge();
                            if (change > 0) {
                              Toast.makeText(
                                      SellActivity.this,
                                      getString(R.string.sell_change, change),
                                      Toast.LENGTH_LONG)
                                  .show();
                            }
                          });
                    }

          @Override
          public void onError(String humanMessage) {
            runOnUiThread(
                () -> {
                  sellSyncStatus.setText(humanMessage);
                  Toast.makeText(SellActivity.this, humanMessage, Toast.LENGTH_LONG).show();
                });
          }
        });
  }
}
