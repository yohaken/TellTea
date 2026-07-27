package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.EditText;
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
import app.telltea.npos.diagnose.StoreClaimClient;
import app.telltea.npos.diagnose.StoreClaimPrefs;
import app.telltea.npos.sell.HoldCart;
import app.telltea.npos.sell.MenuWarmup;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shell.PosShellNav;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.OpenShiftFlow;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposUi;
import app.telltea.npos.ui.UiScale;
import app.telltea.npos.update.ResumePrefs;
import app.telltea.npos.update.UpdateManifest;
import app.telltea.npos.update.UpdatePromptController;

/**
 * Clock-in + POS hub (clone web POS_NAV_ITEMS). Sell is one tile — not the only screen.
 */
public class MainActivity extends Activity {
  public static final String EXTRA_SHOW_CLAIM_GATE = "show_claim_gate";
  private final StoreClaimPrefs.KickListener lostSeatListener = this::onLostSeat;
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
  private int latestRemoteVersionCode;
  private String latestRemoteVersionName = "";

  private final Runnable clockTick =
      new Runnable() {
        @Override
        public void run() {
          updateClockLabels();
          clockHandler.postDelayed(this, 30_000L);
        }
      };

  private final Runnable dutyTick =
      new Runnable() {
        @Override
        public void run() {
          if (hubShiftStrip != null && ShiftPrefs.isOpen(MainActivity.this)) {
            hubShiftStrip.setText(ShiftPrefs.dutyLine(MainActivity.this));
            clockHandler.postDelayed(this, 1000L);
          }
        }
      };

  /** Claim screen: refresh seat + latest.json ~45s. */
  private final Runnable claimPollTick =
      new Runnable() {
        @Override
        public void run() {
          if (isClaimGateVisible()) {
            ForegroundHeartbeat.forceNow(MainActivity.this);
            refreshStoreClaimGate();
            pollClaimUpdateChip();
            if (updatePrompt != null) updatePrompt.forceCheck();
          }
          clockHandler.postDelayed(this, 45_000L);
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    app.telltea.npos.ui.NposFonts.applyActivity(this);

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
          refreshStoreClaimGate();
        });

