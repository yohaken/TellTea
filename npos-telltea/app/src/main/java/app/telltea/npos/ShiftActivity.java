package app.telltea.npos;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import app.telltea.npos.sell.SaleSync;
import app.telltea.npos.shift.BlindCloseFlow;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposFonts;
import app.telltea.npos.ui.NposUi;

/**
 * Native shift screen — clone web /pos/shift/ essentials: summary, X-report, close.
 */
public class ShiftActivity extends Activity {
  private final SaleSync saleSync = new SaleSync();
  private TextView summaryView;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout root = NposUi.pageColumn(this);
    root.addView(NposUi.headerBar(this, getString(R.string.nav_shift)));

    summaryView = NposUi.body(this, "");
    summaryView.setTextColor(NposUi.color(this, R.color.npos_ink));
    summaryView.setTypeface(NposFonts.medium(this));
    summaryView.setPadding(0, NposUi.dp(this, 16), 0, NposUi.dp(this, 16));
    root.addView(summaryView);

    TextView x = NposUi.secondary(this, getString(R.string.btn_x_report));
    x.setLayoutParams(NposUi.matchWidth(this, 10));
    x.setOnClickListener(
        v -> {
          Toast.makeText(this, R.string.sell_printing_x, Toast.LENGTH_SHORT).show();
          saleSync.printShiftReport(
              this,
              "snapshot",
              () ->
                  runOnUiThread(
                      () -> Toast.makeText(this, R.string.sell_x_printed, Toast.LENGTH_SHORT).show()));
        });
    root.addView(x);

    TextView z = NposUi.primary(this, getString(R.string.btn_close_shift));
    z.setLayoutParams(NposUi.matchWidth(this, 0));
    z.setOnClickListener(v -> closeShift());
    root.addView(z);

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(NposUi.color(this, R.color.npos_bg));
    scroll.addView(root);
    setContentView(scroll);
    NposFonts.applyActivity(this);
    refreshSummary();
  }

  private void refreshSummary() {
    summaryView.setText(ShiftPrefs.summaryLine(this));
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
