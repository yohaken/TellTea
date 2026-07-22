package app.telltea.npos.diagnose;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

/**
 * Keeps nPos visible as online in BO while any activity is in the foreground.
 * MainActivity alone used to heartbeat only on hub resume — SellActivity left
 * lastSeenAt stale so BO showed offline during active selling.
 */
public final class ForegroundHeartbeat {
    public static final long INTERVAL_MS = 50_000L;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final DeviceHeartbeat HEARTBEAT = new DeviceHeartbeat();
    private static Context app;
    private static int resumed;
    private static volatile String lastPairing = "";
    private static volatile long lastSeenAt;
    private static volatile String lastError = "";

    public interface StatusListener {
        void onStatus(String pairingCode, long seenAt, String errorOrEmpty);
    }

    private static StatusListener listener;

    private static final Runnable TICK =
            new Runnable() {
                @Override
                public void run() {
                    if (resumed <= 0 || app == null) return;
                    HEARTBEAT.heartbeat(app, false, statusCallback);
                    MAIN.postDelayed(this, INTERVAL_MS);
                }
            };

    private static final DeviceHeartbeat.Callback statusCallback =
            new DeviceHeartbeat.Callback() {
                @Override
                public void onSuccess(String pairingCode, long seenAt) {
                    lastPairing = pairingCode == null ? "" : pairingCode;
                    lastSeenAt = seenAt;
                    lastError = "";
                    notifyListener();
                }

                @Override
                public void onError(Exception error) {
                    lastError =
                            error == null || error.getMessage() == null
                                    ? "heartbeat_fail"
                                    : error.getMessage();
                    notifyListener();
                }
            };

    private ForegroundHeartbeat() {}

    public static void setStatusListener(StatusListener l) {
        listener = l;
        notifyListener();
    }

    public static void onActivityResumed(Context context) {
        if (context == null) return;
        app = context.getApplicationContext();
        resumed += 1;
        if (resumed == 1) {
            MAIN.removeCallbacks(TICK);
            HEARTBEAT.heartbeat(app, true, statusCallback);
            MAIN.postDelayed(TICK, INTERVAL_MS);
        }
    }

    public static void onActivityPaused() {
        if (resumed > 0) resumed -= 1;
        if (resumed <= 0) {
            resumed = 0;
            MAIN.removeCallbacks(TICK);
        }
    }

    public static void forceNow(Context context) {
        if (context != null) app = context.getApplicationContext();
        if (app == null) return;
        HEARTBEAT.heartbeat(app, true, statusCallback);
    }

    public static String lastPairingCode() {
        return lastPairing;
    }

    public static long lastSeenAt() {
        return lastSeenAt;
    }

    private static void notifyListener() {
        StatusListener l = listener;
        if (l == null) return;
        MAIN.post(() -> l.onStatus(lastPairing, lastSeenAt, lastError));
    }
}
