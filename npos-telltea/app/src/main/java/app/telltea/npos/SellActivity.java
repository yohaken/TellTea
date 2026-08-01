package app.telltea.npos;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.TextWatcher;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
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

import app.telltea.npos.diagnose.CaptureConsentActivity;
import app.telltea.npos.diagnose.ChangeDisplayPrefs;
import app.telltea.npos.diagnose.CustomerDisplayController;
import app.telltea.npos.diagnose.CustomerDisplayPresentation;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.diagnose.PaymentVoice;
import app.telltea.npos.diagnose.ForegroundHeartbeat;
import app.telltea.npos.diagnose.StoreClaimPrefs;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.sell.MenuModels;
import app.telltea.npos.sell.MenuRepository;
import app.telltea.npos.sell.MenuSyncCoordinator;
import app.telltea.npos.sell.OptionPickerLogic;
import app.telltea.npos.sell.PaymentMethods;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.sell.SellLayoutPrefs;
import app.telltea.npos.shell.PosShellNav;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.printer.DrawerKick;
import app.telltea.npos.ui.NposConfirmDialog;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposNumberPad;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;
import app.telltea.npos.update.ResumePrefs;
import app.telltea.npos.update.UpdatePromptController;
import app.telltea.npos.update.WhatsNewController;

/**
 * Sell screen — front-counter only: categories, menu images, options, cart, discount,
 * cash / bank-transfer pay (PromptPay POS-QR parked), sold-out long-press. No delivery price channel.
 */
public class SellActivity extends Activity implements MenuSyncCoordinator.Listener {
  private LinearLayout categoryBar;
  private GridLayout menuGrid;
  private LinearLayout cartList;
  private TextView cartTotalView;
  private TextView cartSubtotalView;
  private TextView cartBillRef;
  private TextView sellSyncStatus;
  private TextView sellTitle;
  private TextView sellServerCheckChip;
  private TextView discountLabel;
  private TextView shiftSummary;
  private View changeHoldBar;
  private TextView changeHoldText;
  private TextView changeHoldDismiss;
  private Runnable changeHoldHideTask;
  private Runnable changeHoldTickTask;
  private double lastChangeBaht;
  private int changeHoldSecondsLeft;
  private TextView flushSyncButton;
  private TextView restoreHoldButton;
  private View payAllButton;
  private TextView payAllAmount;
  private TextView payAllDiscount;
  private TextView holdBillButton;
  private View categoryScroll;
  private View menuScroll;
  private View cartColumn;
  private View sellContentRow;
  private SellLayoutPrefs.Weights paneWeights = SellLayoutPrefs.load(null);
  private float categoryTextScale = 1f;

