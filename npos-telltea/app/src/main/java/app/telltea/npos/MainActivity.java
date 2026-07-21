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
import app.telltea.npos.diagnose.DeviceHeartbeat;
import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.update.ApkInstaller;

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

  private DeviceHeartbeat heartbeat;
  private AutoHealth autoHealth;
  private SaleSync saleSync;
  private final Handler clockHandler = new Handler(Looper.getMainLooper());
  private int localVersionCode = 1;
  private String localVersionName = "1.0";
  private boolean openingShift;

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
    deviceIdView.setText(getString(R.string.device_code_label, DeviceIdentity.pairingCode(this)));

    heartbeat = new DeviceHeartbeat();
    autoHealth = new AutoHealth();
    saleSync = new SaleSync();

    findViewById(R.id.openShiftButton).setOnClickListener(v -> openShift());
    findViewById(R.id.closeShiftButton).setOnClickListener(v -> closeShift());
    View.OnClickListener openSettings =
        v -> startActivity(new Intent(this, SettingsActivity.class));
    findViewById(R.id.settingsButtonClock).setOnClickListener(openSettings);
    findViewById(R.id.settingsButtonSell).setOnClickListener(openSettings);

    buildHubNav();
    OpsLogger.info(this, "app", "เปิดแอป", "vc=" + localVersionCode);
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
    } else {
      clockInPanel.setVisibility(View.VISIBLE);
      sellPanel.setVisibility(View.GONE);
    }
    updateClockLabels();
    clockHandler.removeCallbacks(clockTick);
    clockHandler.post(clockTick);
    sendHeartbeat(false);
    autoHealth.maybeRun(this, false, null);
    saleSync.flushPending(this);
  }

  @Override
  protected void onPause() {
    clockHandler.removeCallbacks(clockTick);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    clockHandler.removeCallbacks(clockTick);
    if (heartbeat != null) heartbeat.shutdown();
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

  private void sendHeartbeat(boolean force) {
    if (heartbeatStatus != null) heartbeatStatus.setText(R.string.heartbeat_sending);
    heartbeat.heartbeat(
        this,
        force,
        new DeviceHeartbeat.Callback() {
          @Override
          public void onSuccess(String pairingCode, long lastSeenAt) {
            runOnUiThread(
                () -> {
                  if (deviceIdView != null) {
                    deviceIdView.setText(getString(R.string.device_code_label, pairingCode));
                  }
                  if (heartbeatStatus != null) {
                    heartbeatStatus.setText(R.string.heartbeat_ok);
                  }
                });
          }

          @Override
          public void onError(Exception error) {
            runOnUiThread(
                () -> {
                  if (heartbeatStatus != null) {
                    heartbeatStatus.setText(R.string.heartbeat_fail_human);
                  }
                  OpsLogger.error(
                      MainActivity.this,
                      "heartbeat",
                      "ส่งสัญญาณไม่สำเร็จ",
                      error.getMessage() == null
                          ? error.getClass().getSimpleName()
                          : error.getMessage());
                });
          }
        });
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
