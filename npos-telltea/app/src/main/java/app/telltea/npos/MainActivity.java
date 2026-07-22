package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import app.telltea.npos.diagnose.AutoHealth;
import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.ForegroundHeartbeat;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.diagnose.PermissionBootstrap;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.MenuWarmup;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shell.PosShellNav;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.UiScale;
import app.telltea.npos.update.ApkInstaller;
import app.telltea.npos.update.ResumePrefs;
import app.telltea.npos.update.UpdatePromptController;

/**
 * Clock-in + POS hub (clone web POS_NAV_ITEMS). Sell is one tile — not the only screen.
 */
public class MainActivity extends Activity {
  private View clockInPanel;
  private View sellPanel;
  private TextView versionView;
  private TextView deviceIdView;
  private TextView heartbeatStatus;
  private TextView clockInTime;
  private TextView clockInDate;
  private TextView hubShiftStrip;
  private LinearLayout hubNavList;

  private AutoHealth autoHealth;
  private SaleSync saleSync;
  private UpdatePromptController updatePrompt;
  private final Handler clockHandler = new Handler(Looper.getMainLooper());
  private int localVersionCode = 1;
  private String localVersionName = "1.0";
  private boolean openingShift;
  private boolean resumeSellHandled;

  private final Runnable clockTick =
      new Runnable() {
        @Override
        public void run() {
          updateClockLabels();
          clockHandler.postDelayed(this, 30_000L);
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    clockInPanel = findViewById(R.id.clockInPanel);
    sellPanel = findViewById(R.id.sellPanel);
    versionView = findViewById(R.id.version);
    deviceIdView = findViewById(R.id.deviceIdView);
    heartbeatStatus = findViewById(R.id.heartbeatStatus);
    clockInTime = findViewById(R.id.clockInTime);
    clockInDate = findViewById(R.id.clockInDate);
    hubShiftStrip = findViewById(R.id.hubShiftStrip);
    hubNavList = findViewById(R.id.hubNavList);

    readLocalVersion();
    versionView.setText(getString(R.string.version_label, localVersionName, localVersionCode));
    TextView hubVersion = findViewById(R.id.hubVersion);
    if (hubVersion != null) {
      hubVersion.setText(getString(R.string.version_label, localVersionName, localVersionCode));
    }
    deviceIdView.setText(getString(R.string.device_code_label, DeviceIdentity.pairingCode(this)));

    autoHealth = new AutoHealth();
    saleSync = new SaleSync();
    MenuWarmup.warm(this);
    applyClockInTouchChrome();
    ForegroundHeartbeat.setStatusListener(
        (pairing, seenAt, error) -> {
          if (deviceIdView != null && pairing != null && !pairing.isEmpty()) {
            deviceIdView.setText(getString(R.string.device_code_label, pairing));
          }
          if (heartbeatStatus == null) return;
          if (error != null && !error.isEmpty()) {
            heartbeatStatus.setText(R.string.heartbeat_fail_human);
            OpsLogger.error(MainActivity.this, "heartbeat", "ส่งสัญญาณไม่สำเร็จ", error);
          } else {
            heartbeatStatus.setText(R.string.heartbeat_ok);
          }
        });

    findViewById(R.id.openShiftButton).setOnClickListener(v -> openShift());
    findViewById(R.id.closeShiftButton).setOnClickListener(v -> closeShift());
    findViewById(R.id.grantPermsButton).setOnClickListener(v -> PermissionBootstrap.grantAll(this));
    View.OnClickListener openSettings =
        v -> startActivity(new Intent(this, SettingsActivity.class));
    findViewById(R.id.settingsButtonClock).setOnClickListener(openSettings);
    findViewById(R.id.settingsButtonSell).setOnClickListener(openSettings);

    buildHubNav();
    PosShellNav.bind(
        this,
        PosShellNav.ACTIVE_HUB,
        () -> {
          MenuWarmup.warm(this);
          Toast.makeText(this, R.string.btn_refresh_menu, Toast.LENGTH_SHORT).show();
        });
    updatePrompt = new UpdatePromptController(this);
    refreshPermissionGate();
    // First open: auto-prompt so staff do not hunt Settings.
    if (!PermissionBootstrap.wasPrompted(this) && !PermissionBootstrap.allCriticalGranted(this)) {
      PermissionBootstrap.grantAll(this);
    }
    OpsLogger.info(this, "app", "เปิดแอป", "vc=" + localVersionCode);
    maybeResumeSellAfterUpdate();
  }

  private void maybeResumeSellAfterUpdate() {
    if (resumeSellHandled) return;
    boolean want =
        getIntent() != null && getIntent().getBooleanExtra("resume_sell", false)
            || ResumePrefs.consumeResumeSellAfterUpdate(this);
    if (!want) return;
    if (!ShiftPrefs.isOpen(this)) return;
    resumeSellHandled = true;
    startActivity(new Intent(this, SellActivity.class));
  }

  private void applyClockInTouchChrome() {
    UiScale ui = UiScale.from(this);
    View open = findViewById(R.id.openShiftButton);
    View settings = findViewById(R.id.settingsButtonClock);
    View grant = findViewById(R.id.grantPermsButton);
    View close = findViewById(R.id.closeShiftButton);
    View settingsSell = findViewById(R.id.settingsButtonSell);
    if (open != null) {
      open.setMinimumHeight(ui.payPrimaryMinPx);
      if (open instanceof TextView) {
        ((TextView) open).setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 3f);
      }
    }
    if (settings != null) {
      settings.setMinimumHeight(ui.paySecondaryMinPx);
      if (settings instanceof TextView) {
        ((TextView) settings).setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
      }
    }
    if (grant != null) grant.setMinimumHeight(ui.touchMinPx);
    if (close != null) close.setMinimumHeight(ui.touchMinPx);
    if (settingsSell != null) settingsSell.setMinimumHeight(ui.touchMinPx);
    TextView hubVersion = findViewById(R.id.hubVersion);
    if (hubVersion != null) {
      hubVersion.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, Math.max(11f, ui.captionSp));
    }
  }

  private void refreshPermissionGate() {
    View grantBtn = findViewById(R.id.grantPermsButton);
    TextView status = findViewById(R.id.permStatusView);
    if (grantBtn == null || status == null) return;
    boolean ok = PermissionBootstrap.allCriticalGranted(this);
    String line = PermissionBootstrap.statusLine(this);
    status.setText(ok ? getString(R.string.perm_all_ok) : line + "\n" + getString(R.string.perm_gate_hint));
    status.setVisibility(View.VISIBLE);
    status.setTextColor(ok ? 0xFF2E6B4E : 0xFF8A4B12);
    grantBtn.setVisibility(ok ? View.GONE : View.VISIBLE);
  }

  @Override
  public void onRequestPermissionsResult(
      int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == PermissionBootstrap.REQ_RUNTIME) {
      PermissionBootstrap.continueSystemSettings(this);
      refreshPermissionGate();
      OpsLogger.info(this, "app", "ขอสิทธิ์รันไทม์", PermissionBootstrap.statusLine(this));
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == PermissionBootstrap.REQ_INSTALL
        || requestCode == PermissionBootstrap.REQ_BATTERY) {
      if (requestCode == PermissionBootstrap.REQ_INSTALL
          && PermissionBootstrap.canInstallPackages(this)
          && !PermissionBootstrap.isBatteryUnrestricted(this)) {
        PermissionBootstrap.openBatteryExemption(this);
      }
      refreshPermissionGate();
      OpsLogger.info(this, "app", "ตั้งค่าสิทธิ์ระบบ", PermissionBootstrap.statusLine(this));
    }
  }

  private void buildHubNav() {
    if (hubNavList == null) return;
    hubNavList.removeAllViews();
    // Same order/labels as src/lib/pos-nav.ts POS_NAV_ITEMS
    addHubNative(R.string.nav_sell, () -> startActivity(new Intent(this, SellActivity.class)));
    addHubWeb(R.string.nav_members, "https://telltea-pos.web.app/pos/members/", true);
    addHubNative(
        R.string.nav_open_bills,
        () -> {
          if (HoldCart.hasHold(this)) {
            startActivity(new Intent(this, SellActivity.class));
            Toast.makeText(this, R.string.hub_open_bills_hint, Toast.LENGTH_LONG).show();
          } else {
            Toast.makeText(this, R.string.hold_empty, Toast.LENGTH_SHORT).show();
          }
        });
    addHubNative(R.string.nav_receipts, () -> startActivity(new Intent(this, ReceiptsActivity.class)));
    addHubWeb(R.string.nav_inventory, "https://telltea-pos.web.app/pos/inventory/", false);
    addHubNative(R.string.nav_shift, () -> startActivity(new Intent(this, ShiftActivity.class)));
    addHubWeb(R.string.nav_menu, "https://telltea-pos.web.app/pos/menu/", false);
    addHubWeb(R.string.nav_ops, "https://telltea-pos.web.app/pos/ops/", false);
    addHubWeb(R.string.nav_shop_settings, "https://telltea-pos.web.app/pos/settings/", false);
    addHubNative(R.string.btn_settings_device, () -> startActivity(new Intent(this, SettingsActivity.class)));
  }

  private void addHubNative(int labelRes, Runnable action) {
    Button b = hubButton(getString(labelRes), false);
    b.setOnClickListener(v -> action.run());
    hubNavList.addView(b);
  }

  private void addHubWeb(int labelRes, String url, boolean stubNote) {
    String label = getString(labelRes) + (stubNote ? " · เว็บ" : " · เว็บ");
    Button b = hubButton(label, true);
    b.setOnClickListener(v -> openWeb(url));
    hubNavList.addView(b);
  }

  private Button hubButton(String label, boolean secondary) {
    Button b = new Button(this);
    b.setAllCaps(false);
    b.setText(label);
    b.setMinHeight(dp(52));
    LinearLayout.LayoutParams lp =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.bottomMargin = dp(8);
    b.setLayoutParams(lp);
    if (secondary) {
      b.setTextColor(0xFF1A2E24);
    }
    return b;
  }

  private int dp(int v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }

  private void openWeb(String url) {
    try {
      ApkInstaller.openInstallPage(this, url);
      OpsLogger.info(this, "app", "เปิดเมนูเว็บ", url);
    } catch (Exception e) {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    TextView deviceCode = findViewById(R.id.sellDeviceCode);
    if (deviceCode != null) {
      deviceCode.setText(DeviceIdentity.pairingCode(this));
    }
    if (ShiftPrefs.isOpen(this)) {
      clockInPanel.setVisibility(View.GONE);
      sellPanel.setVisibility(View.VISIBLE);
      if (hubShiftStrip != null) {
        hubShiftStrip.setText(
            getString(
                R.string.shift_summary_fmt,
                ShiftPrefs.saleCount(this),
                ShiftPrefs.cashTotal(this),
                ShiftPrefs.promptpayTotal(this),
                ShiftPrefs.voidedCount(this)));
      }
      maybeResumeSellAfterUpdate();
    } else {
      clockInPanel.setVisibility(View.VISIBLE);
      sellPanel.setVisibility(View.GONE);
    }
    refreshPermissionGate();
    updateClockLabels();
    clockHandler.removeCallbacks(clockTick);
    clockHandler.post(clockTick);
    ForegroundHeartbeat.forceNow(this);
    autoHealth.maybeRun(this, false, null);
    saleSync.flushPending(this);
    if (updatePrompt != null) updatePrompt.onResume();
  }

  @Override
  protected void onPause() {
    clockHandler.removeCallbacks(clockTick);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    clockHandler.removeCallbacks(clockTick);
    ForegroundHeartbeat.setStatusListener(null);
    if (autoHealth != null) autoHealth.shutdown();
    if (saleSync != null) saleSync.shutdown();
    OpsLogger.flushNow(this);
    super.onDestroy();
  }

  private void openShift() {
    if (openingShift) return;
    openingShift = true;
    heartbeatStatus.setText(R.string.shift_opening);
    saleSync.openSession(
        this,
        () ->
            runOnUiThread(
                () -> {
                  openingShift = false;
                  Toast.makeText(this, R.string.shift_opened, Toast.LENGTH_SHORT).show();
                  // Stay on hub — user picks สั่งและชำระเงิน (like web shell)
                  clockInPanel.setVisibility(View.GONE);
                  sellPanel.setVisibility(View.VISIBLE);
                  if (hubShiftStrip != null) {
                    hubShiftStrip.setText(
                        getString(
                            R.string.shift_summary_fmt,
                            ShiftPrefs.saleCount(this),
                            ShiftPrefs.cashTotal(this),
                            ShiftPrefs.promptpayTotal(this),
                            ShiftPrefs.voidedCount(this)));
                  }
                }));
  }

  private void closeShift() {
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
                          clockInPanel.setVisibility(View.VISIBLE);
                          sellPanel.setVisibility(View.GONE);
                        })));
  }

  private void updateClockLabels() {
    if (clockInTime == null) return;
    Date now = new Date();
    clockInTime.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(now));
    clockInDate.setText(
        new SimpleDateFormat("EEEE d MMM yyyy", new Locale("th", "TH")).format(now));
  }

  private void readLocalVersion() {
    try {
      PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
      localVersionName = info.versionName == null ? "1.0" : info.versionName;
      if (android.os.Build.VERSION.SDK_INT >= 28) {
        localVersionCode = (int) info.getLongVersionCode();
      } else {
        localVersionCode = info.versionCode;
      }
    } catch (Exception ignored) {
      localVersionCode = BuildConfig.VERSION_CODE;
      localVersionName = BuildConfig.VERSION_NAME;
    }
  }
}
