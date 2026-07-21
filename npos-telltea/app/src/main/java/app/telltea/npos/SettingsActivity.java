package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.diagnose.CustomerAmountPresentation;
import app.telltea.npos.diagnose.DisplayProbe;
import app.telltea.npos.update.ApkInstaller;
import app.telltea.npos.update.UpdateChecker;
import app.telltea.npos.update.UpdateConfig;
import app.telltea.npos.update.UpdateDownloader;
import app.telltea.npos.update.UpdateManifest;

/**
 * Settings: update channel, hardware diagnose, customer-display test (N3).
 * Keeps ops tools off the home screen.
 */
public class SettingsActivity extends Activity {
    private TextView settingsVersion;
    private TextView statusView;
    private TextView bannerView;
    private TextView customerStatus;
    private Button updateButton;

    private UpdateChecker checker;
    private UpdateDownloader downloader;
    private UpdateManifest pendingManifest;
    private CustomerAmountPresentation customerPresentation;
    private boolean busy;
    private long lastAutoCheckAt;
    private int localVersionCode = 1;
    private String localVersionName = "1.0";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        settingsVersion = findViewById(R.id.settingsVersion);
        statusView = findViewById(R.id.status);
        bannerView = findViewById(R.id.banner);
        customerStatus = findViewById(R.id.customerStatus);
        updateButton = findViewById(R.id.updateButton);

        readLocalVersion();
        settingsVersion.setText(
                getString(R.string.version_label, localVersionName, localVersionCode));

        checker = new UpdateChecker();
        downloader = new UpdateDownloader();