  private MenuRepository menuRepo;
  private SaleSync saleSync;
  private MenuModels.Bundle menu;
  private JSONObject shop;
  private String selectedCategoryId = "";
  private String menuQuery = "";
  private boolean searchOpen = false;
  private final List<MenuModels.CartLine> cart = new ArrayList<>();
  private double discountBaht = 0;
  /** Short draft code shown after ตะกร้า until cart clears / sale commits. */
  private String draftCartCode = "";
  private CustomerDisplayController customerDisplay;
  private UpdatePromptController updatePrompt;
  private WhatsNewController whatsNew;
  private UiScale uiScale;
  private final Handler dutyHandler = new Handler(Looper.getMainLooper());
  private final Runnable dutyTick =
      new Runnable() {
        @Override
        public void run() {
          updateShiftSummary();
          updateServerCheckChip();
          dutyHandler.postDelayed(this, 1000L);
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!ShiftPrefs.isOpen(this)) {
      finish();
      return;
    }
    setContentView(R.layout.activity_sell);
    // Gpos chrome: hub in header — no left rail; full-width menu columns.
    PosShellNav.hideSidebar(this);
    uiScale = UiScale.from(this, false);
    app.telltea.npos.ui.NposFonts.applyActivity(this);

    categoryBar = findViewById(R.id.categoryBar);
    menuGrid = findViewById(R.id.menuGrid);
    cartList = findViewById(R.id.cartList);
    cartTotalView = findViewById(R.id.cartTotal);
    cartSubtotalView = findViewById(R.id.cartSubtotal);
    cartBillRef = findViewById(R.id.cartBillRef);
    sellSyncStatus = findViewById(R.id.sellSyncStatus);
    sellTitle = findViewById(R.id.sellTitle);
    sellServerCheckChip = findViewById(R.id.sellServerCheckChip);
    discountLabel = findViewById(R.id.discountLabel);
    shiftSummary = findViewById(R.id.shiftSummary);
    changeHoldBar = findViewById(R.id.changeHoldBar);
    changeHoldText = findViewById(R.id.changeHoldText);
    changeHoldDismiss = findViewById(R.id.changeHoldDismiss);
    if (changeHoldDismiss != null) {
      changeHoldDismiss.setOnClickListener(v -> dismissChangeHoldUi());
    }
    if (changeHoldBar != null) {
      changeHoldBar.setOnClickListener(v -> dismissChangeHoldUi());
    }
    flushSyncButton = findViewById(R.id.flushSyncButton);
    restoreHoldButton = findViewById(R.id.restoreHoldButton);
    payAllButton = findViewById(R.id.payAllButton);
    payAllAmount = findViewById(R.id.payAllAmount);
    payAllDiscount = findViewById(R.id.payAllDiscount);
    holdBillButton = findViewById(R.id.holdBillButton);
    categoryScroll = findViewById(R.id.categoryScroll);
    menuScroll = findViewById(R.id.menuScroll);
    cartColumn = findViewById(R.id.cartColumn);
    sellContentRow = findViewById(R.id.sellContentRow);
    paneWeights = SellLayoutPrefs.load(this);
    applySellPaneWeights(paneWeights);
    bindSellSplitters();

    menuRepo = new MenuRepository();
    saleSync = new SaleSync();
    customerDisplay = new CustomerDisplayController();
    customerDisplay.bind(this);
    PaymentVoice.warm(this);
    MenuSyncCoordinator.bind(this);
    // Tap menu/cart while change bar is up → dismiss hold (touch still reaches the control).
    View content = findViewById(R.id.sellContentRow);
    if (content != null) {
      content.setOnTouchListener(
          (v, event) -> {
            if (event.getAction() == android.view.MotionEvent.ACTION_DOWN
                && isChangeHoldVisible()) {
              dismissChangeHoldUi();
            }
            return false;
          });
    }

    PosShellNav.bind(this, PosShellNav.ACTIVE_SELL, null);
    View sellHub = findViewById(R.id.sellHubButton);
    if (sellHub != null) {
      sellHub.setOnClickListener(v -> showSellHubMenu(v));
    }
    EditText sellSearch = findViewById(R.id.sellSearch);
    View sellSearchBtn = findViewById(R.id.sellSearchButton);
    if (sellSearch != null) {
      sellSearch.setVisibility(View.GONE);
      sellSearch.addTextChangedListener(
          new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable s) {
              menuQuery = s == null ? "" : s.toString().trim();
              renderMenu();
            }
          });
      sellSearch.setOnEditorActionListener(
          (v, actionId, event) -> {
            hideKeyboard(sellSearch);
            return true;
          });
    }
    if (sellSearchBtn != null) {
      sellSearchBtn.setOnClickListener(v -> toggleSellSearch());
    }
    updatePrompt = new UpdatePromptController(this);
    updatePrompt.setBeforeInstall(this::persistWorkBeforeUpdate);
    whatsNew = new WhatsNewController(this);
    applySmartChrome();

    View back = findViewById(R.id.backButton);
    if (back != null) back.setOnClickListener(v -> finish());
    if (payAllButton != null) {
      payAllButton.setOnClickListener(v -> startPayAll());
    }
    View payCashBtn = findViewById(R.id.payCashButton);
    if (payCashBtn != null) {
      payCashBtn.setOnClickListener(v -> startPay("cash"));
      payCashBtn.setVisibility(View.GONE);
    }
    View payTransferBtn = findViewById(R.id.payTransferButton);
    if (payTransferBtn != null) {
      payTransferBtn.setOnClickListener(v -> startPay(PaymentMethods.TRANSFER));
      payTransferBtn.setVisibility(View.GONE);
    }
    View payPpBtn = findViewById(R.id.payPromptButton);
    if (payPpBtn != null) {
      // Early phase: hide PromptPay + QR from main sell chrome.
      payPpBtn.setVisibility(View.GONE);
      payPpBtn.setOnClickListener(null);
    }
    View discountBtn = findViewById(R.id.discountButton);
    if (discountBtn != null) {
      discountBtn.setOnClickListener(v -> showDiscountDialog());
      discountBtn.setVisibility(View.VISIBLE);
    }
    View clearCart = findViewById(R.id.clearCartButton);
    if (clearCart != null) {
      clearCart.setOnClickListener(v -> confirmClearCart());
      clearCart.setVisibility(View.VISIBLE);
    }
    if (holdBillButton != null) {
      holdBillButton.setOnClickListener(v -> holdBill());
    }
    if (restoreHoldButton != null) {
      restoreHoldButton.setOnClickListener(v -> restoreHold());
      restoreHoldButton.setVisibility(View.VISIBLE);
    }
    if (flushSyncButton != null) {
      flushSyncButton.setOnClickListener(v -> flushPendingNow());
    }
    View refreshMenu = findViewById(R.id.refreshMenuButton);
    if (refreshMenu != null) refreshMenu.setVisibility(View.GONE);
    View xReport = findViewById(R.id.xReportButton);
    if (xReport != null) {
      xReport.setOnClickListener(v -> printXReport());
      xReport.setVisibility(View.GONE);
    }
    View receipts = findViewById(R.id.receiptsButton);
    if (receipts != null) {
      receipts.setOnClickListener(v -> startActivity(new Intent(this, ReceiptsActivity.class)));
    }
    View sellSettings = findViewById(R.id.sellSettingsButton);
    if (sellSettings != null) {
      sellSettings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
    }
    View closeShift = findViewById(R.id.sellCloseShiftButton);
    if (closeShift != null) closeShift.setOnClickListener(v -> closeShift());

    sellSyncStatus.setText(R.string.sell_loading_menu);
    menuRepo.loadShop(
        this,
        s ->
            runOnUiThread(
                () -> {
                  shop = s;
                  applyShopToCustomerDisplay();
                  applyBrandChrome();
                  syncCustomerDisplay();
                }));
    reloadMenu(false);
    saleSync.flushPending(this);
    updateShiftSummary();
    updateHoldRestoreButton();
    updatePendingBadge();
    syncCustomerDisplay();
    if (ResumePrefs.consumeRestoreHoldAfterUpdate(this) && HoldCart.hasHold(this) && cart.isEmpty()) {
      doRestoreHold();
    }
  }

  private void applyBrandChrome() {
    PosShellNav.applyBrandLogo(this, shop);
    if (shop == null) return;
    String logo = shop.optString("brandLogo", "");
    if (logo.isEmpty()) return;
    // Recents / task switcher icon (home launcher still uses mipmap until rebuild).
    ImageLoader.decodeAsync(
        this,
        logo,
        bmp -> {
          if (bmp == null || isFinishing()) return;
          try {
            String label =
                shop.optString(
                    "shopName",
                    shop.optString("shopNameTh", getString(R.string.app_name)));
            setTaskDescription(new ActivityManager.TaskDescription(label, bmp));
          } catch (Exception ignored) {
            /* older API / OEM */
          }
        });
  }

  private void applySmartChrome() {
    if (uiScale == null) uiScale = UiScale.from(this, false);
    TextView version = findViewById(R.id.sellVersion);
    if (version != null) {
      version.setText(getString(R.string.version_label, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));
      version.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11f, uiScale.captionSp));
    }
    if (sellTitle != null) {
      sellTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp);
    }
    View sellHub = findViewById(R.id.sellHubButton);
    if (sellHub != null) {
      sellHub.setMinimumHeight(uiScale.touchMinPx);
      sellHub.setMinimumWidth(uiScale.touchMinPx);
    }
    EditText sellSearch = findViewById(R.id.sellSearch);
    if (sellSearch != null) {
      sellSearch.setMinimumHeight(uiScale.touchMinPx);
      sellSearch.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp);
    }
    View sellSearchBtn = findViewById(R.id.sellSearchButton);
    if (sellSearchBtn != null) {
      sellSearchBtn.setMinimumHeight(uiScale.touchMinPx);
      sellSearchBtn.setMinimumWidth(uiScale.touchMinPx);
    }
    View payCash = findViewById(R.id.payCashButton);
    View payTransfer = findViewById(R.id.payTransferButton);
    View payPp = findViewById(R.id.payPromptButton);
    View xReport = findViewById(R.id.xReportButton);
    if (payAllButton != null) {
      payAllButton.setMinimumHeight(uiScale.payPrimaryMinPx);
    }
    if (holdBillButton != null) {
      holdBillButton.setMinimumHeight(uiScale.payPrimaryMinPx);
      holdBillButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(12f, uiScale.bodySp - 1f));
    }
    if (payAllAmount != null) {
      payAllAmount.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp + 2f);
    }
    if (payCash != null) {
      payCash.setMinimumHeight(uiScale.payPrimaryMinPx);
      payCash.setVisibility(View.GONE);
      if (payCash instanceof TextView) {
        ((TextView) payCash).setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp + 1f);
      }
    }
    if (payTransfer != null) {
      payTransfer.setMinimumHeight(uiScale.payPrimaryMinPx);
      payTransfer.setVisibility(View.GONE);
      if (payTransfer instanceof TextView) {
        ((TextView) payTransfer).setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp);
      }
    }
    if (payPp != null) {
      payPp.setVisibility(View.GONE);
    }
    if (xReport != null) {
      xReport.setMinimumHeight(uiScale.touchMinPx);
      xReport.setVisibility(View.GONE);
    }
    styleCartTextAction(findViewById(R.id.discountButton), false);
    styleSoftCartAction(holdBillButton);
    styleCartTextAction(findViewById(R.id.restoreHoldButton), false);
    styleCartTextAction(findViewById(R.id.clearCartButton), true);
    if (menuGrid != null) {
      menuGrid.setColumnCount(uiScale.menuCols);
    }
    applySellPaneWeights(paneWeights);
  }

  private void applySellPaneWeights(SellLayoutPrefs.Weights w) {
    applySellPaneWeights(w, true);
  }

  private void applySellPaneWeights(SellLayoutPrefs.Weights w, boolean reflow) {
    if (w == null) w = SellLayoutPrefs.load(this);
    paneWeights = w;
    setPaneWeight(categoryScroll, w.cat);
    setPaneWeight(menuScroll, w.menu);
    setPaneWeight(cartColumn, w.cart);
    if (menuScroll != null) {
      menuScroll.requestLayout();
    }
    if (!reflow || menuGrid == null) return;
    menuGrid.post(
        () -> {
          applyPaneSmartScale();
          renderMenu();
        });
  }

  private static void setPaneWeight(View pane, float weight) {
    if (pane == null) return;
    ViewGroup.LayoutParams lp = pane.getLayoutParams();
    if (!(lp instanceof LinearLayout.LayoutParams)) return;
    LinearLayout.LayoutParams llp = (LinearLayout.LayoutParams) lp;
    llp.width = 0;
    llp.weight = weight;
    pane.setLayoutParams(llp);
  }

  private void bindSellSplitters() {
    View splitCat = findViewById(R.id.splitCatMenu);
    View splitCart = findViewById(R.id.splitMenuCart);
    if (splitCat != null) {
      int hit = uiScale != null ? Math.max(uiScale.dp(12), uiScale.touchMinPx / 3) : 24;
      ViewGroup.LayoutParams lp = splitCat.getLayoutParams();
      if (lp != null) {
        lp.width = hit;
        splitCat.setLayoutParams(lp);
      }
      splitCat.setOnTouchListener(makeSplitterListener(true));
    }
    if (splitCart != null) {
      int hit = uiScale != null ? Math.max(uiScale.dp(12), uiScale.touchMinPx / 3) : 24;
      ViewGroup.LayoutParams lp = splitCart.getLayoutParams();
      if (lp != null) {
        lp.width = hit;
        splitCart.setLayoutParams(lp);
      }
      splitCart.setOnTouchListener(makeSplitterListener(false));
    }
  }

  /**
   * Horizontal drag on the divider line — standard IDE/editor split feel. Clamps each side ≤35%
   * and keeps menu ≥30% so tiles/text shrink with X instead of stretching Y awkwardly.
   */
  private View.OnTouchListener makeSplitterListener(boolean catSide) {
    return new View.OnTouchListener() {
      private float lastX;
      private boolean dragging;

      @Override
      public boolean onTouch(View v, MotionEvent event) {
        if (sellContentRow == null) return false;
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
          lastX = event.getRawX();
          dragging = true;
          v.getParent().requestDisallowInterceptTouchEvent(true);
          return true;
        }
        if (!dragging) return false;
        if (action == MotionEvent.ACTION_MOVE) {
          float dx = event.getRawX() - lastX;
          lastX = event.getRawX();
          int rowW = Math.max(1, sellContentRow.getWidth());
          float dWeight = (dx / rowW) * 100f;
          SellLayoutPrefs.Weights cur =
              paneWeights != null ? paneWeights : SellLayoutPrefs.load(SellActivity.this);
          SellLayoutPrefs.Weights next =
              catSide
                  ? SellLayoutPrefs.adjustCat(cur.cat + dWeight, cur.cart)
                  : SellLayoutPrefs.adjustCart(cur.cat, cur.cart - dWeight);
          applySellPaneWeights(next, false);
          return true;
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
          dragging = false;
          v.getParent().requestDisallowInterceptTouchEvent(false);
          if (paneWeights != null) {
            SellLayoutPrefs.save(
                SellActivity.this, paneWeights.cat, paneWeights.menu, paneWeights.cart);
          }
          applyPaneSmartScale();
          renderCategories();
          renderMenu();
          return true;
        }
        return false;
      }
    };
  }

  /** Scale type / cols from live pane widths after drag — avoid dumb Y growth when X shrinks. */
  private void applyPaneSmartScale() {
    if (uiScale == null) uiScale = UiScale.from(this, false);
    int menuW = menuScroll != null && menuScroll.getWidth() > 0
        ? menuScroll.getWidth()
        : (menuGrid != null ? menuGrid.getWidth() : 0);
    if (menuW > 0 && menuGrid != null) {
      menuGrid.setColumnCount(uiScale.menuColsForWidth(menuW));
    }
    float catScale = 1f;
    if (categoryScroll != null && categoryScroll.getWidth() > 0 && sellContentRow != null) {
      float expect = Math.max(1f, sellContentRow.getWidth() * (SellLayoutPrefs.CAT_DEFAULT / 100f));
      catScale = clampFloat(categoryScroll.getWidth() / expect, 0.82f, 1.18f);
    }
    float cartScale = 1f;
    if (cartColumn != null && cartColumn.getWidth() > 0 && sellContentRow != null) {
      float expect = Math.max(1f, sellContentRow.getWidth() * (SellLayoutPrefs.CART_DEFAULT / 100f));
      cartScale = clampFloat(cartColumn.getWidth() / expect, 0.85f, 1.12f);
    }
    TextView cartTitle = findViewById(R.id.cartTitle);
    if (cartTitle != null) {
      cartTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp * cartScale);
    }
    if (cartBillRef != null) {
      cartBillRef.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp * cartScale);
    }
    if (cartTotalView != null) {
      cartTotalView.setTextSize(TypedValue.COMPLEX_UNIT_SP, (uiScale.titleSp + 2f) * cartScale);
    }
    if (payAllAmount != null) {
      payAllAmount.setTextSize(TypedValue.COMPLEX_UNIT_SP, (uiScale.titleSp + 2f) * cartScale);
    }
    styleCartTextAction(findViewById(R.id.discountButton), false);
    styleCartTextAction(findViewById(R.id.restoreHoldButton), false);
    styleCartTextAction(findViewById(R.id.clearCartButton), true);
    // stash for categories
    categoryTextScale = catScale;
  }

  private static float clampFloat(float v, float lo, float hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  private void toggleSellSearch() {
    EditText sellSearch = findViewById(R.id.sellSearch);
    TextView sellSearchBtn = findViewById(R.id.sellSearchButton);
    TextView title = sellTitle != null ? sellTitle : findViewById(R.id.sellTitle);
    if (sellSearch == null) return;
    searchOpen = !searchOpen;
    if (searchOpen) {
      if (title != null) title.setVisibility(View.GONE);
      sellSearch.setVisibility(View.VISIBLE);
      if (sellSearchBtn != null) {
        sellSearchBtn.setText("✕");
        sellSearchBtn.setContentDescription(getString(R.string.sell_search_close));
      }
      sellSearch.requestFocus();
      sellSearch.post(
          () -> {
            InputMethodManager imm =
                (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) {
              imm.showSoftInput(sellSearch, InputMethodManager.SHOW_IMPLICIT);
            }
          });
    } else {
      hideKeyboard(sellSearch);
      sellSearch.setText("");
      menuQuery = "";
      sellSearch.setVisibility(View.GONE);
      if (title != null) title.setVisibility(View.VISIBLE);
      if (sellSearchBtn != null) {
        sellSearchBtn.setText(R.string.sell_search_glyph);
        sellSearchBtn.setContentDescription(getString(R.string.sell_search_hint));
      }
      renderMenu();
    }
  }

  private void hideKeyboard(View focus) {
    InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
    if (imm != null && focus != null) {
      imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
    }
  }

  /** Overflow: settings / shift / history / menu admin (cart tools live on cart header row). */
  private void showSellHubMenu(View anchor) {
    PopupMenu popup = new PopupMenu(this, anchor);
    popup.getMenu().add(0, 1, 0, R.string.nav_open_bills);
    popup.getMenu().add(0, 11, 1, R.string.nav_menu);
    popup.getMenu().add(0, 2, 2, R.string.nav_receipts);
    popup.getMenu().add(0, 3, 3, R.string.nav_shift);
    popup.getMenu().add(0, 8, 4, R.string.sell_hub_open_drawer);
    popup
        .getMenu()
        .add(
            0,
            9,
            5,
            getString(
                R.string.sell_hub_change_display_fmt, ChangeDisplayPrefs.label(this)));
    popup.getMenu().add(0, 10, 6, R.string.sell_hub_refresh_menu);
    popup.getMenu().add(0, 4, 7, R.string.btn_settings_device);
    popup.getMenu().add(0, 5, 8, R.string.sell_hub_x_report);
    popup.getMenu().add(0, 6, 9, R.string.sell_hub_close_shift);
    popup.getMenu().add(0, 7, 10, R.string.nav_lock_pin);
    popup.setOnMenuItemClickListener(
        (MenuItem item) -> {
          int id = item.getItemId();
          if (id == 1) {
            PosShellNav.openOpenBillsHint(this);
            return true;
          }
          if (id == 11) {
            PosShellNav.openMenuAdmin(this);
            return true;
          }
          if (id == 2) {
            PosShellNav.openReceipts(this);
            return true;
          }
          if (id == 3) {
            PosShellNav.openShift(this);
            return true;
          }
          if (id == 8) {
            openDrawerNoSale();
            return true;
          }
          if (id == 9) {
            ChangeDisplayPrefs.cycleNext(this);
            Toast.makeText(
                    this,
                    getString(
                        R.string.change_display_current_fmt, ChangeDisplayPrefs.label(this)),
                    Toast.LENGTH_SHORT)
                .show();
            return true;
          }
          if (id == 10) {
            reloadMenu(true);
            Toast.makeText(this, R.string.sell_menu_syncing, Toast.LENGTH_SHORT).show();
            return true;
          }
          if (id == 4) {
            PosShellNav.openSettings(this);
            return true;
          }
          if (id == 5) {
            printXReport();
            return true;
          }
          if (id == 6) {
            closeShift();
            return true;
          }
          if (id == 7) {
            PosShellNav.openLockHub(this);
            return true;
          }
          return false;
        });
    popup.show();
  }

  @Override
  public void onMenuVersionChanged(long serverVersion) {
    runOnUiThread(
        () -> {
          if (isFinishing()) return;
          // Quiet reload — sold-out / BOH edits already show their own status.
          reloadMenu(true);
        });
  }

  /** No Sale — open cash drawer via receipt printer; always logged. */
  private void openDrawerNoSale() {
    DrawerKick.send(
        this,
        "no-sale",
        (ok, message, ep) ->
            runOnUiThread(
                () -> {
                  if (ok) {
                    Toast.makeText(this, R.string.drawer_no_sale_ok, Toast.LENGTH_SHORT).show();
                  } else if (ep == null) {
                    Toast.makeText(this, R.string.drawer_no_sale_no_printer, Toast.LENGTH_LONG)
                        .show();
                  } else {
                    Toast.makeText(this, R.string.drawer_no_sale_fail, Toast.LENGTH_LONG).show();
                  }
                }));
  }

  private void styleCartTextAction(View v, boolean orange) {
    if (!(v instanceof TextView)) return;
    TextView tv = (TextView) v;
    tv.setTypeface(orange ? NposFonts.semibold(this) : NposFonts.regular(this));
    float sp = uiScale != null ? Math.max(12f, uiScale.captionSp) : 13f;
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    tv.setBackgroundColor(0x00000000);
    tv.setTextColor(
        orange
            ? NposUi.color(this, R.color.npos_orange)
            : NposUi.color(this, R.color.npos_ink));
    int minH =
        uiScale != null
            ? Math.max(uiScale.dp(36), uiScale.touchMinPx - 8)
            : NposUi.dp(this, 36);
    tv.setMinHeight(minH);
    tv.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 4), NposUi.dp(this, 8), NposUi.dp(this, 4));
    tv.setAllCaps(false);
  }

  private void styleSoftCartAction(View v) {
    if (!(v instanceof TextView)) return;
    TextView tv = (TextView) v;
    tv.setTypeface(NposFonts.semibold(this));
    if (v.getId() == R.id.holdBillButton) {
      tv.setTextColor(NposUi.color(this, R.color.npos_orange));
    }
  }


  private void persistWorkBeforeUpdate() {
    try {
      if (!cart.isEmpty()) {
        HoldCart.save(this, cart, discountBaht);
        ResumePrefs.markRestoreHoldAfterUpdate(this);
        OpsLogger.info(this, "update", "พักบิลก่อนอัปเดต", cart.size() + " รายการ");
      }
    } catch (Exception e) {
      OpsLogger.warn(this, "update", "พักบิลก่อนอัปเดตไม่สำเร็จ", e.getMessage());
    }
  }

  private void confirmClearCart() {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    NposConfirmDialog.confirmDestructive(
        this,
        getString(R.string.clear_cart_title),
        getString(R.string.clear_cart_msg),
        getString(R.string.btn_clear_cart),
        () -> {
          cart.clear();
          discountBaht = 0;
          draftCartCode = "";
          renderCart();
          maybeSettleRemoteClosed();
        });
  }

  /**
   * Heartbeat learned BO closed this round — keep seat; finish cart if any, then hub.
   * Called from {@link NposApp} (not a kick).
   */
  public void onRemoteSessionClosedFromSync() {
    if (isFinishing()) return;
    updateShiftSummary();
    if (cart.isEmpty()) {
      settleRemoteClosedAndLeave();
      return;
    }
    Toast.makeText(this, R.string.shift_remote_closed_banner, Toast.LENGTH_LONG).show();
    if (sellSyncStatus != null) {
      sellSyncStatus.setText(R.string.shift_remote_closed_banner);
    }
  }

  private void maybeSettleRemoteClosed() {
    if (!ShiftPrefs.isRemoteClosedPending(this)) return;
    if (!cart.isEmpty()) return;
    settleRemoteClosedAndLeave();
  }

  private void settleRemoteClosedAndLeave() {
    if (isFinishing()) return;
    Toast.makeText(this, R.string.shift_remote_closed_toast, Toast.LENGTH_LONG).show();
    try {
      NposConfirmDialog.alert(
          this,
          getString(R.string.shift_remote_closed_title),
          getString(R.string.shift_remote_closed_msg),
          getString(android.R.string.ok),
          false,
          this::leaveSellAfterRemoteClose);
    } catch (RuntimeException e) {
      leaveSellAfterRemoteClose();
    }
  }

  private void leaveSellAfterRemoteClose() {
    ShiftPrefs.settleRemoteClosed(this);
    Intent hub = new Intent(this, MainActivity.class);
    hub.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    startActivity(hub);
    finish();
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
      draftCartCode = "";
      renderCart();
      updateHoldRestoreButton();
      Toast.makeText(this, R.string.hold_saved, Toast.LENGTH_SHORT).show();
      OpsLogger.info(this, "sale", "พักบิล", "");
      maybeSettleRemoteClosed();
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
      NposConfirmDialog.confirm(
          this,
          getString(R.string.hold_restore_title),
          getString(R.string.hold_restore_replace),
          getString(android.R.string.ok),
          () -> {
            cart.clear();
            doRestoreHold();
          });
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
      ensureDraftCartCode();
      renderCart();
      updateHoldRestoreButton();
      Toast.makeText(this, R.string.hold_restored, Toast.LENGTH_SHORT).show();
    } catch (Exception e) {
      Toast.makeText(this, R.string.hold_fail, Toast.LENGTH_SHORT).show();
    }
  }

  private void updateHoldRestoreButton() {
    // Restore lives in hub menu; keep label ready for hub / auto-restore after update.
    if (restoreHoldButton == null) return;
    boolean has = HoldCart.hasHold(this);
    restoreHoldButton.setEnabled(has);
    restoreHoldButton.setText(
        has ? R.string.btn_restore_hold_ready : R.string.btn_restore_hold);
    restoreHoldButton.setAlpha(has ? 1f : 0.55f);
    if (holdBillButton != null) {
      holdBillButton.setAlpha(cart.isEmpty() ? 0.55f : 1f);
    }
    if (payAllButton != null) {
      payAllButton.setAlpha(cart.isEmpty() ? 0.55f : 1f);
    }
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
      String billId = SaleSync.formatBillDisplay(SaleSync.provisionalBillNo(mid));
      String pay = row.optString("paymentMethod", "");
      TextView billTv = NposUi.section(this, billId);
      billTv.setPadding(0, pad / 2, 0, 0);
      root.addView(billTv);
      TextView line = NposUi.caption(this, "");
      line.setText(
          getString(
              R.string.outbox_row_fmt,
              String.format(Locale.getDefault(), "฿%.0f", total),
              pay.isEmpty() ? "—" : ("promptpay".equals(pay) ? "PromptPay" : "เงินสด"),
              "failed".equals(status) ? "ล้มเหลว" : "รอส่ง",
              attempts,
              err.isEmpty() ? "—" : err));
      line.setPadding(0, pad / 4, 0, pad / 2);
      root.addView(line);

      LinearLayout actions = new LinearLayout(this);
      actions.setOrientation(LinearLayout.HORIZONTAL);
      TextView retry = NposUi.secondary(this, getString(R.string.btn_flush_sync));
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
      TextView cancel = NposUi.ghost(this, getString(android.R.string.cancel));
      cancel.setText(R.string.outbox_cancel_one);
      cancel.setOnClickListener(v -> confirmCancelPending(mid, billId));
      actions.addView(retry);
      actions.addView(cancel);
      root.addView(actions);
    }
    scroll.addView(root);
    NposConfirmDialog.custom(
        this,
        getString(R.string.outbox_title_n, rows.size()),
        scroll,
        getString(R.string.outbox_sync_all),
        () -> {
          sellSyncStatus.setText(R.string.sell_flushing);
          saleSync.flushPending(this);
          flushSyncButton.postDelayed(this::updatePendingBadge, 1200);
          return true;
        },
        null);
  }

  private void confirmCancelPending(String mutationId, String billId) {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    TextView reasonLabel = NposUi.caption(this, getString(R.string.void_reason_label));
    reasonLabel.setPadding(0, 0, 0, NposUi.dp(this, 6));
    box.addView(reasonLabel);
    EditText reason = NposUi.field(this);
    reason.setInputType(
        InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    reason.setHint(R.string.void_reason_hint);
    reason.setMinLines(2);
    box.addView(reason);
    NposConfirmDialog.custom(
        this,
        getString(R.string.outbox_cancel_title),
        getString(R.string.outbox_cancel_msg) + "\n" + billId,
        box,
        getString(R.string.outbox_cancel_one),
        getString(android.R.string.cancel),
        true,
        () -> {
          String r = reason.getText().toString().trim();
          if (r.isEmpty()) {
            Toast.makeText(this, R.string.void_reason_required, Toast.LENGTH_SHORT).show();
            reason.requestFocus();
            return false;
          }
          saleSync.cancelPending(
              this,
              mutationId,
              r,
              () ->
                  runOnUiThread(
                      () -> {
                        updatePendingBadge();
                        updateShiftSummary();
                        Toast.makeText(this, R.string.outbox_cancel_done, Toast.LENGTH_SHORT)
                            .show();
                      }));
          return true;
        },
        null);
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
    if (ShiftPrefs.isRemoteClosedPending(this)) {
      shiftSummary.setText(R.string.shift_remote_closed_banner);
      return;
    }
    shiftSummary.setText(ShiftPrefs.dutyLine(this));
  }

  private void reloadMenu(boolean forceNetwork) {
    // Local-first: only show blocking "loading" when we have nothing on disk yet.
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
                  boolean firstPaint = menu == null;
                  menu = bundle;
                  if (bundle.demo) {
                    sellTitle.setText(R.string.sell_title_demo);
                    sellSyncStatus.setText(R.string.sell_menu_demo);
                  } else {
                    sellTitle.setText(R.string.sell_title);
                    sellSyncStatus.setText(
                        firstPaint && !forceNetwork
                            ? R.string.sell_menu_cached
                            : R.string.sell_menu_ready);
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
    if (StoreClaimPrefs.blocksWrites(this) && StoreClaimPrefs.isRequired(this)) {
      Toast.makeText(this, StoreClaimPrefs.blockReason(this), Toast.LENGTH_LONG).show();
      Intent hub = new Intent(this, MainActivity.class);
      hub.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      startActivity(hub);
      finish();
      return;
    }
    // Faster kick detection while selling (heartbeat may have been throttled).
    ForegroundHeartbeat.forceNow(this);
    updateServerCheckChip();
    // After APK update / outstanding BO capture: keep asking until staff grant.
    CaptureConsentActivity.launchAfterUpdateIfNeeded(this);
    CaptureConsentActivity.relaunchPendingIfNeeded(this);
    if (updatePrompt != null) updatePrompt.onResume();
    if (whatsNew != null) whatsNew.maybeShow();
    // Refresh shop name/address from server so BO edits show on next bill.
    if (menuRepo != null) {
      menuRepo.loadShop(
          this,
          s ->
              runOnUiThread(
                  () -> {
                    if (isFinishing() || s == null) return;
                    shop = s;
                    applyShopToCustomerDisplay();
                    applyBrandChrome();
                    syncCustomerDisplay();
                  }));
    }
    updateShiftSummary();
    updateHoldRestoreButton();
    updatePendingBadge();
    maybeSettleRemoteClosed();
    dutyHandler.removeCallbacks(dutyTick);
    dutyHandler.post(dutyTick);
    if (saleSync != null) saleSync.flushPending(this);
    if (customerDisplay != null && sellSyncStatus != null && cart.isEmpty()) {
      sellSyncStatus.setText(customerDisplay.statusLabel(this));
      syncCustomerDisplay();
    }
  }

  @Override
  protected void onPause() {
    dutyHandler.removeCallbacks(dutyTick);
    if (updatePrompt != null) updatePrompt.onPause();
    if (whatsNew != null) whatsNew.onPause();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    dutyHandler.removeCallbacks(dutyTick);
    MenuSyncCoordinator.unbind(this);
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

  private void updateServerCheckChip() {
    if (sellServerCheckChip == null) return;
    int sec = ForegroundHeartbeat.secondsUntilNextCheck();
    ForegroundHeartbeat.LinkStatus link = ForegroundHeartbeat.linkStatus();
    int dotColor;
    switch (link) {
      case FAIL:
        dotColor = 0xFFFF6B6B;
        break;
      case WARN:
      case CHECKING:
        dotColor = 0xFFFFD166;
        break;
      case OK:
      default:
        dotColor = 0xFF4ADE80;
        break;
    }
    String label =
        sec <= 0
            ? getString(R.string.server_check_now)
            : getString(R.string.server_check_chip, sec);
    // "● BO 4s" — small status orb + tech countdown for counter staff.
    SpannableString ss = new SpannableString("● " + label);
    ss.setSpan(new ForegroundColorSpan(dotColor), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    sellServerCheckChip.setText(ss);
  }

  private void closeShift() {
    BlindCloseFlow.start(this, saleSync, this::finish);
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
    if (!menu.isBestsellers()) {
      applySavedCategoryOrder();
    }
    float density = getResources().getDisplayMetrics().density;
    float catScale = categoryTextScale > 0.1f ? categoryTextScale : 1f;
    int padH = Math.round(12 * density * Math.min(1f, catScale));
    int padV = Math.round(14 * density * Math.min(1f, 0.92f + 0.08f * catScale));
    int catMin = Math.max(Math.round(48 * density), uiScale != null ? Math.round(uiScale.touchMinPx * 0.92f * catScale) : 0);
      int ink = NposUi.color(this, R.color.npos_ink);
      int activeBg = NposUi.color(this, R.color.npos_orange_soft);
      int activeFg = NposUi.color(this, R.color.npos_orange);
    for (int i = 0; i < menu.categories.size(); i++) {
      final int idx = i;
      MenuModels.Category cat = menu.categories.get(i);
      TextView b = new TextView(this);
      b.setText(cat.name);
      b.setAllCaps(false);
      b.setMinHeight(catMin);
      b.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
      float catSp = (uiScale != null ? uiScale.bodySp : 14f) * catScale;
      b.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11f, catSp));
      b.setTypeface(NposFonts.semibold(this));
      b.setPadding(padH, padV, padH, padV);
      b.setMaxLines(2);
      b.setEllipsize(android.text.TextUtils.TruncateAt.END);
      LinearLayout.LayoutParams lp =
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
      b.setLayoutParams(lp);
      boolean active = cat.id.equals(selectedCategoryId);
      if (active) {
        b.setBackgroundColor(activeBg);
        b.setTextColor(activeFg);
      } else {
        b.setBackgroundColor(0x00000000);
        b.setTextColor(ink);
      }
      b.setOnClickListener(
          v -> {
            selectedCategoryId = cat.id;
            renderCategories();
            renderMenu();
          });
      b.setOnLongClickListener(
          v -> {
            if (menu != null && menu.isBestsellers()) return true;
            // Vertical table: long-press moves up (or down if already first).
            moveCategory(idx, idx == 0 ? 1 : -1);
            return true;
          });
      categoryBar.addView(b);
      if (i < menu.categories.size() - 1) {
        View hair = new View(this);
        hair.setBackgroundColor(NposUi.color(this, R.color.npos_border));
        categoryBar.addView(
            hair,
            new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Math.max(1, Math.round(density))));
      }
    }
  }

  /** Long-press: move up (or down if already first) — vertical category table reorder. */
  private void moveCategory(int from, int delta) {
    if (menu == null || menu.isBestsellers()) return;
    int to = from + delta;
    if (to < 0 || to >= menu.categories.size()) return;
    List<MenuModels.Category> next = new ArrayList<>(menu.categories);
    MenuModels.Category moved = next.remove(from);
    next.add(to, moved);
    menu =
        new MenuModels.Bundle(
            next,
            menu.items,
            menu.optionGroups,
            menu.demo,
            menu.fetchedAt,
            menu.menuArrangeMode);
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
                ordered,
                menu.items,
                menu.optionGroups,
                menu.demo,
                menu.fetchedAt,
                menu.menuArrangeMode);
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
    if (uiScale == null) uiScale = UiScale.from(this, false);
    // Wait until grid has real width so tiles never overflow horizontally.
    if (menuGrid.getWidth() <= 0) {
      menuGrid.post(this::renderMenu);
      return;
    }
    menuGrid.removeAllViews();
    if (menu == null) return;

    int gap = uiScale.gapPx;
    int avail = menuGrid.getWidth();
    int colCount = Math.max(2, Math.min(5, uiScale.menuColsForWidth(avail)));
    menuGrid.setColumnCount(colCount);
    int cellW = Math.max(uiScale.dp(64), (avail - gap * (colCount + 1)) / colCount);
    // Cap media by cell width so shrinking X shrinks tiles — never inflate Y to "fill".
    int mediaH = Math.min(uiScale.menuMediaMaxPx, Math.round(cellW * 10f / 16f));
    mediaH = Math.max(uiScale.dp(40), mediaH);

    String q = menuQuery == null ? "" : menuQuery.toLowerCase(Locale.getDefault());
    boolean searching = !q.isEmpty();

    int shown = 0;
    int col = 0;
    int row = 0;
    for (MenuModels.Item item : menu.items) {
      if (!searching
          && !selectedCategoryId.isEmpty()
          && !selectedCategoryId.equals(item.categoryId)) {
        continue;
      }
      if (searching) {
        String name = item.name == null ? "" : item.name.toLowerCase(Locale.getDefault());
        if (!name.contains(q)) continue;
      }

      LinearLayout cell = new LinearLayout(this);
      cell.setOrientation(LinearLayout.VERTICAL);
      cell.setBackgroundResource(
          item.active ? R.drawable.npos_card_surface : R.drawable.npos_touch_ghost);
      cell.setPadding(gap, gap, gap, gap);
      GridLayout.LayoutParams glp = new GridLayout.LayoutParams();
      glp.width = 0;
      glp.height = GridLayout.LayoutParams.WRAP_CONTENT;
      glp.columnSpec = GridLayout.spec(col, 1f);
      glp.rowSpec = GridLayout.spec(row);
      glp.setMargins(gap / 2, gap / 2, gap / 2, gap / 2);
      glp.setGravity(Gravity.FILL_HORIZONTAL | Gravity.TOP);
      cell.setLayoutParams(glp);

      FrameLayout media = new FrameLayout(this);
      LinearLayout.LayoutParams mlp =
          new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, mediaH);
      media.setLayoutParams(mlp);
      media.setBackgroundColor(0xFFF0F2F5);
      ImageView img = new ImageView(this);
      img.setLayoutParams(
          new FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
      // Full dish visible (may letterbox) — not crop-heavy “hero” crop.
      img.setScaleType(ImageView.ScaleType.FIT_CENTER);
      ImageLoader.bind(img, item.imageUrl, 0xFFF0F2F5);
      media.addView(img);

      int qty = cartQtyForItem(item.id);
      if (qty > 0) {
        TextView badge = new TextView(this);
        badge.setText(String.valueOf(qty));
        badge.setTextColor(0xFFFFFFFF);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11f, uiScale.captionSp));
        badge.setTypeface(NposFonts.semibold(this));
        badge.setGravity(Gravity.CENTER);
        int badgeSize = uiScale.dp(22);
        badge.setBackgroundResource(R.drawable.npos_menu_qty_badge);
        badge.setMinWidth(badgeSize);
        badge.setMinHeight(badgeSize);
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(badgeSize, badgeSize);
        blp.gravity = Gravity.TOP | Gravity.END;
        blp.setMargins(0, uiScale.dp(4), uiScale.dp(4), 0);
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
      name.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.captionSp + 0.5f);
      name.setTextColor(NposUi.color(this, R.color.npos_ink));
      name.setTypeface(NposFonts.semibold(this));
      name.setMaxLines(2);
      name.setEllipsize(null);
      cell.addView(name);

      TextView price = new TextView(this);
      if (!item.active) {
        price.setText(R.string.menu_sold_out);
        price.setTextColor(0xFFB00020);
      } else {
        price.setText(String.format(Locale.getDefault(), "฿%.0f", itemPrice(item)));
        price.setTextColor(0xFF3D4A55);
      }
      price.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.priceSp);
      price.setTypeface(NposFonts.semibold(this));
      cell.addView(price);

      cell.setMinimumHeight(uiScale.touchMinPx);
      if (item.active) {
        cell.setOnClickListener(v -> onTapItem(item));
      } else {
        cell.setOnClickListener(
            v -> Toast.makeText(this, R.string.menu_sold_out, Toast.LENGTH_SHORT).show());
      }
      cell.setOnLongClickListener(
          v -> {
            showItemActionsSheet(item);
            return true;
          });
      menuGrid.addView(cell);
      shown++;
      col++;
      if (col >= colCount) {
        col = 0;
        row++;
      }
    }
    if (shown == 0) {
      TextView empty = new TextView(this);
      empty.setText(R.string.sell_menu_empty);
      empty.setTextColor(0xFF666666);
      GridLayout.LayoutParams elp = new GridLayout.LayoutParams();
      elp.columnSpec = GridLayout.spec(0, colCount);
      elp.width = avail;
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

  /** Front-counter only — always store price (delivery channel removed from POS). */
  private double itemPrice(MenuModels.Item item) {
    return item.price;
  }

  private double optionDelta(MenuModels.Option opt) {
    return opt.priceDelta;
  }

  private MenuModels.Item findMenuItem(String id) {
    if (menu == null || id == null) return null;
    for (MenuModels.Item it : menu.items) {
      if (id.equals(it.id)) return it;
    }
    return null;
  }

  private void onTapItem(MenuModels.Item item) {
    if (!item.active) return;
    if (!item.hasOptions()) {
      addItemWithOptions(item, new JSONArray(), itemPrice(item));
      return;
    }
    showOptionPicker(item);
  }

  /** Long-press on grid: sold-out toggle + jump to menu admin editor. */
  private void showItemActionsSheet(MenuModels.Item item) {
    if (item == null) return;
    if (uiScale == null) uiScale = UiScale.from(this);

    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = uiScale.dp(12);
    box.setPadding(pad, pad, pad, pad);

    TextView name = NposUi.section(this, item.name);
    name.setPadding(0, 0, 0, uiScale.dp(4));
    box.addView(name);

    TextView status =
        NposUi.caption(
            this,
            getString(
                item.active ? R.string.menu_admin_status_on : R.string.menu_admin_status_off));
    status.setPadding(0, 0, 0, uiScale.dp(12));
    box.addView(status);

    final android.app.AlertDialog[] holder = new android.app.AlertDialog[1];

    TextView toggle =
        item.active
            ? NposUi.primary(this, getString(R.string.menu_item_action_sold_out))
            : NposUi.primary(this, getString(R.string.menu_item_action_restore));
    toggle.setMaxWidth(Integer.MAX_VALUE);
    toggle.setMinHeight(uiScale.payPrimaryMinPx);
    LinearLayout.LayoutParams tLp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    tLp.bottomMargin = uiScale.dp(10);
    toggle.setLayoutParams(tLp);
    toggle.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          runToggleSoldOut(item);
        });
    box.addView(toggle);

    TextView edit = NposUi.secondary(this, getString(R.string.menu_item_action_edit));
    edit.setMaxWidth(Integer.MAX_VALUE);
    edit.setMinHeight(uiScale.payPrimaryMinPx);
    LinearLayout.LayoutParams eLp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    eLp.bottomMargin = uiScale.dp(10);
    edit.setLayoutParams(eLp);
    edit.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          Intent intent = new Intent(this, MenuAdminActivity.class);
          intent.putExtra(MenuAdminActivity.EXTRA_FOCUS_ITEM_ID, item.id);
          startActivity(intent);
        });
    box.addView(edit);

    TextView cancel = NposUi.ghost(this, getString(android.R.string.cancel));
    cancel.setMaxWidth(Integer.MAX_VALUE);
    cancel.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    cancel.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
        });
    box.addView(cancel);

    holder[0] =
        new android.app.AlertDialog.Builder(this)
            .setTitle(R.string.menu_item_actions_title)
            .setView(box)
            .create();
    holder[0].show();
    if (holder[0].getWindow() != null) {
      int w =
          Math.min(
              (int) (getResources().getDisplayMetrics().widthPixels * 0.42f), uiScale.dp(420));
      w = Math.max(w, uiScale.dp(320));
      holder[0]
          .getWindow()
          .setLayout(w, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
    }
  }

  private void runToggleSoldOut(MenuModels.Item item) {
    if (menu != null && menu.demo) {
      Toast.makeText(this, R.string.sold_out_demo_blocked, Toast.LENGTH_SHORT).show();
      return;
    }
    boolean toSoldOut = item.active;
    Toast.makeText(this, R.string.sold_out_saving, Toast.LENGTH_SHORT).show();
    menuRepo.toggleSoldOut(
        this,
        item.id,
        toSoldOut,
        (ok, active, err) ->
            runOnUiThread(
                () -> {
                  if (!ok) {
                    Toast.makeText(this, R.string.sold_out_fail, Toast.LENGTH_LONG).show();
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
                  // menuVersion notify may also reload — one success toast here is enough.
                  Toast.makeText(
                          this,
                          active
                              ? R.string.menu_admin_restored_toast
                              : R.string.menu_admin_sold_out_toast,
                          Toast.LENGTH_SHORT)
                      .show();
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
                it.nameEn,
                it.code,
                it.description,
                it.price,
                it.deliveryPrice,
                it.optionGroupIds,
                it.imageUrl,
                active,
                it.visibleOnPos,
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
            menu.menuArrangeMode,
            menu.admin);
  }

  private void showOptionPicker(MenuModels.Item item) {
    showOptionPicker(item, -1);
  }

  private void showOptionPicker(MenuModels.Item item, int replaceIndex) {
    List<MenuModels.OptionGroup> groups = new ArrayList<>();
    for (String gid : item.optionGroupIds) {
      MenuModels.OptionGroup g = findGroup(gid);
      if (g != null && !g.options.isEmpty()) groups.add(g);
    }
    if (groups.isEmpty()) {
      if (replaceIndex >= 0 && replaceIndex < cart.size()) {
        MenuModels.CartLine old = cart.get(replaceIndex);
        cart.set(
            replaceIndex,
            new MenuModels.CartLine(item.id, item.name, itemPrice(item), Math.max(1, old.qty), new JSONArray()));
        renderCart();
      } else {
        addItemWithOptions(item, new JSONArray(), itemPrice(item), 1);
      }
      return;
    }

    if (uiScale == null) uiScale = UiScale.from(this);
    View sheet = getLayoutInflater().inflate(R.layout.dialog_option_picker, null, false);
    ImageView heroImage = sheet.findViewById(R.id.optionHeroImage);
    TextView heroName = sheet.findViewById(R.id.optionHeroName);
    TextView heroPrice = sheet.findViewById(R.id.optionHeroPrice);
    TextView qtyValue = sheet.findViewById(R.id.optionQtyValue);
    View qtyMinus = sheet.findViewById(R.id.optionQtyMinus);
    View qtyPlus = sheet.findViewById(R.id.optionQtyPlus);
    LinearLayout groupsRoot = sheet.findViewById(R.id.optionGroupsRoot);
    ScrollView groupsScroll = sheet.findViewById(R.id.optionGroupsScroll);
    TextView errView = sheet.findViewById(R.id.optionPickerError);
    TextView confirmBtn = sheet.findViewById(R.id.optionConfirm);
    View cancelBtn = sheet.findViewById(R.id.optionCancel);

    heroName.setText(item.name);
    heroName.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp);
    heroPrice.setText(String.format(Locale.getDefault(), "฿%.0f", itemPrice(item)));
    if (item.imageUrl != null && !item.imageUrl.isEmpty()) {
      ImageLoader.bind(heroImage, item.imageUrl, 0xFFF0F2F5);
    }

    // groupId → optionId → count (web PickedCounts)
    final Map<String, Map<String, Integer>> counts = new HashMap<>();
    // single/sweetness selected option id
    final Map<String, String> singlePick = new HashMap<>();
    final int[] qty = {1};

    // Prefill from cart line when editing
    if (replaceIndex >= 0 && replaceIndex < cart.size()) {
      MenuModels.CartLine existing = cart.get(replaceIndex);
      qty[0] = Math.max(1, existing.qty);
      seedOptionCountsFromJson(existing.optionsJson, groups, counts, singlePick);
    }

    // Preselect required singles / sweetness when empty
    for (MenuModels.OptionGroup group : groups) {
      List<MenuModels.Option> opts = OptionPickerLogic.sortForDisplay(group);
      if (opts.isEmpty()) continue;
      if (counts.containsKey(group.id)) continue;
      if (OptionPickerLogic.isSweetnessGroup(group) || group.isSingle()) {
        if (group.effectiveMin() > 0) {
          singlePick.put(group.id, opts.get(0).id);
          Map<String, Integer> gc = new HashMap<>();
          gc.put(opts.get(0).id, 1);
          counts.put(group.id, gc);
        }
      }
    }

    final Runnable[] rebuildRef = new Runnable[1];
    final Runnable[] refreshTotalRef = new Runnable[1];
    final Map<String, View> groupAnchors = new HashMap<>();

    refreshTotalRef[0] =
        () -> {
          double unit = itemPrice(item);
          for (MenuModels.OptionGroup group : groups) {
            Map<String, Integer> gc = counts.get(group.id);
            if (gc == null) continue;
            for (MenuModels.Option opt : group.options) {
              int n = gc.getOrDefault(opt.id, 0);
              if (n > 0) unit += optionDelta(opt) * n;
            }
          }
          double total = unit * qty[0];
          confirmBtn.setText(String.format(Locale.getDefault(), getString(R.string.option_confirm_fmt), total));
        };

    rebuildRef[0] =
        () -> {
          groupsRoot.removeAllViews();
          groupAnchors.clear();
          if (groups.size() > 1) {
            TextView lead = new TextView(this);
            lead.setText("เลือกตัวเลือก");
            lead.setTextColor(0xFF333333);
            lead.setTypeface(NposFonts.semibold(this));
            lead.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp);
            lead.setGravity(Gravity.CENTER);
            lead.setPadding(0, 0, 0, uiScale.dp(8));
            groupsRoot.addView(lead);
          }
          for (MenuModels.OptionGroup group : groups) {
            List<MenuModels.Option> opts = OptionPickerLogic.sortForDisplay(group);
            TextView header = new TextView(this);
            String hint = OptionPickerLogic.groupHint(group);
            header.setText(group.name + (hint.isEmpty() ? "" : "\n" + hint));
            header.setTextColor(group.required ? 0xFF111827 : 0xFF4B5563);
            header.setTypeface(NposFonts.semibold(this));
            header.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.captionSp);
            header.setPadding(0, uiScale.dp(6), 0, uiScale.dp(4));
            groupsRoot.addView(header);
            groupAnchors.put(group.id, header);

            if (OptionPickerLogic.isSweetnessGroup(group)) {
              // Chip row — wrap, no scroll emphasis
              LinearLayout wrap = new LinearLayout(this);
              wrap.setOrientation(LinearLayout.VERTICAL);
              LinearLayout row = new LinearLayout(this);
              row.setOrientation(LinearLayout.HORIZONTAL);
              wrap.addView(row);
              int used = 0;
              int maxRow = Math.max(3, Math.min(5, opts.size()));
              String selected = singlePick.get(group.id);
              for (MenuModels.Option opt : opts) {
                if (used > 0 && used % maxRow == 0) {
                  row = new LinearLayout(this);
                  row.setOrientation(LinearLayout.HORIZONTAL);
                  wrap.addView(row);
                }
                TextView chip = new TextView(this);
                chip.setText(opt.name);
                chip.setGravity(Gravity.CENTER);
                chip.setMinHeight(uiScale.touchMinPx);
                chip.setPadding(uiScale.dp(10), uiScale.dp(8), uiScale.dp(10), uiScale.dp(8));
                chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.captionSp);
                chip.setTypeface(NposFonts.semibold(this));
                LinearLayout.LayoutParams clp =
                    new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                clp.setMargins(uiScale.dp(3), uiScale.dp(3), uiScale.dp(3), uiScale.dp(3));
                chip.setLayoutParams(clp);
                boolean on = selected != null && selected.equals(opt.id);
                chip.setBackgroundResource(on ? R.drawable.npos_nav_active : R.drawable.npos_touch_ghost);
                chip.setTextColor(on ? 0xFFFFFFFF : NposUi.color(this, R.color.npos_ink));
                chip.setOnClickListener(
                    v -> {
                      singlePick.put(group.id, opt.id);
                      Map<String, Integer> gc = new HashMap<>();
                      gc.put(opt.id, 1);
                      counts.put(group.id, gc);
                      rebuildRef[0].run();
                      refreshTotalRef[0].run();
                    });
                row.addView(chip);
                used++;
              }
              groupsRoot.addView(wrap);
            } else if (OptionPickerLogic.usesQuantitySteppers(group)) {
              Map<String, Integer> gc = counts.getOrDefault(group.id, new HashMap<>());
              for (MenuModels.Option opt : opts) {
                int count = gc.getOrDefault(opt.id, 0);
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setMinimumHeight(uiScale.touchMinPx);
                row.setPadding(uiScale.dp(4), uiScale.dp(4), uiScale.dp(4), uiScale.dp(4));
                if (count > 0) row.setBackgroundColor(0x1AE85D24);

                TextView name = new TextView(this);
                name.setText(opt.name);
                name.setTextColor(NposUi.color(this, R.color.npos_ink));
                name.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp);
                name.setTypeface(count > 0 ? NposFonts.semibold(this) : NposFonts.regular(this));
                LinearLayout.LayoutParams nlp =
                    new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                name.setLayoutParams(nlp);

                TextView price = new TextView(this);
                price.setText(
                    String.format(
                        Locale.getDefault(),
                        "%s%.0f",
                        optionDelta(opt) > 0 ? "+" : "+",
                        Math.max(0, optionDelta(opt))));
                price.setTextColor(0xFF555555);
                price.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.captionSp);
                price.setPadding(uiScale.dp(6), 0, uiScale.dp(8), 0);

                TextView minus = new TextView(this);
                minus.setText("−");
                minus.setGravity(Gravity.CENTER);
                minus.setMinWidth(uiScale.touchMinPx);
                minus.setMinHeight(uiScale.touchMinPx);
                minus.setBackgroundResource(R.drawable.npos_touch_ghost);
                minus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
                minus.setEnabled(count > 0);
                minus.setAlpha(count > 0 ? 1f : 0.35f);

                TextView countTv = new TextView(this);
                countTv.setText(String.valueOf(count));
                countTv.setGravity(Gravity.CENTER);
                countTv.setMinWidth(uiScale.dp(28));
                countTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp);
                countTv.setTypeface(NposFonts.semibold(this));

                TextView plus = new TextView(this);
                plus.setText("+");
                plus.setGravity(Gravity.CENTER);
                plus.setMinWidth(uiScale.touchMinPx);
                plus.setMinHeight(uiScale.touchMinPx);
                plus.setBackgroundResource(R.drawable.npos_touch_primary);
                plus.setTextColor(0xFFFFFFFF);
                plus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);

                final MenuModels.OptionGroup gRef = group;
                final MenuModels.Option oRef = opt;
                minus.setOnClickListener(
                    v -> {
                      Map<String, Integer> bucket =
                          counts.containsKey(gRef.id)
                              ? new HashMap<>(counts.get(gRef.id))
                              : new HashMap<>();
                      int cur = bucket.getOrDefault(oRef.id, 0);
                      if (cur <= 0) return;
                      cur -= 1;
                      if (cur <= 0) bucket.remove(oRef.id);
                      else bucket.put(oRef.id, cur);
                      if (bucket.isEmpty()) counts.remove(gRef.id);
                      else counts.put(gRef.id, bucket);
                      rebuildRef[0].run();
                      refreshTotalRef[0].run();
                    });
                plus.setOnClickListener(
                    v -> {
                      Map<String, Integer> bucket =
                          counts.containsKey(gRef.id)
                              ? new HashMap<>(counts.get(gRef.id))
                              : new HashMap<>();
                      int cur = bucket.getOrDefault(oRef.id, 0);
                      if (cur >= OptionPickerLogic.MAX_UNITS_PER_CHOICE) return;
                      int total = 0;
                      for (int n : bucket.values()) total += n;
                      int max = gRef.effectiveMax();
                      if (max < Integer.MAX_VALUE && total + 1 > max) {
                        Toast.makeText(
                                this,
                                getString(R.string.option_max, gRef.name, max),
                                Toast.LENGTH_SHORT)
                            .show();
                        return;
                      }
                      bucket.put(oRef.id, cur + 1);
                      counts.put(gRef.id, bucket);
                      rebuildRef[0].run();
                      refreshTotalRef[0].run();
                    });

                row.addView(name);
                row.addView(price);
                row.addView(minus);
                row.addView(countTv);
                row.addView(plus);
                groupsRoot.addView(row);
              }
            } else {
              // Single choice list — big tap rows (○ / ●)
              String selected = singlePick.get(group.id);
              for (MenuModels.Option opt : opts) {
                boolean on = selected != null && selected.equals(opt.id);
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setMinimumHeight(uiScale.touchMinPx);
                row.setPadding(uiScale.dp(6), uiScale.dp(8), uiScale.dp(6), uiScale.dp(8));
                if (on) row.setBackgroundColor(0x1AE85D24);

                TextView mark = new TextView(this);
                mark.setText(on ? "●" : "○");
                mark.setTextColor(on ? NposUi.color(this, R.color.npos_orange) : 0xFF666666);
                mark.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                mark.setPadding(0, 0, uiScale.dp(10), 0);

                TextView name = new TextView(this);
                name.setText(opt.name);
                name.setTextColor(NposUi.color(this, R.color.npos_ink));
                name.setTypeface(on ? NposFonts.semibold(this) : NposFonts.regular(this));
                name.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.bodySp);
                LinearLayout.LayoutParams nlp =
                    new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                name.setLayoutParams(nlp);

                TextView price = new TextView(this);
                price.setText(
                    String.format(
                        Locale.getDefault(), "+%.0f", Math.max(0, optionDelta(opt))));
                price.setTextColor(0xFF555555);
                price.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.captionSp);

                final MenuModels.OptionGroup gRef = group;
                final MenuModels.Option oRef = opt;
                View.OnClickListener pick =
                    v -> {
                      singlePick.put(gRef.id, oRef.id);
                      Map<String, Integer> gc = new HashMap<>();
                      gc.put(oRef.id, 1);
                      counts.put(gRef.id, gc);
                      rebuildRef[0].run();
                      refreshTotalRef[0].run();
                    };
                row.setOnClickListener(pick);
                row.addView(mark);
                row.addView(name);
                row.addView(price);
                groupsRoot.addView(row);
              }
            }
          }
          // Cap scroll height so footer stays visible (tablet-first: prefer see CTA)
          if (groupsScroll != null) {
            int maxH = (int) (getResources().getDisplayMetrics().heightPixels * 0.42f);
            groupsScroll.post(
                () -> {
                  if (groupsRoot.getHeight() > maxH) {
                    android.view.ViewGroup.LayoutParams lp = groupsScroll.getLayoutParams();
                    lp.height = maxH;
                    groupsScroll.setLayoutParams(lp);
                  }
                });
          }
        };

    qtyValue.setText(String.valueOf(qty[0]));
    qtyMinus.setOnClickListener(
        v -> {
          if (qty[0] <= 1) return;
          qty[0] -= 1;
          qtyValue.setText(String.valueOf(qty[0]));
          refreshTotalRef[0].run();
        });
    qtyPlus.setOnClickListener(
        v -> {
          if (qty[0] >= 99) return;
          qty[0] += 1;
          qtyValue.setText(String.valueOf(qty[0]));
          refreshTotalRef[0].run();
        });

    rebuildRef[0].run();
    refreshTotalRef[0].run();

    AlertDialog dialog =
        new AlertDialog.Builder(this).setView(sheet).setCancelable(true).create();
    cancelBtn.setOnClickListener(v -> dialog.dismiss());
    final int replaceAt = replaceIndex;
    confirmBtn.setOnClickListener(
        v -> {
          try {
            errView.setVisibility(View.GONE);
            JSONArray optionsJson = new JSONArray();
            double unit = itemPrice(item);
            for (MenuModels.OptionGroup group : groups) {
              Map<String, Integer> gc = counts.get(group.id);
              int totalUnits = 0;
              if (gc != null) {
                for (int n : gc.values()) totalUnits += n;
              }
              int min = group.effectiveMin();
              int max = group.effectiveMax();
              if (totalUnits < min) {
                errView.setVisibility(View.VISIBLE);
                errView.setText(
                    min <= 1 && totalUnits == 0
                        ? getString(R.string.option_required, group.name)
                        : getString(R.string.option_min, group.name, min));
                jumpToOptionGroup(groupsScroll, groupAnchors.get(group.id));
                return;
              }
              if (max < Integer.MAX_VALUE && totalUnits > max) {
                errView.setVisibility(View.VISIBLE);
                errView.setText(getString(R.string.option_max, group.name, max));
                jumpToOptionGroup(groupsScroll, groupAnchors.get(group.id));
                return;
              }
              if (totalUnits == 0) continue;
              JSONObject g = new JSONObject();
              g.put("groupId", group.id);
              g.put("groupName", group.name);
              JSONArray choices = new JSONArray();
              for (MenuModels.Option opt : OptionPickerLogic.sortForDisplay(group)) {
                int n = gc == null ? 0 : gc.getOrDefault(opt.id, 0);
                for (int i = 0; i < n; i++) {
                  JSONObject c = new JSONObject();
                  c.put("optionId", opt.id);
                  c.put("name", opt.name);
                  c.put("priceDelta", optionDelta(opt));
                  choices.put(c);
                  unit += optionDelta(opt);
                }
              }
              g.put("choices", choices);
              optionsJson.put(g);
            }
            if (replaceAt >= 0 && replaceAt < cart.size()) {
              cart.set(
                  replaceAt,
                  new MenuModels.CartLine(item.id, item.name, unit, qty[0], optionsJson));
              renderCart();
            } else {
              addItemWithOptions(item, optionsJson, unit, qty[0]);
            }
            dialog.dismiss();
          } catch (Exception e) {
            Toast.makeText(this, R.string.option_pick_fail, Toast.LENGTH_SHORT).show();
          }
        });
    dialog.show();
    if (dialog.getWindow() != null) {
      int w = Math.min(
          (int) (getResources().getDisplayMetrics().widthPixels * 0.62f),
          uiScale.dp(560));
      w = Math.max(w, uiScale.dp(420));
      dialog
          .getWindow()
          .setLayout(w, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
    }
  }

  /** Jump to required option group instantly (no smooth scroll) for fast counter work. */
  private void jumpToOptionGroup(ScrollView scroll, View anchor) {
    if (scroll == null || anchor == null) return;
    scroll.setSmoothScrollingEnabled(false);
    scroll.post(
        () -> {
          int y = Math.max(0, anchor.getTop() - NposUi.dp(this, 6));
          scroll.scrollTo(0, y);
          anchor.setBackgroundColor(0x33E85D24);
          anchor.postDelayed(() -> anchor.setBackgroundColor(0x00000000), 900L);
        });
  }

  /** Prefill option picker maps from a cart line's optionsJson. */
  private static void seedOptionCountsFromJson(
      JSONArray optionsJson,
      List<MenuModels.OptionGroup> groups,
      Map<String, Map<String, Integer>> counts,
      Map<String, String> singlePick) {
    if (optionsJson == null || optionsJson.length() == 0) return;
    try {
      for (int i = 0; i < optionsJson.length(); i++) {
        JSONObject g = optionsJson.optJSONObject(i);
        if (g == null) continue;
        String groupId = g.optString("groupId", "");
        JSONArray choices = g.optJSONArray("choices");
        if (groupId.isEmpty() || choices == null) continue;
        Map<String, Integer> bucket = new HashMap<>();
        String lastId = "";
        for (int j = 0; j < choices.length(); j++) {
          JSONObject c = choices.optJSONObject(j);
          if (c == null) continue;
          String oid = c.optString("optionId", "");
          if (oid.isEmpty()) continue;
          bucket.put(oid, bucket.getOrDefault(oid, 0) + 1);
          lastId = oid;
        }
        if (!bucket.isEmpty()) {
          counts.put(groupId, bucket);
          for (MenuModels.OptionGroup group : groups) {
            if (group.id.equals(groupId)
                && (group.isSingle() || OptionPickerLogic.isSweetnessGroup(group))
                && !lastId.isEmpty()) {
              singlePick.put(groupId, lastId);
            }
          }
        }
      }
    } catch (Exception ignored) {
      /* keep empty picks */
    }
  }

  private void addItemWithOptions(MenuModels.Item item, JSONArray optionsJson, double unit) {
    addItemWithOptions(item, optionsJson, unit, 1);
  }

  private void addItemWithOptions(
      MenuModels.Item item, JSONArray optionsJson, double unit, int qty) {
    int q = Math.max(1, qty);
    ensureDraftCartCode();
    cart.add(new MenuModels.CartLine(item.id, item.name, unit, q, optionsJson));
    renderCart();
    OpsLogger.info(this, "sale", "เพิ่มเมนู", item.name + " ×" + q);
  }

  /** Assign a short cart code once per basket — shown after ตะกร้า. */
  private void ensureDraftCartCode() {
    if (draftCartCode != null && !draftCartCode.isEmpty()) return;
    String raw = Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36);
    String tail = raw.replaceAll("[^a-zA-Z0-9]", "");
    if (tail.length() > 6) tail = tail.substring(tail.length() - 6);
    if (tail.isEmpty()) tail = "LOCAL1";
    draftCartCode = tail.toUpperCase(Locale.US);
  }

  private MenuModels.OptionGroup findGroup(String id) {
    if (menu == null) return null;
    for (MenuModels.OptionGroup g : menu.optionGroups) {
      if (g.id.equals(id)) return g;
    }
    return null;
  }

  private void renderCart() {
    if (!cart.isEmpty()) {
      // Next bill started — clear change hold + last-change chip.
      hideChangeHoldBar();
      clearLastChangeReminder();
    }
    renderCartViewsOnly();
    if (menu != null) renderMenu();
    syncCustomerDisplay();
  }

  private boolean isChangeHoldVisible() {
    return changeHoldBar != null && changeHoldBar.getVisibility() == View.VISIBLE;
  }

  private void showChangeHoldBar(double change) {
    if (changeHoldBar == null || changeHoldText == null) return;
    stopChangeHoldTimers();
    lastChangeBaht = change;
    changeHoldBar.setVisibility(View.VISIBLE);
    long holdMs = ChangeDisplayPrefs.holdMsForChange(this);
    if (holdMs > 0) {
      changeHoldSecondsLeft = (int) Math.max(1, (holdMs + 999) / 1000);
      refreshChangeHoldLabels(change);
      changeHoldTickTask =
          new Runnable() {
            @Override
            public void run() {
              changeHoldSecondsLeft -= 1;
              if (changeHoldSecondsLeft <= 0) {
                changeHoldTickTask = null;
                hideChangeHoldBar();
                pinLastChangeStatus();
                return;
              }
              refreshChangeHoldLabels(change);
              dutyHandler.postDelayed(this, 1000L);
            }
          };
      dutyHandler.postDelayed(changeHoldTickTask, 1000L);
      changeHoldHideTask =
          () -> {
            changeHoldHideTask = null;
            stopChangeHoldTimers();
            hideChangeHoldBar();
            pinLastChangeStatus();
          };
      dutyHandler.postDelayed(changeHoldHideTask, holdMs);
    } else {
      changeHoldSecondsLeft = -1;
      changeHoldText.setText(getString(R.string.sell_change_hold, change));
      if (changeHoldDismiss != null) {
        changeHoldDismiss.setText(R.string.change_hold_dismiss_x);
      }
    }
  }

  private void refreshChangeHoldLabels(double change) {
    if (changeHoldText != null) {
      changeHoldText.setText(
          getString(R.string.sell_change_hold_countdown, change, changeHoldSecondsLeft));
    }
    if (changeHoldDismiss != null) {
      changeHoldDismiss.setText(
          getString(R.string.change_hold_dismiss_countdown, changeHoldSecondsLeft));
    }
  }

  private void stopChangeHoldTimers() {
    if (changeHoldHideTask != null) {
      dutyHandler.removeCallbacks(changeHoldHideTask);
      changeHoldHideTask = null;
    }
    if (changeHoldTickTask != null) {
      dutyHandler.removeCallbacks(changeHoldTickTask);
      changeHoldTickTask = null;
    }
  }

  private void hideChangeHoldBar() {
    stopChangeHoldTimers();
    if (changeHoldBar != null) changeHoldBar.setVisibility(View.GONE);
  }

  /** Keep last change visible after the big bar closes — until next cart. */
  private void pinLastChangeStatus() {
    if (sellSyncStatus == null) return;
    if (lastChangeBaht > 0.01 && cart.isEmpty()) {
      sellSyncStatus.setText(getString(R.string.sell_last_change_fmt, lastChangeBaht));
    }
  }

  private void dismissChangeHoldUi() {
    hideChangeHoldBar();
    if (customerDisplay != null) customerDisplay.dismissChangeHold();
    pinLastChangeStatus();
  }

  private void clearLastChangeReminder() {
    lastChangeBaht = 0;
    if (sellSyncStatus != null
        && sellSyncStatus.getText() != null
        && sellSyncStatus.getText().toString().startsWith("ทอนล่าสุด")) {
      sellSyncStatus.setText(R.string.sell_saved_local);
    }
  }

  /** Update cashier cart UI without touching customer Presentation (e.g. during SUCCESS). */
  private void renderCartViewsOnly() {
    cartList.removeAllViews();
    if (uiScale == null) uiScale = UiScale.from(this, false);
    int padV = NposUi.dp(this, 6);
    // Slightly under left menu tile name (captionSp+0.5) — readable for tea prep.
    float nameSp = Math.max(12f, uiScale.captionSp);
    float optSp = Math.max(11f, uiScale.captionSp - 0.5f);
    for (int i = 0; i < cart.size(); i++) {
      final int idx = i;
      MenuModels.CartLine line = cart.get(i);
      MenuModels.Item menuItem = findMenuItem(line.menuItemId);

      LinearLayout block = new LinearLayout(this);
      block.setOrientation(LinearLayout.VERTICAL);
      block.setPadding(0, padV, 0, padV);

      // Receipt-style: name wraps · steppers · line total (no ellipsis hide)
      LinearLayout row = new LinearLayout(this);
      row.setOrientation(LinearLayout.HORIZONTAL);
      row.setGravity(Gravity.TOP);
      row.setMinimumHeight(NposUi.dp(this, 40));

      TextView nameTv =
          NposUi.section(
              this,
              String.format(Locale.getDefault(), "%d× %s", Math.max(1, line.qty), line.name));
      nameTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, nameSp);
      nameTv.setMaxLines(Integer.MAX_VALUE);
      nameTv.setSingleLine(false);
      nameTv.setEllipsize(null);
      nameTv.setHorizontallyScrolling(false);
      nameTv.setLayoutParams(
          new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
      if (menuItem != null && menuItem.hasOptions()) {
        nameTv.setOnClickListener(v -> editCartLineOptions(idx));
      }

      LinearLayout steppers = new LinearLayout(this);
      steppers.setOrientation(LinearLayout.HORIZONTAL);
      steppers.setGravity(Gravity.CENTER_VERTICAL);

      TextView minus = NposUi.chip(this, "−");
      minus.setMinimumWidth(NposUi.dp(this, 36));
      minus.setOnClickListener(
          v -> {
            line.qty -= 1;
            if (line.qty <= 0) cart.remove(idx);
            renderCart();
          });

      TextView qtyTv =
          NposUi.section(this, String.format(Locale.getDefault(), "%d", line.qty));
      qtyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, nameSp);
      qtyTv.setGravity(Gravity.CENTER);
      qtyTv.setMinimumWidth(NposUi.dp(this, 28));

      TextView plus = NposUi.chip(this, "+");
      plus.setMinimumWidth(NposUi.dp(this, 36));
      plus.setOnClickListener(
          v -> {
            line.qty += 1;
            renderCart();
          });

      TextView priceTv =
          NposUi.section(
              this, String.format(Locale.getDefault(), "฿%.0f", line.lineTotal()));
      priceTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, nameSp);
      priceTv.setGravity(Gravity.END);
      priceTv.setMinimumWidth(NposUi.dp(this, 48));
      priceTv.setPadding(NposUi.dp(this, 4), 0, 0, 0);

      steppers.addView(minus, NposUi.wrap(this, 4, 0));
      steppers.addView(qtyTv);
      steppers.addView(plus, NposUi.wrap(this, 4, 0));
      steppers.addView(priceTv);

      row.addView(nameTv);
      row.addView(steppers);
      block.addView(row);

      // Options: one line each, wrap if long — never truncate (prep checklist)
      for (String optLine : line.optionsLines()) {
        TextView optView = NposUi.caption(this, optLine);
        optView.setTextSize(TypedValue.COMPLEX_UNIT_SP, optSp);
        optView.setTextColor(NposUi.color(this, R.color.npos_ink_soft));
        optView.setTypeface(NposFonts.regular(this));
        optView.setMaxLines(Integer.MAX_VALUE);
        optView.setSingleLine(false);
        optView.setEllipsize(null);
        optView.setHorizontallyScrolling(false);
        optView.setPadding(NposUi.dp(this, 8), NposUi.dp(this, 1), 0, 0);
        if (menuItem != null && menuItem.hasOptions()) {
          optView.setOnClickListener(v -> editCartLineOptions(idx));
        }
        block.addView(optView);
      }

      cartList.addView(block);
    }

    double sub = cartSubtotal();
    double total = cartTotal();
    if (cartSubtotalView != null) {
      cartSubtotalView.setText(getString(R.string.cart_money_fmt, sub));
    }
    if (cartTotalView != null) {
      cartTotalView.setText(getString(R.string.cart_total_fmt, total));
    }
    if (discountLabel != null) {
      if (discountBaht > 0) {
        discountLabel.setText(getString(R.string.cart_discount_fmt, discountBaht));
        discountLabel.setTextColor(NposUi.color(this, R.color.npos_orange));
      } else {
        discountLabel.setText(R.string.cart_discount_none);
        discountLabel.setTextColor(NposUi.color(this, R.color.npos_muted));
      }
    }
    if (payAllAmount != null) {
      payAllAmount.setText(getString(R.string.cart_total_fmt, total));
    }
    if (payAllDiscount != null) {
      if (discountBaht > 0) {
        payAllDiscount.setVisibility(View.VISIBLE);
        payAllDiscount.setText(getString(R.string.pay_all_discount_fmt, discountBaht));
      } else {
        payAllDiscount.setVisibility(View.GONE);
        payAllDiscount.setText(R.string.pay_all_discount_none);
      }
    }
    TextView cartTitle = findViewById(R.id.cartTitle);
    if (cart.isEmpty()) {
      draftCartCode = "";
      if (cartTitle != null) cartTitle.setText(R.string.cart_title);
      if (cartBillRef != null) {
        cartBillRef.setVisibility(View.VISIBLE);
        cartBillRef.setText(R.string.cart_bill_new);
      }
    } else {
      ensureDraftCartCode();
      if (cartTitle != null) {
        cartTitle.setText(getString(R.string.cart_title_with_code, draftCartCode));
      }
      if (cartBillRef != null) {
        // Code lives in the title (ตะกร้า · #XXXX) — hide trailing duplicate.
        cartBillRef.setVisibility(View.GONE);
      }
    }
    updateHoldRestoreButton();
  }

  private void editCartLineOptions(int index) {
    if (index < 0 || index >= cart.size()) return;
    MenuModels.CartLine line = cart.get(index);
    MenuModels.Item item = findMenuItem(line.menuItemId);
    if (item == null || !item.hasOptions()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    showOptionPicker(item, index);
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
      List<String> optLines = line.optionsLines();
      String detail = optLines.isEmpty() ? "" : String.join("\n", optLines);
      lines.add(
          new CustomerDisplayPresentation.Line(
              line.name, line.qty, line.unitPrice, line.lineTotal(), detail));
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
      TextView b = NposUi.chip(this, "");
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

  private void startPayAll() {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    if (uiScale == null) uiScale = UiScale.from(this);

    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = uiScale.dp(12);
    box.setPadding(pad, pad, pad, pad);

    TextView hint = NposUi.caption(this, getString(R.string.pay_choose_hint));
    hint.setPadding(0, 0, 0, uiScale.dp(12));
    box.addView(hint);

    final AlertDialog[] holder = new AlertDialog[1];

    TextView cash = NposUi.primary(this, getString(R.string.btn_pay_cash));
    cash.setMaxWidth(Integer.MAX_VALUE);
    cash.setMinHeight(uiScale.payPrimaryMinPx);
    cash.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp);
    LinearLayout.LayoutParams cashLp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    cashLp.bottomMargin = uiScale.dp(10);
    cash.setLayoutParams(cashLp);
    cash.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          startPay("cash");
        });
    box.addView(cash);

    TextView transfer = NposUi.secondary(this, getString(R.string.btn_pay_transfer));
    transfer.setMaxWidth(Integer.MAX_VALUE);
    transfer.setMinHeight(uiScale.payPrimaryMinPx);
    transfer.setTextSize(TypedValue.COMPLEX_UNIT_SP, uiScale.titleSp);
    LinearLayout.LayoutParams transferLp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    transferLp.bottomMargin = uiScale.dp(10);
    transfer.setLayoutParams(transferLp);
    transfer.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
          startPay(PaymentMethods.TRANSFER);
        });
    box.addView(transfer);

    TextView cancel = NposUi.ghost(this, getString(android.R.string.cancel));
    cancel.setMaxWidth(Integer.MAX_VALUE);
    cancel.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    cancel.setOnClickListener(
        v -> {
          if (holder[0] != null) holder[0].dismiss();
        });
    box.addView(cancel);

    holder[0] =
        new AlertDialog.Builder(this).setTitle(R.string.pay_choose_title).setView(box).create();
    holder[0].show();
    if (holder[0].getWindow() != null) {
      int w =
          Math.min(
              (int) (getResources().getDisplayMetrics().widthPixels * 0.42f), uiScale.dp(420));
      w = Math.max(w, uiScale.dp(320));
      holder[0]
          .getWindow()
          .setLayout(w, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
    }
  }

  private void startPay(String method) {
    if (cart.isEmpty()) {
      Toast.makeText(this, R.string.cart_empty, Toast.LENGTH_SHORT).show();
      return;
    }
    String m = PaymentMethods.normalize(method);
    if (PaymentMethods.isCash(m)) {
      showCashKeypad(cartTotal());
      return;
    }
    if (PaymentMethods.isTransfer(m)) {
      showTransferConfirm(cartTotal());
      return;
    }
    Toast.makeText(this, R.string.pay_pp_hidden_early, Toast.LENGTH_LONG).show();
  }

  /**
   * Bank transfer — staff only confirms slip was checked. No account/code entry screen.
   */
  private void showTransferConfirm(double total) {
    NposConfirmDialog.confirm(
        this,
        getString(R.string.pay_transfer_title),
        getString(R.string.pay_transfer_msg, total),
        getString(R.string.pay_transfer_confirm),
        () -> commitSale(PaymentMethods.TRANSFER, 0, ""));
  }

  /** Early phase: PromptPay UI kept for compile safety but unused (QR removed). */
  @SuppressWarnings("unused")
  private void showPromptPayDialog(double total) {
    Toast.makeText(this, R.string.pay_pp_hidden_early, Toast.LENGTH_SHORT).show();
  }

  /** Clone web PosCashKeypad: exact · bills · digits · change. */
  private void showCashKeypad(double total) {
    // Always start at 0 / empty — staff type received cash (exact button still one-tap).
    final String[] valueHolder = {""};
    UiScale ui = uiScale != null ? uiScale : UiScale.from(this);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    int padH = ui.dp(12);
    root.setPadding(padH, ui.dp(4), padH, 0);

    TextView due = new TextView(this);
    due.setText(getString(R.string.pay_cash_due, total));
    due.setTextColor(0xFF1A2E24);
    due.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
    root.addView(due);

    TextView receivedLabel = new TextView(this);
    receivedLabel.setText(R.string.pay_cash_received_label);
    receivedLabel.setTextColor(0xFF666666);
    receivedLabel.setPadding(0, ui.dp(6), 0, 0);
    receivedLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.captionSp);
    root.addView(receivedLabel);

    TextView amountView = new TextView(this);
    amountView.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(22f, ui.titleSp + 8f));
    amountView.setTypeface(NposFonts.semibold(this));
    amountView.setTextColor(0xFF1A2E24);
    root.addView(amountView);

    TextView changeView = new TextView(this);
    changeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
    changeView.setPadding(0, ui.dp(2), 0, ui.dp(6));
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

    TextView exact = NposUi.chipPrimary(this, "");
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
      TextView b = NposUi.chip(this, "");
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
    TextView clear = NposUi.ghost(this, "");
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

    LinearLayout pad =
        NposNumberPad.attach(
            this,
            new NposNumberPad.Listener() {
              @Override
              public void onDigit(String digit) {
                valueHolder[0] = valueHolder[0] + digit;
                refresh.run();
              }

              @Override
              public void onBackspace() {
                if (!valueHolder[0].isEmpty()) {
                  valueHolder[0] = valueHolder[0].substring(0, valueHolder[0].length() - 1);
                }
                refresh.run();
              }
            },
            true,
            NposNumberPad.CHROME_CASH_DP);
    root.addView(pad);

    // No nested ScrollView — NposConfirmDialog already scrolls + fitCardToWindow.
    NposConfirmDialog.custom(
        this,
        getString(R.string.pay_cash_title),
        root,
        getString(R.string.btn_confirm_sale),
        () -> {
          double received = parseCashAmount(valueHolder[0]);
          if (received < total) {
            Toast.makeText(this, R.string.pay_cash_short, Toast.LENGTH_LONG).show();
            syncCustomerDisplay();
            return false;
          }
          commitSale("cash", received);
          return true;
        },
        this::syncCustomerDisplay);
  }

  private static double parseCashAmount(String raw) {
    if (raw == null || raw.trim().isEmpty()) return 0;
    try {
      return Double.parseDouble(raw.replaceAll("[^\\d.]", ""));
    } catch (Exception e) {
      return 0;
    }
  }

  private void commitSale(String method, double cashReceived) {
    commitSale(method, cashReceived, "");
  }

  private void commitSale(String method, double cashReceived, String transferRef) {
    sellSyncStatus.setText(R.string.sell_saving);
    List<MenuModels.CartLine> snapshot = new ArrayList<>(cart);
    double disc = discountBaht;
    final double changeForCustomer =
        PaymentMethods.isCash(method) ? Math.max(0, cashReceived - cartTotal()) : 0;
    boolean autoPrint = shop == null || shop.optBoolean("autoPrintReceipt", true);
    saleSync.enqueueSale(
        this,
        snapshot,
        method,
        cashReceived,
        disc,
        transferRef,
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
                            if (PaymentMethods.isCash(method)) {
                              PaymentVoice.speakCash(
                                  SellActivity.this, cashReceived, changeForCustomer);
                            }
                            cart.clear();
                            discountBaht = 0;
                            draftCartCode = "";
                            renderCartViewsOnly();
                            if (menu != null) renderMenu();
                            updateShiftSummary();
                            updatePendingBadge();
                            // Pin change on a hold bar (timer or until «ตกลง») — Toast alone is too brief.
                            if (changeForCustomer > 0.01) {
                              String changeLine =
                                  getString(R.string.sell_change_hold, changeForCustomer);
                              sellSyncStatus.setText(changeLine);
                              showChangeHoldBar(changeForCustomer);
                            } else {
                              hideChangeHoldBar();
                              sellSyncStatus.setText(R.string.sell_saved_local);
                              Toast.makeText(
                                      SellActivity.this,
                                      getString(R.string.sell_saved_toast, total),
                                      Toast.LENGTH_SHORT)
                                  .show();
                            }
                            maybeSettleRemoteClosed();
                          });
                    }

                    @Override
                    public void onSynced(String billNo, double change, double total) {
                      runOnUiThread(
                          () -> {
                            // Keep change reminder on status until next cart edit if still handing cash.
                            if (change > 0.01 && cart.isEmpty()) {
                              sellSyncStatus.setText(
                                  getString(R.string.sell_change_hold, change)
                                      + " · #"
                                      + billNo);
                            } else {
                              sellSyncStatus.setText(getString(R.string.sell_synced, billNo));
                            }
                            updatePendingBadge();
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