    findViewById(R.id.openShiftButton).setOnClickListener(v -> openShift());
    findViewById(R.id.closeShiftButton).setOnClickListener(v -> closeShift());
    findViewById(R.id.grantPermsButton).setOnClickListener(v -> PermissionBootstrap.grantAll(this));
    View claimBtn = findViewById(R.id.storeClaimButton);
    if (claimBtn != null) {
      claimBtn.setOnClickListener(v -> submitStoreClaim());
    }
    View clearRemembered = findViewById(R.id.clearRememberedCodeButton);
    if (clearRemembered != null) {
      clearRemembered.setOnClickListener(
          v -> {
            StoreClaimPrefs.clearRememberedStoreCode(this);
            EditText input = findViewById(R.id.storeClaimInput);
            if (input != null) input.setText("");
            Toast.makeText(this, R.string.store_claim_code_cleared, Toast.LENGTH_SHORT).show();
            refreshStoreClaimGate();
          });
    }
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
    new app.telltea.npos.sell.MenuRepository()
        .loadShop(
            this,
            shop ->
                runOnUiThread(
                    () -> {
                      PosShellNav.applyBrandLogo(this, shop);
                      try {
                        String logo = shop.optString("brandLogo", "");
                        if (!logo.isEmpty()) {
                          app.telltea.npos.sell.ImageLoader.decodeAsync(
                              this,
                              logo,
                              bmp -> {
                                if (bmp == null || isFinishing()) return;
                                try {
                                  String label =
                                      shop.optString(
                                          "shopName",
                                          shop.optString("shopNameTh", getString(R.string.app_name)));
                                  setTaskDescription(
                                      new android.app.ActivityManager.TaskDescription(label, bmp));
                                } catch (Exception ignored) {
                                  /* OEM */
                                }
                              });
                        }
                      } catch (Exception ignored) {
                        /* shop shape */
                      }
                    }));
    updatePrompt = new UpdatePromptController(this);
    View claimUpdate = findViewById(R.id.claimUpdateButton);
    if (claimUpdate != null) {
      claimUpdate.setOnClickListener(
          v -> {
            if (updatePrompt != null) updatePrompt.forceCheck();
          });
    }
    refreshPermissionGate();
    refreshStoreClaimGate();
    StoreClaimPrefs.addKickListener(lostSeatListener);
    // First open: auto-prompt so staff do not hunt Settings.
    if (!PermissionBootstrap.wasPrompted(this) && !PermissionBootstrap.allCriticalGranted(this)) {
      PermissionBootstrap.grantAll(this);
    }
    OpsLogger.info(this, "app", "เปิดแอป", "vc=" + localVersionCode);
    maybeResumeSellAfterUpdate();
  }

  private boolean isClaimGateVisible() {
    boolean required = StoreClaimPrefs.isRequired(this);
    return required && !StoreClaimPrefs.isSeatHeld(this) && !StoreClaimPrefs.isBlocked(this);
  }

  private void refreshStoreClaimGate() {
    View hint = findViewById(R.id.storeClaimHint);
    View input = findViewById(R.id.storeClaimInput);
    View btn = findViewById(R.id.storeClaimButton);
    View open = findViewById(R.id.openShiftButton);
    View versionChip = findViewById(R.id.claimVersionChip);
    View updateBtn = findViewById(R.id.claimUpdateButton);
    boolean required = StoreClaimPrefs.isRequired(this);
    boolean claimed = StoreClaimPrefs.isSeatHeld(this) || StoreClaimPrefs.isClaimed(this);
    boolean deviceBlocked = StoreClaimPrefs.isBlocked(this);
    boolean rejectDev = StoreClaimPrefs.rejectDev(this);
    boolean emulator = DeviceIdentity.isEmulator();
    boolean kicked = StoreClaimPrefs.isKicked(this);
    boolean seatTaken = StoreClaimPrefs.isSeatTaken(this);
    boolean needClaim = required && !StoreClaimPrefs.isSeatHeld(this) && !deviceBlocked;
    boolean blocked = StoreClaimPrefs.blocksWrites(this) && !needClaim;
    if (hint != null) {
      boolean showHint = blocked || needClaim || (!required && emulator);
      hint.setVisibility(showHint ? View.VISIBLE : View.GONE);
      if (hint instanceof TextView) {
        if (blocked && rejectDev && emulator) {
          ((TextView) hint).setText(R.string.store_claim_emulator_blocked);
        } else if (kicked) {
          ((TextView) hint)
              .setText(
                  StoreClaimPrefs.wasCodeChanged(this)
                      ? R.string.store_claim_code_changed
                      : R.string.store_claim_kicked);
        } else if (seatTaken) {
          ((TextView) hint).setText(R.string.store_claim_seat_taken);
        } else if (blocked) {
          ((TextView) hint).setText(R.string.store_claim_blocked);
        } else if (needClaim) {
          ((TextView) hint).setText(R.string.store_claim_hint);
        } else if (!required) {
          ((TextView) hint).setText(R.string.store_claim_not_configured);
        }
      }
    }
    if (input != null) {
      input.setVisibility(needClaim && !deviceBlocked ? View.VISIBLE : View.GONE);
      if (needClaim && !deviceBlocked && input instanceof EditText) {
        EditText ed = (EditText) input;
        if (ed.getText() == null || ed.getText().toString().trim().isEmpty()) {
          String remembered = StoreClaimPrefs.rememberedStoreCode(this);
          if (remembered != null && !remembered.isEmpty()) {
            ed.setText(remembered);
            ed.setSelection(ed.getText().length());
          }
        }
      }
    }
    View clearRemembered = findViewById(R.id.clearRememberedCodeButton);
    if (clearRemembered != null) {
      boolean showClear =
          needClaim && !deviceBlocked && StoreClaimPrefs.hasRememberedStoreCode(this);
      clearRemembered.setVisibility(showClear ? View.VISIBLE : View.GONE);
    }
    if (btn != null) btn.setVisibility(needClaim && !deviceBlocked ? View.VISIBLE : View.GONE);
    if (versionChip != null) {
      versionChip.setVisibility(needClaim ? View.VISIBLE : View.GONE);
      if (needClaim) updateClaimVersionChipText();
    }
    if (updateBtn != null) {
      boolean newer =
          latestRemoteVersionCode > 0 && latestRemoteVersionCode > localVersionCode;
      updateBtn.setVisibility(needClaim && newer ? View.VISIBLE : View.GONE);
    }
    if (open != null) {
      open.setEnabled(!StoreClaimPrefs.blocksWrites(this));
      open.setAlpha(StoreClaimPrefs.blocksWrites(this) ? 0.45f : 1f);
    }
  }

  private void updateClaimVersionChipText() {
    TextView chip = findViewById(R.id.claimVersionChip);
    if (chip == null) return;
    String remotePart;
    if (latestRemoteVersionCode > 0) {
      if (latestRemoteVersionCode > localVersionCode) {
        remotePart =
            getString(
                R.string.claim_version_latest, latestRemoteVersionName, latestRemoteVersionCode);
      } else {
        remotePart = getString(R.string.claim_version_current);
      }
    } else {
      remotePart = "";
    }
    chip.setText(
        getString(R.string.claim_version_chip, localVersionName, localVersionCode, remotePart));
  }

  private void pollClaimUpdateChip() {
    if (updatePrompt == null) return;
    updatePrompt.checkManifest(
        new app.telltea.npos.update.UpdateChecker.Callback() {
          @Override
          public void onResult(UpdateManifest manifest) {
            runOnUiThread(
                () -> {
                  if (manifest == null) return;
                  latestRemoteVersionCode = manifest.versionCode;
                  latestRemoteVersionName =
                      manifest.versionName == null ? "" : manifest.versionName;
                  refreshStoreClaimGate();
                });
          }

          @Override
          public void onError(Exception error) {
            /* silent — chip keeps last known */
          }
        });
  }

  private void onLostSeat() {
    runOnUiThread(
        () -> {
          // NposApp already toasts + CLEAR_TOP; refresh hub chrome when we are visible / become top.
          if (ShiftPrefs.isOpen(this)) {
            ShiftPrefs.clearLocalOpen(this);
          }
          if (clockInPanel != null) clockInPanel.setVisibility(View.VISIBLE);
          if (sellPanel != null) sellPanel.setVisibility(View.GONE);
          refreshStoreClaimGate();
          pollClaimUpdateChip();
          if (updatePrompt != null) updatePrompt.forceCheck();
        });
  }

  private void submitStoreClaim() {
    EditText input = findViewById(R.id.storeClaimInput);
    View btn = findViewById(R.id.storeClaimButton);
    String code = input == null || input.getText() == null ? "" : input.getText().toString();
    if (code.trim().length() < 4) {
      Toast.makeText(this, R.string.store_claim_input_hint, Toast.LENGTH_SHORT).show();
      return;
    }
    if (btn != null) {
      btn.setEnabled(false);
      if (btn instanceof TextView) ((TextView) btn).setText(R.string.store_claim_busy);
    }
    StoreClaimClient.claim(
        this,
        code,
        new StoreClaimClient.Callback() {
          @Override
          public void onSuccess() {
            runOnUiThread(
                () -> {
                  Toast.makeText(MainActivity.this, R.string.store_claim_ok, Toast.LENGTH_LONG)
                      .show();
                  if (btn != null) {
                    btn.setEnabled(true);
                    if (btn instanceof TextView) {
                      ((TextView) btn).setText(R.string.store_claim_btn);
                    }
                  }
                  refreshStoreClaimGate();
                });
          }

          @Override
          public void onError(String message) {
            runOnUiThread(
                () -> {
                  Toast.makeText(
                          MainActivity.this,
                          message == null || message.isEmpty()
                              ? getString(R.string.store_claim_blocked)
                              : message,
                          Toast.LENGTH_LONG)
                      .show();
                  if (btn != null) {
                    btn.setEnabled(true);
                    if (btn instanceof TextView) {
                      ((TextView) btn).setText(R.string.store_claim_btn);
                    }
                  }
                  refreshStoreClaimGate();
                });
          }
        });
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
        ((TextView) open).setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, ui.titleSp + 1f);
        ((TextView) open).setTypeface(app.telltea.npos.ui.NposFonts.semibold(this));
      }
    }
    if (settings != null) {
      settings.setMinimumHeight(ui.paySecondaryMinPx);
      if (settings instanceof TextView) {
        ((TextView) settings).setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, ui.bodySp);
        ((TextView) settings).setTypeface(app.telltea.npos.ui.NposFonts.medium(this));
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
    // Same order/labels as src/lib/pos-nav.ts POS_NAV_ITEMS (members hidden F3)
    addHubNative(R.string.nav_sell, () -> startActivity(new Intent(this, SellActivity.class)));
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
    addHubNative(R.string.nav_shift, () -> startActivity(new Intent(this, ShiftActivity.class)));
    addHubNative(R.string.btn_settings_device, () -> startActivity(new Intent(this, SettingsActivity.class)));
  }

  private void addHubNative(int labelRes, Runnable action) {
    TextView b = NposUi.secondary(this, getString(labelRes));
    b.setLayoutParams(NposUi.cta(this, 8));
    b.setOnClickListener(v -> action.run());
    hubNavList.addView(b);
  }

  private int dp(int v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
  }

  @Override
  protected void onResume() {
    super.onResume();
    TextView deviceCode = findViewById(R.id.sellDeviceCode);
    if (deviceCode != null) {
      deviceCode.setText(DeviceIdentity.pairingCode(this));
    }
    boolean forceClaim =
        getIntent() != null && getIntent().getBooleanExtra(EXTRA_SHOW_CLAIM_GATE, false);
    if (forceClaim && getIntent() != null) {
      getIntent().removeExtra(EXTRA_SHOW_CLAIM_GATE);
    }
    boolean canSell =
        !forceClaim && ShiftPrefs.isOpen(this) && !StoreClaimPrefs.blocksWrites(this);
    if (canSell) {
      clockInPanel.setVisibility(View.GONE);
      sellPanel.setVisibility(View.VISIBLE);
      if (hubShiftStrip != null) {
        hubShiftStrip.setText(ShiftPrefs.dutyLine(this));
      }
      maybeResumeSellAfterUpdate();
    } else {
      if (ShiftPrefs.isOpen(this) && StoreClaimPrefs.blocksWrites(this)) {
        ShiftPrefs.clearLocalOpen(this);
      }
      clockInPanel.setVisibility(View.VISIBLE);
      sellPanel.setVisibility(View.GONE);
    }
    refreshPermissionGate();
    refreshStoreClaimGate();
    updateClockLabels();
    clockHandler.removeCallbacks(clockTick);
    clockHandler.removeCallbacks(dutyTick);
    clockHandler.removeCallbacks(claimPollTick);
    clockHandler.post(clockTick);
    if (ShiftPrefs.isOpen(this) && !StoreClaimPrefs.blocksWrites(this)) {
      clockHandler.post(dutyTick);
    }
    if (isClaimGateVisible()) {
      pollClaimUpdateChip();
      clockHandler.postDelayed(claimPollTick, 30_000L);
    }
    ForegroundHeartbeat.forceNow(this);
    StoreClaimClient.syncPendingClaim(this);
    autoHealth.maybeRun(this, false, null);
    saleSync.flushPending(this);
    if (updatePrompt != null) updatePrompt.onResume();
  }

  @Override
  protected void onPause() {
    clockHandler.removeCallbacks(clockTick);
    clockHandler.removeCallbacks(dutyTick);
    clockHandler.removeCallbacks(claimPollTick);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    StoreClaimPrefs.removeKickListener(lostSeatListener);
    clockHandler.removeCallbacks(clockTick);
    clockHandler.removeCallbacks(dutyTick);
    clockHandler.removeCallbacks(claimPollTick);
    ForegroundHeartbeat.setStatusListener(null);
    if (autoHealth != null) autoHealth.shutdown();
    if (saleSync != null) saleSync.shutdown();
    OpsLogger.flushNow(this);
    super.onDestroy();
  }

  private void openShift() {
    if (openingShift) return;
    if (StoreClaimPrefs.blocksWrites(this)) {
      Toast.makeText(this, StoreClaimPrefs.blockReason(this), Toast.LENGTH_LONG).show();
      refreshStoreClaimGate();
      return;
    }
    openingShift = true;
    OpenShiftFlow.start(
        this,
        saleSync,
        () -> {
          openingShift = false;
          try {
            if (clockInPanel != null) clockInPanel.setVisibility(View.GONE);
            if (sellPanel != null) sellPanel.setVisibility(View.VISIBLE);
            if (hubShiftStrip != null) {
              hubShiftStrip.setText(ShiftPrefs.dutyLine(this));
            }
            // Counter flow: open shift → go straight to sell.
            startActivity(new Intent(MainActivity.this, SellActivity.class));
          } catch (Exception e) {
            OpsLogger.error(
                this, "shift", "เปิดกะอัปเดต UI", e.getMessage() == null ? "" : e.getMessage());
          }
        },
        () -> openingShift = false);
  }

  private void closeShift() {
    BlindCloseFlow.start(
        this,
        saleSync,
        () -> {
          clockInPanel.setVisibility(View.VISIBLE);
          sellPanel.setVisibility(View.GONE);
        });
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
