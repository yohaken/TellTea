package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import app.telltea.npos.diagnose.AutoHealth;
import app.telltea.npos.diagnose.DeviceHeartbeat;
import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * N6.0 home: clock-in or empty sell shell.
 * Background: heartbeat + auto diagnose (no staff taps).
 */
public class MainActivity extends Activity {
    private View clockInPanel;
    private View sellPanel;
    private TextView versionView;
    private TextView deviceIdView;
    private TextView heartbeatStatus;
    private TextView clockInTime;
    private TextView clockInDate;
    private TextView sellStatusStrip;
    private TextView sellDeviceCode;

    private DeviceHeartbeat heartbeat;
    private AutoHealth autoHealth;
    private final Handler clockHandler = new Handler(Looper.getMainLooper());
    private boolean onlineOk;
    private int localVersionCode = 1;
    private String localVersionName = "1.0";

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
        sellStatusStrip = findViewById(R.id.sellStatusStrip);
        sellDeviceCode = findViewById(R.id.sellDeviceCode);

        readLocalVersion();
        versionView.setText(getString(R.string.version_label, localVersionName, localVersionCode));
        String code = DeviceIdentity.pairingCode(this);
        deviceIdView.setText(getString(R.string.device_code_label, code));
        sellDeviceCode.setText(code);

        heartbeat = new DeviceHeartbeat();
        autoHealth = new AutoHealth();

        findViewById(R.id.openShiftButton).setOnClickListener(v -> openShift());
        findViewById(R.id.closeShiftButton).setOnClickListener(v -> closeShift());
        View.OnClickListener openSettings =
                v -> startActivity(new Intent(this, SettingsActivity.class));
        findViewById(R.id.settingsButtonClock).setOnClickListener(openSettings);
        findViewById(R.id.settingsButtonSell).setOnClickListener(openSettings);

        renderMode();
        OpsLogger.info(this, "app", "เปิดแอป", "vc=" + localVersionCode);
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderMode();
        updateClockLabels();
        clockHandler.removeCallbacks(clockTick);
        clockHandler.post(clockTick);
        sendHeartbeat(false);
        autoHealth.maybeRun(this, false, null);
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
        OpsLogger.flushNow(this);
        super.onDestroy();
    }

    private void renderMode() {
        boolean open = ShiftPrefs.isOpen(this);
        clockInPanel.setVisibility(open ? View.GONE : View.VISIBLE);
        sellPanel.setVisibility(open ? View.VISIBLE : View.GONE);
        refreshSellStrip();
    }

    private void openShift() {
        ShiftPrefs.open(this);
        OpsLogger.info(this, "shift", "เข้างาน", "local open");
        renderMode();
        Toast.makeText(this, R.string.shift_opened, Toast.LENGTH_SHORT).show();
    }

    private void closeShift() {
        ShiftPrefs.close(this);
        OpsLogger.info(this, "shift", "ออกงาน", "local close");
        renderMode();
        Toast.makeText(this, R.string.shift_closed, Toast.LENGTH_SHORT).show();
    }

    private void updateClockLabels() {
        if (clockInTime == null) return;
        Date now = new Date();
        clockInTime.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(now));
        clockInDate.setText(
                new SimpleDateFormat("EEEE d MMM yyyy", new Locale("th", "TH")).format(now));
    }

    private void refreshSellStrip() {
        if (sellStatusStrip == null) return;
        if (onlineOk) {
            sellStatusStrip.setText(R.string.sell_status_online);
        } else {
            sellStatusStrip.setText(R.string.sell_status_waiting);
        }
    }

    private void sendHeartbeat(boolean force) {
        if (heartbeatStatus != null) {
            heartbeatStatus.setText(R.string.heartbeat_sending);
        }
        heartbeat.heartbeat(
                this,
                force,
                new DeviceHeartbeat.Callback() {
                    @Override
                    public void onSuccess(String pairingCode, long lastSeenAt) {
                        runOnUiThread(
                                () -> {
                                    onlineOk = true;
                                    if (deviceIdView != null) {
                                        deviceIdView.setText(
                                                getString(R.string.device_code_label, pairingCode));
                                    }
                                    if (sellDeviceCode != null) {
                                        sellDeviceCode.setText(pairingCode);
                                    }
                                    if (heartbeatStatus != null) {
                                        heartbeatStatus.setText(R.string.heartbeat_ok);
                                    }
                                    refreshSellStrip();
                                });
                    }

                    @Override
                    public void onError(Exception error) {
                        runOnUiThread(
                                () -> {
                                    onlineOk = false;
                                    String msg =
                                            error.getMessage() == null
                                                    ? error.getClass().getSimpleName()
                                                    : error.getMessage();
                                    if (heartbeatStatus != null) {
                                        heartbeatStatus.setText(
                                                getString(R.string.heartbeat_fail_human));
                                    }
                                    refreshSellStrip();
                                    OpsLogger.error(
                                            MainActivity.this, "heartbeat", "ส่งสัญญาณไม่สำเร็จ", msg);
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
