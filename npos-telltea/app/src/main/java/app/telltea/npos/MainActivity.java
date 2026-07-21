package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;

import app.telltea.npos.diagnose.DeviceHeartbeat;
import app.telltea.npos.diagnose.DeviceIdentity;

/**
 * nPos-telltea home — brand, device code, heartbeat.
 * Ops tools (update / diagnose / customer display) live in Settings.
 */
public class MainActivity extends Activity {
    private TextView versionView;
    private TextView deviceIdView;
    private TextView heartbeatStatus;
    private Button settingsButton;

    private DeviceHeartbeat heartbeat;
    private int localVersionCode = 1;
    private String localVersionName = "1.0";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        versionView = findViewById(R.id.version);
        deviceIdView = findViewById(R.id.deviceIdView);
        heartbeatStatus = findViewById(R.id.heartbeatStatus);
        settingsButton = findViewById(R.id.settingsButton);

        readLocalVersion();
        versionView.setText(getString(R.string.version_label, localVersionName, localVersionCode));
        deviceIdView.setText(
                getString(R.string.device_code_label, DeviceIdentity.pairingCode(this)));

        heartbeat = new DeviceHeartbeat();
        settingsButton.setOnClickListener(
                v -> startActivity(new Intent(this, SettingsActivity.class)));
    }

    @Override
    protected void onResume() {
        super.onResume();
        sendHeartbeat(false);
    }

    @Override
    protected void onDestroy() {
        if (heartbeat != null) heartbeat.shutdown();
        super.onDestroy();
    }

    private void sendHeartbeat(boolean force) {
        heartbeatStatus.setText(R.string.heartbeat_sending);
        heartbeat.heartbeat(
                this,
                force,
                new DeviceHeartbeat.Callback() {
                    @Override
                    public void onSuccess(String pairingCode, long lastSeenAt) {
                        runOnUiThread(() -> {
                            deviceIdView.setText(getString(R.string.device_code_label, pairingCode));
                            heartbeatStatus.setText(R.string.heartbeat_ok);
                        });
                    }

                    @Override
                    public void onError(Exception error) {
                        runOnUiThread(() -> {
                            String msg =
                                    error.getMessage() == null
                                            ? error.getClass().getSimpleName()
                                            : error.getMessage();
                            heartbeatStatus.setText(getString(R.string.heartbeat_fail, msg));
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
