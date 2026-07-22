package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.update.ApkInstaller;

/**
 * Native shift screen — clone web /pos/shift/ essentials: summary, X-report, close.
 */
public class ShiftActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private TextView summaryView;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(20, 20, 20, 20);
    root.setBackgroundColor(0xFFF7F7F5);

    LinearLayout top = new LinearLayout(this);
    top.setOrientation(LinearLayout.HORIZONTAL);
    Button back = new Button(this);
    back.setText(R.string.btn_back);
    back.setAllCaps(false);
    back.setOnClickListener(v -> finish());
    top.addView(back);
    TextView title = new TextView(this);
    title.setText(R.string.nav_shift);
    title.setTextSize(20);
    title.setTextColor(0xFF1A2E24);
    title.setPadding(16, 12, 0, 0);
    top.addView(title);
    root.addView(top);

    summaryView = new TextView(this);
    summaryView.setTextSize(15);
    summaryView.setTextColor(0xFF333333);
    summaryView.setPadding(0, 20, 0, 16);
    root.addView(summaryView);

    Button x = new Button(this);
    x.setAllCaps(false);
    x.setText(R.string.btn_x_report);
    x.setOnClickListener(
        v -> {
          Toast.makeText(this, R.string.sell_printing_x, Toast.LENGTH_SHORT).show();
          saleSync.printShiftReport(
              this,
              "snapshot",
              () -> runOnUiThread(() -> Toast.makeText(this, R.string.sell_x_printed, Toast.LENGTH_SHORT).show()));
        });
    root.addView(x);

    Button z = new Button(this);
    z.setAllCaps(false);
    z.setText(R.string.btn_close_shift);
    z.setOnClickListener(v -> closeShift());
    root.addView(z);

    Button web = new Button(this);
    web.setAllCaps(false);
    web.setText(R.string.btn_open_web_shift);
    web.setOnClickListener(v -> openWeb("https://telltea-pos.web.app/pos/shift/"));
    root.addView(web);

    setContentView(root);
    refreshSummary();
  }

  private void refreshSummary() {
    summaryView.setText(
        getString(
            R.string.shift_summary_fmt,
            ShiftPrefs.saleCount(this),
            ShiftPrefs.cashTotal(this),
            ShiftPrefs.promptpayTotal(this),
            ShiftPrefs.voidedCount(this)));
  }

  private void closeShift() {
    BlindCloseFlow.start(
        this,
        saleSync,
        () -> {
          Intent i = new Intent(this, MainActivity.class);
          i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
          startActivity(i);
          finish();
        });
  }

  private void openWeb(String url) {
    try {
      ApkInstaller.openInstallPage(this, url);
    } catch (Exception e) {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    refreshSummary();
  }

  @Override
  protected void onDestroy() {
    saleSync.shutdown();
    super.onDestroy();
  }
}
