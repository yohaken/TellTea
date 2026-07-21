package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Background light diagnose → back-office. Staff never taps this.
 * Min interval ~6h (or force on first boot after install).
 */
public final class AutoHealth {
    private static final String PREFS = "npos_auto_health";
    private static final String KEY_LAST_AT = "lastDiagnoseAt";
    public static final long MIN_INTERVAL_MS = 6L * 60L * 60L * 1000L;

    public interface Callback {
        void onDone(boolean sent, String summaryOrError);
    }

    private final DiagnoseReporter reporter = new DiagnoseReporter();

    public void maybeRun(Context context, boolean force, Callback callback) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long last = prefs.getLong(KEY_LAST_AT, 0L);
        long now = System.currentTimeMillis();
        if (!force && last > 0 && now - last < MIN_INTERVAL_MS) {
            if (callback != null) callback.onDone(false, "skip");
            return;
        }

        try {
            java.util.List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(app);
            HardwareProbe.Result hw = HardwareProbe.scan(app);
            reporter.report(
                    app,
                    displays,
                    hw.items,
                    new DiagnoseReporter.Callback() {
                        @Override
                        public void onSuccess(String summary) {
                            prefs.edit().putLong(KEY_LAST_AT, System.currentTimeMillis()).apply();
                            OpsLogger.info(app, "hardware", "สแกนอัตโนมัติแล้ว", summary);
                            if (callback != null) callback.onDone(true, summary);
                        }

                        @Override
                        public void onError(Exception error) {
                            String msg =
                                    error.getMessage() == null
                                            ? error.getClass().getSimpleName()
                                            : error.getMessage();
                            OpsLogger.error(app, "hardware", "สแกนอัตโนมัติไม่สำเร็จ", msg);
                            if (callback != null) callback.onDone(false, msg);
                        }
                    });
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            OpsLogger.error(app, "hardware", "สแกนอัตโนมัติพัง", msg);
            if (callback != null) callback.onDone(false, msg);
        }
    }

    public void shutdown() {
        reporter.shutdown();
    }
}
