package app.telltea.npos;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import app.telltea.npos.diagnose.CustomerAmountPresentation;
import app.telltea.npos.diagnose.DisplayProbe;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.printer.EscPos;
import app.telltea.npos.printer.PrinterEndpoint;
import app.telltea.npos.printer.PrinterPrefs;
import app.telltea.npos.printer.PrinterTransport;
import app.telltea.npos.update.ApkInstaller;
import app.telltea.npos.update.UpdateChecker;
import app.telltea.npos.update.UpdateConfig;
import app.telltea.npos.update.UpdateDownloader;
import app.telltea.npos.update.UpdateManifest;

/**
 * Settings: update, diagnose, customer display (N3), printer (N4), drawer (N5).
 */
public class SettingsActivity extends Activity {
    private static final int REQ_BT = 4501;

    private TextView settingsVersion;
    private TextView statusView;
    private TextView bannerView;
    private TextView customerStatus;
    private TextView printerStatus;
    private Button updateButton;
    private Button printerTestButton;
    private Button drawerKickButton;

    private UpdateChecker checker;
    private UpdateDownloader downloader;
    private UpdateManifest pendingManifest;
    private CustomerAmountPresentation customerPresentation;
    private PrinterTransport printerTransport;
    private final List<PrinterEndpoint> printerEndpoints = new ArrayList<>();
    private int printerIndex;
    private boolean busy;
    private boolean printerBusy;
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
        printerStatus = findViewById(R.id.printerStatus);
        updateButton = findViewById(R.id.updateButton);
        printerTestButton = findViewById(R.id.printerTestButton);
        drawerKickButton = findViewById(R.id.drawerKickButton);

        readLocalVersion();
        settingsVersion.setText(
                getString(R.string.version_label, localVersionName, localVersionCode));

        checker = new UpdateChecker();
        downloader = new UpdateDownloader();
        printerTransport = new PrinterTransport();

        updateButton.setOnClickListener(v -> onUpdateButtonClicked());
        findViewById(R.id.installPageButton).setOnClickListener(v -> openInstallPage());
        findViewById(R.id.openMenuAdminButton).setOnClickListener(v -> openMenuAdminPage());
        findViewById(R.id.diagnoseButton)
                .setOnClickListener(v -> startActivity(new Intent(this, DiagnoseActivity.class)));
        findViewById(R.id.customerAmount1Button)
                .setOnClickListener(v -> showCustomerAmount(120));
        findViewById(R.id.customerAmount2Button)
                .setOnClickListener(v -> showCustomerAmount(350));
        findViewById(R.id.customerCloseButton).setOnClickListener(v -> closeCustomerDisplay());
        findViewById(R.id.printerScanButton).setOnClickListener(v -> scanPrinters(true));
        findViewById(R.id.printerNextButton).setOnClickListener(v -> selectNextPrinter());
        printerTestButton.setOnClickListener(v -> runPrinterTest());
        drawerKickButton.setOnClickListener(v -> runDrawerKick());
        findViewById(R.id.printerLanAddButton).setOnClickListener(v -> addLanPrinter());

