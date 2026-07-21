package app.telltea.npos;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import app.telltea.npos.update.ApkInstaller;
import app.telltea.npos.update.UpdateChecker;
import app.telltea.npos.update.UpdateConfig;
import app.telltea.npos.update.UpdateDownloader;
import app.telltea.npos.update.UpdateManifest;

import java.io.File;

/**
 * nPos-telltea home screen + update channel UI.
 * Auto-checks on launch/resume; manual check via button.
 */
public class MainActivity extends Activity {
    private TextView versionView;
    private TextView statusView;
    private TextView bannerView;
    private Button updateButton;

    private UpdateChecker checker;
    private UpdateDownloader downloader;
    private UpdateManifest pendingManifest;
    private boolean busy;
    private long lastAutoCheckAt;
    private int localVersionCode = 1;
    private String localVersionName = "1.0";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        versionView = findViewById(R.id.version);
        statusView = findViewById(R.id.status);
        bannerView = findViewById(R.id.banner);
        updateButton = findViewById(R.id.updateButton);

        readLocalVersion();
        versionView.setText(getString(R.string.version_label, localVersionName, localVersionCode));

        checker = new UpdateChecker();
        downloader = new UpdateDownloader();

        updateButton.setOnClickListener(v -> onUpdateButtonClicked());
    }

    @Override
    protected void onResume() {
        super.onResume();
        maybeAutoCheck();
    }

    @Override
    protected void onDestroy() {
        if (checker != null) checker.shutdown();
        if (downloader != null) downloader.shutdown();
        super.onDestroy();
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
            if (manual) {
                // Manual check found an update — keep user in control; they tap again to install.
            }
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
            // Installer UI / reboot into new version takes over; re-enable just in case user cancels.
            busy = false;
            updateButton.setEnabled(true);
        } catch (Exception e) {
            busy = false;
            updateButton.setEnabled(true);
            setStatus(getString(
                    R.string.status_error, e.getMessage() == null ? "install" : e.getMessage()));
        }
    }

    private void setStatus(String text) {
        statusView.setText(text);
    }
}
