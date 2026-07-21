package app.telltea.npos;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

import app.telltea.npos.diagnose.DisplayProbe;
import app.telltea.npos.diagnose.HardwareProbe;
import app.telltea.npos.diagnose.NumberPresentation;

/**
 * Hardware + multi-display diagnostics.
 * Shows numbered screens and lists USB / Bluetooth / network endpoints.
 */
public class DiagnoseActivity extends Activity {
    private static final int REQ_BT = 4401;

    private LinearLayout displayList;
    private TextView hardwareList;
    private TextView diagnoseStatus;
    private final List<NumberPresentation> openPresentations = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_diagnose);

        displayList = findViewById(R.id.displayList);
        hardwareList = findViewById(R.id.hardwareList);
        diagnoseStatus = findViewById(R.id.diagnoseStatus);

        findViewById(R.id.refreshButton).setOnClickListener(v -> refreshAll(true));
        refreshAll(true);
    }

    @Override
    protected void onDestroy() {
        dismissPresentations();
        super.onDestroy();
    }

    private void refreshAll(boolean requestBtIfNeeded) {
        renderDisplays();
        HardwareProbe.Result hw = HardwareProbe.scan(this);
        renderHardware(hw);
        if (requestBtIfNeeded && hw.bluetoothPermissionNeeded) {
            requestBluetoothPermission();
        }
        diagnoseStatus.setText(
                "พบจอ "
                        + displayList.getChildCount()
                        + " จอ · รายการเชื่อมต่อ "
                        + hw.items.size()
                        + " รายการ");
    }

    private void renderDisplays() {
        displayList.removeAllViews();
        List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(this);
        if (displays.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.diagnose_no_displays);
            empty.setTextColor(0xFF666666);
            displayList.addView(empty);
            return;
        }

        for (DisplayProbe.DisplayInfo info : displays) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(0, 0, 0, dp(12));

            String role =
                    info.primary
                            ? getString(R.string.diagnose_display_primary)
                            : getString(R.string.diagnose_display_secondary);
            TextView title = new TextView(this);
            title.setText(getString(R.string.diagnose_display_row, info.number, info.name));
            title.setTextColor(0xFF1A2E24);
            title.setTextSize(16f);
            title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);

            TextView meta = new TextView(this);
            meta.setText(role + " · id=" + info.display.getDisplayId());
            meta.setTextColor(0xFF666666);
            meta.setTextSize(13f);

            Button show = new Button(this);
            show.setText(getString(R.string.diagnose_show_on_display, info.number));
            show.setAllCaps(false);
            show.setOnClickListener(v -> showNumberOnDisplay(info));

            row.addView(title);
            row.addView(meta);
            row.addView(show);
            displayList.addView(row);
        }
    }

    private void renderHardware(HardwareProbe.Result result) {
        if (result.items.isEmpty()) {
            hardwareList.setText(R.string.diagnose_no_devices);
            return;
        }
        StringBuilder sb = new StringBuilder();
        String lastCat = "";
        for (HardwareProbe.Item item : result.items) {
            if (!item.category.equals(lastCat)) {
                if (sb.length() > 0) sb.append("\n");
                sb.append("[").append(item.category).append("]\n");
                lastCat = item.category;
            }
            sb.append("• ").append(item.title);
            if (item.detail != null && !item.detail.isEmpty()) {
                sb.append("\n  ").append(item.detail);
            }
            sb.append("\n");
        }
        if (result.bluetoothPermissionNeeded) {
            sb.append("\n").append(getString(R.string.diagnose_bt_need_permission));
        }
        hardwareList.setText(sb.toString().trim());
    }

    private void showNumberOnDisplay(DisplayProbe.DisplayInfo info) {
        try {
            dismissPresentations();
            String label =
                    info.primary
                            ? getString(R.string.diagnose_display_primary)
                            : getString(R.string.diagnose_display_secondary);
            // Presentation on the default display can look odd; still useful for numbering proof.
            NumberPresentation presentation =
                    new NumberPresentation(this, info.display, info.number, "จอ " + info.number + " · " + label);
            presentation.setOnDismissListener(d -> openPresentations.remove(presentation));
            presentation.show();
            openPresentations.add(presentation);
            diagnoseStatus.setText(getString(R.string.diagnose_showing, info.number));
            Toast.makeText(this, getString(R.string.diagnose_showing, info.number), Toast.LENGTH_SHORT)
                    .show();
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            diagnoseStatus.setText(getString(R.string.diagnose_show_failed, msg));
            Toast.makeText(this, getString(R.string.diagnose_show_failed, msg), Toast.LENGTH_LONG).show();
        }
    }

    private void dismissPresentations() {
        for (NumberPresentation p : new ArrayList<>(openPresentations)) {
            try {
                p.dismiss();
            } catch (Exception ignored) {
                /* already gone */
            }
        }
        openPresentations.clear();
    }

    private void requestBluetoothPermission() {
        if (Build.VERSION.SDK_INT < 31) return;
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        requestPermissions(new String[] {Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_BT) {
            refreshAll(false);
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}