        restorePrinterSelection();
        OpsLogger.info(this, "app", "เปิดตั้งค่า", "vc=" + localVersionCode);
    }

    private void addLanPrinter() {
        EditText hostView = findViewById(R.id.printerLanHost);
        EditText portView = findViewById(R.id.printerLanPort);
        String host = hostView.getText() == null ? "" : hostView.getText().toString().trim();
        int port = 9100;
        try {
            port = Integer.parseInt(portView.getText().toString().trim());
        } catch (Exception ignored) {
            port = 9100;
        }
        if (host.isEmpty()) {
            Toast.makeText(this, R.string.printer_lan_need_host, Toast.LENGTH_SHORT).show();
            return;
        }
        PrinterEndpoint lan = PrinterEndpoint.network(host, port);
        for (int i = printerEndpoints.size() - 1; i >= 0; i--) {
            if (lan.id.equals(printerEndpoints.get(i).id)) printerEndpoints.remove(i);
        }
        printerEndpoints.add(0, lan);
        printerIndex = 0;
        PrinterPrefs.saveSuccess(this, lan);
        renderPrinterStatus();
        Toast.makeText(this, getString(R.string.printer_lan_added, lan.label), Toast.LENGTH_SHORT).show();
        OpsLogger.info(this, "printer", "เพิ่มปริ้น LAN", lan.id);
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
        if (printerTransport != null) printerTransport.shutdown();
        OpsLogger.flushNow(this);
        super.onDestroy();
    }

    private void openInstallPage() {
        String url =
                BuildConfig.INSTALL_PAGE_URL == null || BuildConfig.INSTALL_PAGE_URL.isEmpty()
                        ? "https://telltea-pos.web.app/install/"
                        : BuildConfig.INSTALL_PAGE_URL;
        ApkInstaller.openInstallPage(this, url);
    }

    private void openMenuAdminPage() {
        ApkInstaller.openInstallPage(this, "https://telltea-pos.web.app/pos/menu/");
    }

    private void showCustomerAmount(int baht) {
        try {
            closeCustomerDisplay();
            List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(this);
            DisplayProbe.DisplayInfo target = pickCustomerDisplay(displays);
            if (target == null) {
                customerStatus.setText(R.string.customer_test_no_display);
                OpsLogger.error(this, "display", "ไม่พบจอสำหรับแสดงยอด", "baht=" + baht);
                Toast.makeText(this, R.string.customer_test_no_display, Toast.LENGTH_LONG).show();
                return;
            }
            String amount = String.format(Locale.US, "฿%,d.00", baht);
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
            OpsLogger.result(
                    this,
                    "display",
                    "แสดงยอดบนจอ " + target.number,
                    amount + " · primary=" + target.primary + " · id=" + target.display.getDisplayId(),
                    true);
            Toast.makeText(this, customerStatus.getText(), Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            customerStatus.setText(R.string.customer_test_fail);
            OpsLogger.error(this, "display", "การแสดงบนจอไม่สำเร็จ", msg);
            Toast.makeText(this, customerStatus.getText(), Toast.LENGTH_LONG).show();
        }
    }

    private static DisplayProbe.DisplayInfo pickCustomerDisplay(
            List<DisplayProbe.DisplayInfo> displays) {
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

    private void restorePrinterSelection() {
        scanPrinters(false);
        PrinterEndpoint saved = PrinterPrefs.savedOrNull(this);
        if (saved != null) {
            boolean found = false;
            for (int i = 0; i < printerEndpoints.size(); i++) {
                if (saved.id.equals(printerEndpoints.get(i).id)) {
                    printerIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found && saved.kind == PrinterEndpoint.Kind.NETWORK) {
                printerEndpoints.add(0, saved);
                printerIndex = 0;
            }
        }
        renderPrinterStatus();
    }

    private void scanPrinters(boolean requestBt) {
        if (requestBt && needsBtPermission()) {
            requestPermissions(new String[] {Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT);
        }
        PrinterEndpoint keepLan = null;
        for (PrinterEndpoint ep : printerEndpoints) {
            if (ep.kind == PrinterEndpoint.Kind.NETWORK) {
                keepLan = ep;
                break;
            }
        }
        if (keepLan == null) {
            PrinterEndpoint saved = PrinterPrefs.savedOrNull(this);
            if (saved != null && saved.kind == PrinterEndpoint.Kind.NETWORK) keepLan = saved;
        }
        printerEndpoints.clear();
        if (keepLan != null) printerEndpoints.add(keepLan);
        printerEndpoints.addAll(PrinterEndpoint.discover(this));
        if (printerIndex >= printerEndpoints.size()) printerIndex = 0;
        renderPrinterStatus();
        OpsLogger.info(
                this,
                "hardware",
                "สแกนปริ้นเตอร์",
                "พบ " + printerEndpoints.size() + " ปลายทาง");
        if (requestBt) {
            Toast.makeText(
                            this,
                            getString(R.string.printer_scan_done, printerEndpoints.size()),
                            Toast.LENGTH_SHORT)
                    .show();
        }
    }

    private void selectNextPrinter() {
        if (printerEndpoints.isEmpty()) {
            scanPrinters(true);
            return;
        }
        printerIndex = (printerIndex + 1) % printerEndpoints.size();
        renderPrinterStatus();
    }

    private void renderPrinterStatus() {
        if (printerEndpoints.isEmpty()) {
            String saved = PrinterPrefs.label(this);
            if (PrinterPrefs.isReady(this) && saved != null && !saved.isEmpty()) {
                printerStatus.setText(getString(R.string.printer_saved_offline, saved));
            } else {
                printerStatus.setText(R.string.printer_none);
            }
            return;
        }
        PrinterEndpoint ep = printerEndpoints.get(printerIndex);
        printerStatus.setText(
                getString(
                        R.string.printer_selected,
                        printerIndex + 1,
                        printerEndpoints.size(),
                        ep.displayLine()));
    }

    private PrinterEndpoint currentEndpointOrNull() {
        if (printerEndpoints.isEmpty()) return PrinterPrefs.savedOrNull(this);
        return printerEndpoints.get(printerIndex);
    }

    private void runPrinterTest() {
        if (printerBusy) return;
        PrinterEndpoint ep = currentEndpointOrNull();
        if (ep == null) {
            printerStatus.setText(R.string.printer_none);
            OpsLogger.warn(this, "printer", "ยังไม่เลือกปริ้นเตอร์", "scan empty");
            Toast.makeText(this, R.string.printer_none, Toast.LENGTH_LONG).show();
            return;
        }
        printerBusy = true;
        setPrinterButtonsEnabled(false);
        printerStatus.setText(getString(R.string.printer_sending, ep.label));
        byte[] payload = EscPos.testReceipt(localVersionName, localVersionCode, ep.label);
        printerTransport.send(
                this,
                ep,
                payload,
                result ->
                        runOnUiThread(
                                () -> {
                                    printerBusy = false;
                                    setPrinterButtonsEnabled(true);
                                    if (result.ok) {
                                        PrinterPrefs.saveSuccess(this, ep);
                                        printerStatus.setText(
                                                getString(R.string.printer_ok, ep.label));
                                        OpsLogger.result(
                                                this,
                                                "printer",
                                                "พิมพ์ทดสอบสำเร็จ",
                                                ep.displayLine() + " · " + result.message,
                                                true);
                                    } else {
                                        PrinterPrefs.markNotReady(this);
                                        printerStatus.setText(R.string.printer_fail);
                                        OpsLogger.error(
                                                this,
                                                "printer",
                                                "พิมพ์ทดสอบไม่สำเร็จ",
                                                ep.displayLine() + " · " + result.message);
                                    }
                                    Toast.makeText(this, printerStatus.getText(), Toast.LENGTH_LONG)
                                            .show();
                                }));
    }

    private void runDrawerKick() {
        if (printerBusy) return;
        PrinterEndpoint ep = currentEndpointOrNull();
        if (ep == null) {
            printerStatus.setText(R.string.printer_none);
            OpsLogger.warn(this, "drawer", "ยังไม่เลือกปริ้นเตอร์สำหรับลิ้นชัก", "");
            Toast.makeText(this, R.string.printer_none, Toast.LENGTH_LONG).show();
            return;
        }
        printerBusy = true;
        setPrinterButtonsEnabled(false);
        printerStatus.setText(getString(R.string.drawer_sending, ep.label));
        printerTransport.send(
                this,
                ep,
                EscPos.drawerKick(),
                result ->
                        runOnUiThread(
                                () -> {
                                    printerBusy = false;
                                    setPrinterButtonsEnabled(true);
                                    if (result.ok) {
                                        PrinterPrefs.saveSuccess(this, ep);
                                        printerStatus.setText(
                                                getString(R.string.drawer_ok, ep.label));
                                        OpsLogger.result(
                                                this,
                                                "drawer",
                                                "สั่งเปิดลิ้นชักแล้ว",
                                                ep.displayLine() + " · " + result.message,
                                                true);
                                    } else {
                                        printerStatus.setText(R.string.drawer_fail);
                                        OpsLogger.error(
                                                this,
                                                "drawer",
                                                "เปิดลิ้นชักไม่สำเร็จ",
                                                ep.displayLine() + " · " + result.message);
                                    }
                                    Toast.makeText(this, printerStatus.getText(), Toast.LENGTH_LONG)
                                            .show();
                                }));
    }

    private void setPrinterButtonsEnabled(boolean enabled) {
        printerTestButton.setEnabled(enabled);
        drawerKickButton.setEnabled(enabled);
        findViewById(R.id.printerScanButton).setEnabled(enabled);
        findViewById(R.id.printerNextButton).setEnabled(enabled);
    }

    private boolean needsBtPermission() {
        return Build.VERSION.SDK_INT >= 31
                && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                        != PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_BT) {
            scanPrinters(false);
        }
    }

    private void readLocalVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            localVersionName = info.versionName == null ? "1.0" : info.versionName;
            if (Build.VERSION.SDK_INT >= 28) {
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
                        runOnUiThread(() -> applyManifest(manifest));
                    }

                    @Override
                    public void onError(Exception error) {
                        runOnUiThread(
                                () -> {
                                    busy = false;
                                    updateButton.setEnabled(true);
                                    pendingManifest = null;
                                    bannerView.setVisibility(View.GONE);
                                    updateButton.setText(R.string.btn_check_update);
                                    String msg =
                                            error.getMessage() == null
                                                    ? "network"
                                                    : error.getMessage();
                                    setStatus(getString(R.string.status_error, msg));
                                    OpsLogger.error(SettingsActivity.this, "update", "เช็คอัปเดตไม่สำเร็จ", msg);
                                });
                    }
                });
    }

    private void applyManifest(UpdateManifest manifest) {
        busy = false;
        updateButton.setEnabled(true);
        if (manifest.isNewerThan(localVersionCode)) {
            pendingManifest = manifest;
            bannerView.setVisibility(View.VISIBLE);
            updateButton.setText(R.string.btn_install_update);
            setStatus(
                    getString(
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
                        runOnUiThread(
                                () -> {
                                    busy = false;
                                    updateButton.setEnabled(true);
                                    String msg =
                                            error.getMessage() == null
                                                    ? "download"
                                                    : error.getMessage();
                                    setStatus(getString(R.string.status_error, msg));
                                    OpsLogger.error(
                                            SettingsActivity.this, "update", "ดาวน์โหลดอัปเดตไม่สำเร็จ", msg);
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
            OpsLogger.info(this, "update", "เปิดตัวติดตั้ง APK", apkFile.getName());
        } catch (Exception e) {
            busy = false;
            updateButton.setEnabled(true);
            String msg = e.getMessage() == null ? "install" : e.getMessage();
            setStatus(getString(R.string.status_error, msg));
            statusView.append("\n" + getString(R.string.status_signature_hint));
            OpsLogger.error(this, "update", "ติดตั้งอัปเดตไม่สำเร็จ", msg);
        }
    }

    private void setStatus(String text) {
        statusView.setText(text);
    }
}
