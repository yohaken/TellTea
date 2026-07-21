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

import app.telltea.npos.diagnose.CustomerAmountPresentation;
import app.telltea.npos.diagnose.DisplayProbe;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.PromptPayPayload;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * Sell screen — clone web PosSellView: categories, menu images, options, cart, discount,
 * cash / PromptPay QR, sold-out long-press.
 */
public class SellActivity extends Activity {
  private LinearLayout categoryBar;
  private LinearLayout menuList;
  private LinearLayout cartList;
  private TextView cartTotalView;
  private TextView sellSyncStatus;
  private TextView sellTitle;
  private TextView discountLabel;

  private MenuRepository menuRepo;
  private SaleSync saleSync;
  private MenuModels.Bundle menu;
  private JSONObject shop;
  private String selectedCategoryId = "";
  private final List<MenuModels.CartLine> cart = new ArrayList<>();
  private double discountBaht = 0;
  private CustomerAmountPresentation customerPresentation;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      finish();
      return;
    }
    setContentView(R.layout.activity_sell);

    categoryBar = findViewById(R.id.categoryBar);
    menuList = findViewById(R.id.menuList);
    cartList = findViewById(R.id.cartList);
    cartTotalView = findViewById(R.id.cartTotal);
    sellSyncStatus = findViewById(R.id.sellSyncStatus);
    sellTitle = findViewById(R.id.sellTitle);
    discountLabel = findViewById(R.id.discountLabel);

    menuRepo = new MenuRepository();
    saleSync = new SaleSync();

    findViewById(R.id.payCashButton).setOnClickListener(v -> startPay("cash"));
    findViewById(R.id.payPromptButton).setOnClickListener(v -> startPay("promptpay"));
    findViewById(R.id.discountButton).setOnClickListener(v -> showDiscountDialog());
    findViewById(R.id.receiptsButton)
        .setOnClickListener(v -> startActivity(new Intent(this, ReceiptsActivity.class)));
    findViewById(R.id.sellSettingsButton)
        .setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
    findViewById(R.id.sellCloseShiftButton).setOnClickListener(v -> closeShift());

    sellSyncStatus.setText(R.string.sell_loading_menu);
    menuRepo.loadShop(this, s -> runOnUiThread(() -> shop = s));
    menuRepo.loadMenu(
        this,
        true,
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
                  if (!bundle.categories.isEmpty()) {
                    selectedCategoryId = bundle.categories.get(0).id;
                  }
                  renderCategories();
                  renderMenu();
                  renderCart();
                }));
    saleSync.flushPending(this);
  }

  @Override
  protected void onDestroy() {
    dismissCustomer();
    if (menuRepo != null) menuRepo.shutdown();
    if (saleSync != null) saleSync.shutdown();
    super.onDestroy();
  }

  private void closeShift() {
    sellSyncStatus.setText(R.string.sell_closing_shift);
    saleSync.printShiftReport(
        this,
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

  private void renderCategories() {
    categoryBar.removeAllViews();
    if (menu == null) return;
    for (MenuModels.Category cat : menu.categories) {
      Button b = new Button(this);
      b.setText(cat.name);
      b.setAllCaps(false);
      b.setOnClickListener(
          v -> {
            selectedCategoryId = cat.id;
            renderMenu();
          });
      categoryBar.addView(b);
    }
  }

  private void renderMenu() {
    menuList.removeAllViews();
    if (menu == null) return;
    int thumbPx =
        (int)
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, 56, getResources().getDisplayMetrics());
    for (MenuModels.Item item : menu.items) {
      if (!selectedCategoryId.isEmpty() && !selectedCategoryId.equals(item.categoryId)) continue;

      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setGravity(Gravity.CENTER_VERTICAL);
      row.setPadding(8, 8, 8, 8);
      row.setBackgroundColor(item.active ? 0xFFFFFFFF : 0xFFE8E8E8);

      ImageView img = new ImageView(this);
      LinearLayout.LayoutParams imgLp = new LinearLayout.LayoutParams(thumbPx, thumbPx);
      imgLp.setMargins(0, 0, 12, 0);
      img.setLayoutParams(imgLp);
      img.setScaleType(ImageView.ScaleType.CENTER_CROP);
      ImageLoader.bind(img, item.imageUrl, 0xFFD9E2DC);
      row.addView(img);

      LinearLayout textCol = new LinearLayout(this);
      textCol.setOrientation(LinearLayout.VERTICAL);
      textCol.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
      TextView name = new TextView(this);
      name.setText(item.name);
      name.setTextSize(15);
      name.setTextColor(0xFF1A2E24);
      name.setTypeface(Typeface.DEFAULT_BOLD);
      TextView price = new TextView(this);
      if (!item.active) {
        price.setText(R.string.menu_sold_out);
        price.setTextColor(0xFFB00020);
      } else {
        price.setText(String.format(Locale.getDefault(), "฿%.0f", item.price));
        price.setTextColor(0xFF555555);
      }
      textCol.addView(name);
      textCol.addView(price);
      row.addView(textCol);

      if (item.active) {
        row.setOnClickListener(v -> onTapItem(item));
      } else {
        row.setOnClickListener(
            v -> Toast.makeText(this, R.string.menu_sold_out, Toast.LENGTH_SHORT).show());
      }
      row.setOnLongClickListener(
          v -> {
            confirmToggleSoldOut(item);
            return true;
          });
      menuList.addView(row);
    }
    if (menuList.getChildCount() == 0) {
      TextView empty = new TextView(this);
      empty.setText(R.string.sell_menu_empty);
      empty.setTextColor(0xFF666666);
      menuList.addView(empty);
    }
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
                active));
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
      header.setText(group.name + req);
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
          if (first && group.required) {
            rb.setChecked(true);
            first = false;
          }
        }
        root.addView(rg);
        singleGroups.put(group.id, rg);
      } else {
        List<CheckBox> boxes = new ArrayList<>();
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
                  if (group.required && chosen.isEmpty()) {
                    Toast.makeText(this, getString(R.string.option_required, group.name), Toast.LENGTH_LONG)
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
    cartList.removeAllViews();
    for (int i = 0; i < cart.size(); i++) {
      final int idx = i;
      MenuModels.CartLine line = cart.get(i);
      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      TextView label = new TextView(this);
      label.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
      label.setText(
          String.format(
              Locale.getDefault(), "%s x%d · ฿%.0f", line.name, line.qty, line.lineTotal()));
      label.setTextColor(0xFF222222);
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
      cartList.addView(row);
    }
    double sub = cartSubtotal();
    double total = Math.max(0, sub - discountBaht);
    cartTotalView.setText(getString(R.string.cart_total_fmt, total));
    if (discountLabel != null) {
      if (discountBaht > 0) {
        discountLabel.setVisibility(View.VISIBLE);
        discountLabel.setText(getString(R.string.discount_applied_fmt, discountBaht));
      } else {
        discountLabel.setVisibility(View.GONE);
      }
    }
    pushCustomerDisplay(total);
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

  private void pushCustomerDisplay(double total) {
    try {
      List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(this);
      DisplayProbe.DisplayInfo target = null;
      for (DisplayProbe.DisplayInfo d : displays) {
        if (!d.primary) {
          target = d;
          break;
        }
      }
      if (target == null) return;
      dismissCustomer();
      String amount = String.format(Locale.US, "฿%,.0f", total);
      customerPresentation =
          new CustomerAmountPresentation(
              this, target.display, amount, getString(R.string.customer_caption));
      customerPresentation.show();
    } catch (Exception e) {
      OpsLogger.warn(
          this,
          "display",
          "อัปเดตจอลูกค้าไม่สำเร็จ",
          e.getMessage() == null ? "" : e.getMessage());
    }
  }

  private void dismissCustomer() {
    if (customerPresentation != null) {
      try {
        customerPresentation.dismiss();
      } catch (Exception ignored) {
        /* ignore */
      }
      customerPresentation = null;
    }
  }

  private void startPay(String method) {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    double total = cartTotal();
    if ("cash".equals(method)) {
      EditText input = new EditText(this);
      input.setInputType(InputType.TYPE_CLASS_NUMBER);
      input.setText(String.format(Locale.US, "%.0f", total));
      new AlertDialog.Builder(this)
          .setTitle(R.string.pay_cash_title)
          .setMessage(getString(R.string.pay_cash_msg, total))
          .setView(input)
          .setPositiveButton(
              R.string.btn_confirm_sale,
              (d, w) -> {
                double received;
                try {
                  received = Double.parseDouble(input.getText().toString().trim());
                } catch (Exception e) {
                  received = total;
                }
                if (received < total) {
                  Toast.makeText(this, R.string.pay_cash_short, Toast.LENGTH_LONG).show();
                  return;
                }
                commitSale("cash", received);
              })
          .setNegativeButton(android.R.string.cancel, null)
          .show();
    } else {
      showPromptPayDialog(total);
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
    if (pp.isEmpty() || !PromptPayPayload.isValid(pp)) {
      msg.setText(getString(R.string.pay_pp_no_id, total));
      root.addView(msg);
    } else {
      msg.setText(getString(R.string.pay_pp_msg, pp, total));
      root.addView(msg);
      try {
        String emv = PromptPayPayload.build(pp, total);
        String qrUrl = PromptPayPayload.qrImageUrl(emv);
        ImageView qr = new ImageView(this);
        int size =
            (int)
                TypedValue.applyDimension(
                    TypedValue.COMPLEX_UNIT_DIP, 200, getResources().getDisplayMetrics());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
        lp.topMargin = 16;
        qr.setLayoutParams(lp);
        qr.setScaleType(ImageView.ScaleType.FIT_CENTER);
        root.addView(qr);
        ImageLoader.bind(qr, qrUrl, 0xFFFFFFFF);
      } catch (Exception e) {
        TextView err = new TextView(this);
        err.setText(R.string.pay_pp_qr_fail);
        err.setTextColor(0xFFB00020);
        root.addView(err);
      }
    }

    new AlertDialog.Builder(this)
        .setTitle(R.string.pay_pp_title)
        .setView(root)
        .setPositiveButton(R.string.btn_confirm_sale, (d, w) -> commitSale("promptpay", 0))
        .setNegativeButton(android.R.string.cancel, null)
        .show();
  }

  private void commitSale(String method, double cashReceived) {
    sellSyncStatus.setText(R.string.sell_saving);
    List<MenuModels.CartLine> snapshot = new ArrayList<>(cart);
    double disc = discountBaht;
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
                  cart.clear();
                  discountBaht = 0;
                  renderCart();
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
