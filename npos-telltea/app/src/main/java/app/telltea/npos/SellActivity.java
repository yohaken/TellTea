package app.telltea.npos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.diagnose.CustomerAmountPresentation;
import app.telltea.npos.diagnose.DisplayProbe;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;

/** N6 sell screen — categories, menu, cart, pay (cash/PromptPay). */
public class SellActivity extends Activity {
    private LinearLayout categoryBar;
    private LinearLayout menuList;
    private LinearLayout cartList;
    private TextView cartTotalView;
    private TextView sellSyncStatus;
    private TextView sellTitle;

    private MenuRepository menuRepo;
    private SaleSync saleSync;
    private MenuModels.Bundle menu;
    private JSONObject shop;
    private String selectedCategoryId = "";
    private final List<MenuModels.CartLine> cart = new ArrayList<>();
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

        menuRepo = new MenuRepository();
        saleSync = new SaleSync();

        findViewById(R.id.payCashButton).setOnClickListener(v -> startPay("cash"));
        findViewById(R.id.payPromptButton).setOnClickListener(v -> startPay("promptpay"));
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
        saleSync.closeSession(
                this,
                () ->
                        runOnUiThread(
                                () -> {
                                    Toast.makeText(this, R.string.shift_closed, Toast.LENGTH_SHORT).show();
                                    finish();
                                }));
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
        for (MenuModels.Item item : menu.items) {
            if (!selectedCategoryId.isEmpty() && !selectedCategoryId.equals(item.categoryId)) continue;
            Button row = new Button(this);
            row.setAllCaps(false);
            row.setText(
                    String.format(Locale.getDefault(), "%s · ฿%.0f", item.name, item.price));
            row.setOnClickListener(v -> addItem(item));
            menuList.addView(row);
        }
        if (menuList.getChildCount() == 0) {
            TextView empty = new TextView(this);
            empty.setText(R.string.sell_menu_empty);
            empty.setTextColor(0xFF666666);
            menuList.addView(empty);
        }
    }

    private void addItem(MenuModels.Item item) {
        JSONArray optionsJson = new JSONArray();
        double unit = item.price;
        if (menu != null && item.optionGroupIds != null) {
            for (String gid : item.optionGroupIds) {
                MenuModels.OptionGroup group = findGroup(gid);
                if (group == null || group.options.isEmpty()) continue;
                MenuModels.Option opt = group.options.get(0);
                unit += opt.priceDelta;
                try {
                    JSONObject g = new JSONObject();
                    g.put("groupId", group.id);
                    g.put("groupName", group.name);
                    JSONArray choices = new JSONArray();
                    JSONObject c = new JSONObject();
                    c.put("optionId", opt.id);
                    c.put("name", opt.name);
                    c.put("priceDelta", opt.priceDelta);
                    choices.put(c);
                    g.put("choices", choices);
                    optionsJson.put(g);
                } catch (Exception ignored) {
                    /* ignore */
                }
            }
        }
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
                            Locale.getDefault(),
                            "%s x%d · ฿%.0f",
                            line.name,
                            line.qty,
                            line.lineTotal()));
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
        double total = cartTotal();
        cartTotalView.setText(getString(R.string.cart_total_fmt, total));
        pushCustomerDisplay(total);
    }

    private double cartTotal() {
        double t = 0;
        for (MenuModels.CartLine line : cart) t += line.lineTotal();
        return t;
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
                                    Toast.makeText(this, R.string.pay_cash_short, Toast.LENGTH_LONG)
                                            .show();
                                    return;
                                }
                                commitSale("cash", received);
                            })
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        } else {
            String pp =
                    shop == null ? "" : shop.optString("promptPayId", "");
            String msg =
                    pp.isEmpty()
                            ? getString(R.string.pay_pp_no_id, total)
                            : getString(R.string.pay_pp_msg, pp, total);
            new AlertDialog.Builder(this)
                    .setTitle(R.string.pay_pp_title)
                    .setMessage(msg)
                    .setPositiveButton(R.string.btn_confirm_sale, (d, w) -> commitSale("promptpay", 0))
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        }
    }

    private void commitSale(String method, double cashReceived) {
        sellSyncStatus.setText(R.string.sell_saving);
        List<MenuModels.CartLine> snapshot = new ArrayList<>(cart);
        boolean autoPrint = shop == null || shop.optBoolean("autoPrintReceipt", true);
        saleSync.enqueueSale(
                this,
                snapshot,
                method,
                cashReceived,
                0,
                shop,
                autoPrint,
                new SaleSync.SaleCallback() {
                    @Override
                    public void onLocalSaved(String localId, double total) {
                        runOnUiThread(
                                () -> {
                                    cart.clear();
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
                                    Toast.makeText(SellActivity.this, humanMessage, Toast.LENGTH_LONG)
                                            .show();
                                });
                    }
                });
    }
}
