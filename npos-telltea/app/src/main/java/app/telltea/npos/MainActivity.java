package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import app.telltea.npos.diagnose.AutoHealth;
import app.telltea.npos.diagnose.DeviceHeartbeat;
import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * N6 home: clock-in → SellActivity. Background heartbeat + auto diagnose.
 */
public class MainActivity extends Activity {
    private View clockInPanel;
    private View sellPanel;
    private TextView versionView;
    private TextView deviceIdView;
    private TextView heartbeatStatus;
    private TextView clockInTime;
    private TextView clockInDate;

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

        readLocalVersion();
        versionView.setText(getString(R.string.version_label, localVersionName, localVersionCode));
        deviceIdView.setText(
                getString(R.string.device_code_label, DeviceIdentity.pairingCode(this)));

        heartbeat = new DeviceHeartbeat();
        autoHealth = new AutoHealth();
        saleSync = new SaleSync();

        findViewById(R.id.openShiftButton).setOnClickListener(v -> openShift());
        findViewById(R.id.closeShiftButton).setOnClickListener(v -> closeShift());
        View.OnClickListener openSettings =
                v -> startActivity(new Intent(this, SettingsActivity.class));
        findViewById(R.id.settingsButtonClock).setOnClickListener(openSettings);
        findViewById(R.id.settingsButtonSell).setOnClickListener(openSettings);

        // Redirect stub sell panel into real sell screen.
        findViewById(R.id.sellPanel).setOnClickListener(v -> openSellIfNeeded());

        OpsLogger.info(this, "app", "เปิดแอป", "vc=" + localVersionCode);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ShiftPrefs.isOpen(this)) {
            clockInPanel.setVisibility(View.GONE);
            sellPanel.setVisibility(View.VISIBLE);
            TextView strip = findViewById(R.id.sellStatusStrip);
            if (strip != null) strip.setText(R.string.sell_status_online);
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

    private void openSellIfNeeded() {
        if (ShiftPrefs.isOpen(this)) {
            startActivity(new Intent(this, SellActivity.class));
        }
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
                                    startActivity(new Intent(this, SellActivity.class));
                                }));
    }

    private void closeShift() {
        saleSync.closeSession(
                this,
                () ->
                        runOnUiThread(
                                () -> {
                                    Toast.makeText(this, R.string.shift_closed, Toast.LENGTH_SHORT).show();
                                    clockInPanel.setVisibility(View.VISIBLE);
                                    sellPanel.setVisibility(View.GONE);
                                }));
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
                                        deviceIdView.setText(
                                                getString(R.string.device_code_label, pairingCode));
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