        updateButton.setOnClickListener(v -> onUpdateButtonClicked());
        findViewById(R.id.installPageButton).setOnClickListener(v -> openInstallPage());
        findViewById(R.id.diagnoseButton)
                .setOnClickListener(v -> startActivity(new Intent(this, DiagnoseActivity.class)));
        findViewById(R.id.customerAmount1Button)
                .setOnClickListener(v -> showCustomerAmount(120));
        findViewById(R.id.customerAmount2Button)
                .setOnClickListener(v -> showCustomerAmount(350));
        findViewById(R.id.customerCloseButton).setOnClickListener(v -> closeCustomerDisplay());
    }

    @Override
    protected void onResume() {
        super.onResume();
        maybeAutoCheck();
    }

    @Override
    protected void onDestroy() {
        closeCustomerDisplay();
        if (checker != null) checker.shutdown();
        if (downloader != null) downloader.shutdown();
        super.onDestroy();
    }

    private void openInstallPage() {
        String url =
                BuildConfig.INSTALL_PAGE_URL == null || BuildConfig.INSTALL_PAGE_URL.isEmpty()
                        ? "https://telltea-pos.web.app/install/"
                        : BuildConfig.INSTALL_PAGE_URL;
        ApkInstaller.openInstallPage(this, url);
    }

    private void showCustomerAmount(int baht) {
        try {
            closeCustomerDisplay();
            List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(this);
            DisplayProbe.DisplayInfo target = pickCustomerDisplay(displays);
            if (target == null) {
                customerStatus.setText(R.string.customer_test_no_display);
                Toast.makeText(this, R.string.customer_test_no_display, Toast.LENGTH_LONG).show();
                return;
            }
            String amount =
                    String.format(Locale.US, "฿%,d.00", baht);
            String hint =
                    target.primary
                            ? getString(R.string.customer_test_on_primary, target.number)
                            : getString(R.string.customer_test_on_secondary, target.number);
            customerPresentation =
                    new CustomerAmountPresentation(this, target.display, amount, hint);
            customerPresentation.setOnDismissListener(d -> customerPresentation = null);
            customerPresentation.show();
            customerStatus.setText(
                    getString(R.string.customer_test_showing, amount, target.number));
            Toast.makeText(this, customerStatus.getText(), Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            customerStatus.setText(getString(R.string.customer_test_fail, msg));
            Toast.makeText(this, customerStatus.getText(), Toast.LENGTH_LONG).show();
        }
    }

    private static DisplayProbe.DisplayInfo pickCustomerDisplay(List<DisplayProbe.DisplayInfo> displays) {
        if (displays == null || displays.isEmpty()) return null;
        for (DisplayProbe.DisplayInfo info : displays) {
            if (!info.primary) return info;
        }
        return displays.get(0);
    }

    private void closeCustomerDisplay() {
        if (customerPresentation != null) {
            try {
                customerPresentation.dismiss();
            } catch (Exception ignored) {
                /* already gone */
            }
            customerPresentation = null;
        }
        if (customerStatus != null) {
            customerStatus.setText(R.string.customer_test_idle);
        }
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

    private void maybeAutoCheck() {
        long now = System.currentTimeMillis();
        if (busy) return;
        if (now - lastAutoCheckAt < UpdateConfig.AUTO_CHECK_MIN_INTERVAL_MS) return;
        lastAutoCheckAt = now;
        startCheck(false);
    }

    private void onUpdateButtonClicked() {
        if (busy) return;
        if (pendingManifest != null && pendingManifest.isNewerThan(localVersionCode)) {
            startDownloadAndInstall(pendingManifest);
        } else {
            startCheck(true);
        }
    }

    private void startCheck(boolean manual) {
        busy = true;
        setStatus(getString(R.string.status_checking));
        updateButton.setEnabled(false);
        String manifestUrl =
                BuildConfig.UPDATE_MANIFEST_URL == null || BuildConfig.UPDATE_MANIFEST_URL.isEmpty()
                        ? UpdateConfig.MANIFEST_URL
                        : BuildConfig.UPDATE_MANIFEST_URL;

        checker.check(
                manifestUrl,
                new UpdateChecker.Callback() {
                    @Override
                    public void onResult(UpdateManifest manifest) {
                        runOnUiThread(() -> applyManifest(manifest, manual));
                    }

                    @Override
                    public void onError(Exception error) {
                        runOnUiThread(() -> {
                            busy = false;
                            updateButton.setEnabled(true);
                            pendingManifest = null;
                            bannerView.setVisibility(View.GONE);
                            updateButton.setText(R.string.btn_check_update);
                            setStatus(getString(
                                    R.string.status_error,
                                    error.getMessage() == null ? "network" : error.getMessage()));
                        });
                    }
                });
    }

    private void applyManifest(UpdateManifest manifest, boolean manual) {
        busy = false;
        updateButton.setEnabled(true);
        if (manifest.isNewerThan(localVersionCode)) {
            pendingManifest = manifest;
            bannerView.setVisibility(View.VISIBLE);
            updateButton.setText(R.string.btn_install_update);
            setStatus(getString(
                    R.string.status_available, manifest.versionName, manifest.versionCode));
        } else {
            pendingManifest = null;
            bannerView.setVisibility(View.GONE);
            updateButton.setText(R.string.btn_check_update);
            setStatus(getString(R.string.status_up_to_date));
        }
    }

    private void startDownloadAndInstall(UpdateManifest manifest) {
        if (!ApkInstaller.canInstallPackages(this)) {
            setStatus(getString(R.string.status_allow_install));
            ApkInstaller.openUnknownSourcesSettings(this);
            return;
        }

        busy = true;
        updateButton.setEnabled(false);
        setStatus(getString(R.string.status_downloading, 0));

        String apkUrl = manifest.apkUrl;
        if (apkUrl == null || apkUrl.isEmpty()) {
            apkUrl = BuildConfig.DEFAULT_APK_URL;
        }

        downloader.download(
                this,
                apkUrl,
                new UpdateDownloader.Callback() {
                    @Override
                    public void onProgress(int percent) {
                        runOnUiThread(
                                () -> setStatus(getString(R.string.status_downloading, percent)));
                    }

                    @Override
                    public void onComplete(File apkFile) {
                        runOnUiThread(() -> commitInstall(apkFile));
                    }

                    @Override
                    public void onError(Exception error) {
                        runOnUiThread(() -> {
                            busy = false;
                            updateButton.setEnabled(true);
                            setStatus(getString(
                                    R.string.status_error,
                                    error.getMessage() == null ? "download" : error.getMessage()));
                        });
                    }
                });
    }

    private void commitInstall(File apkFile) {
        setStatus(getString(R.string.status_installing));
        try {
            ApkInstaller.install(this, apkFile);
            busy = false;
            updateButton.setEnabled(true);
        } catch (Exception e) {
            busy = false;
            updateButton.setEnabled(true);
            String msg = e.getMessage() == null ? "install" : e.getMessage();
            setStatus(getString(R.string.status_error, msg));
            statusView.append("\n" + getString(R.string.status_signature_hint));
        }
    }

    private void setStatus(String text) {
        statusView.setText(text);
    }
}
