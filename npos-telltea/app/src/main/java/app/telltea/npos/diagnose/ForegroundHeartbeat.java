package app.telltea.npos.diagnose;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import app.telltea.npos.update.UpdateCheckCoordinator;

/**
 * Keeps nPos visible as online in BO while any activity is in the foreground.
 * MainActivity alone used to heartbeat only on hub resume — SellActivity left
 * lastSeenAt stale so BO showed offline during active selling.
 *
 * <p>Tick always {@code force=true} so kick/revoke from BO applies within one interval
 * (throttle must not fake success without {@code applyFromServer}).
 *
 * <p>On success, also pulses {@link UpdateCheckCoordinator} so the sell-screen
 * BO countdown discovers APK updates without waiting for activity resume.
 */
public final class ForegroundHeartbeat {
    /** Fallback when prefs not warmed yet — BO can raise via meta/pos.heartbeatIntervalSec. */
    public static final long INTERVAL_MS = 5_000L;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final DeviceHeartbeat HEARTBEAT = new DeviceHeartbeat();
    private static Context app;
    private static int resumed;
    private static volatile String lastPairing = "";
    private static volatile long lastSeenAt;
    private static volatile String lastError = "";
    /** Wall-clock when the next tick is due (for staff countdown chip). */
    private static volatile long nextCheckAtMs;
    private static volatile long lastNetworkAtMs;
    private static volatile boolean inFlight;

    /** Link health for the sell chrome status dot. */
    public enum LinkStatus {
        OK,
        CHECKING,
        WARN,
        FAIL
    }

    public interface StatusListener {
        void onStatus(String pairingCode, long seenAt, String errorOrEmpty);
    }

    private static StatusListener listener;

    private static final Runnable TICK =
            new Runnable() {
                @Override
                public void run() {
                    if (resumed <= 0 || app == null) return;
                    inFlight = true;
                    // Always force: never skip applyFromServer (kick/hash).
                    HEARTBEAT.heartbeat(app, true, statusCallback);
                    scheduleNext();
                }
            };

    private static final DeviceHeartbeat.Callback statusCallback =
            new DeviceHeartbeat.Callback() {
                @Override
                public void onSuccess(String pairingCode, long seenAt) {
                    lastPairing = pairingCode == null ? "" : pairingCode;
                    lastSeenAt = seenAt;
                    lastNetworkAtMs = System.currentTimeMillis();
                    lastError = "";
                    inFlight = false;
                    notifyListener();
                    if (app != null) {
                        UpdateCheckCoordinator.onServerSyncPulse(app);
                    }
                }

                @Override
                public void onError(Exception error) {
                    lastError =
                            error == null || error.getMessage() == null
                                    ? "heartbeat_fail"
                                    : error.getMessage();
                    inFlight = false;
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
            inFlight = true;
            HEARTBEAT.heartbeat(app, true, statusCallback);
            scheduleNext();
        }
    }

    public static void onActivityPaused() {
        if (resumed > 0) resumed -= 1;
        if (resumed <= 0) {
            resumed = 0;
            MAIN.removeCallbacks(TICK);
            nextCheckAtMs = 0;
        }
    }

    public static void forceNow(Context context) {
        if (context != null) app = context.getApplicationContext();
        if (app == null) return;
        inFlight = true;
        HEARTBEAT.heartbeat(app, true, statusCallback);
        if (resumed > 0) {
            MAIN.removeCallbacks(TICK);
            scheduleNext();
        }
    }

    public static String lastPairingCode() {
        return lastPairing;
    }

    public static long lastSeenAt() {
        return lastSeenAt;
    }

    public static String lastError() {
        return lastError == null ? "" : lastError;
    }

    public static long nextCheckAtMs() {
        return nextCheckAtMs;
    }

    public static long lastNetworkAtMs() {
        return lastNetworkAtMs;
    }

    /** Seconds until next forced BO check (0 = due / in flight). */
    public static int secondsUntilNextCheck() {
        long next = nextCheckAtMs;
        if (next <= 0) return 0;
        long left = next - System.currentTimeMillis();
        if (left <= 0) return 0;
        return (int) Math.ceil(left / 1000.0);
    }

    /**
     * Green = linked recently · yellow = checking / soft stale · red = last check failed.
     */
    public static LinkStatus linkStatus() {
        String err = lastError();
        if (!err.isEmpty()) return LinkStatus.FAIL;
        if (inFlight || lastNetworkAtMs <= 0) return LinkStatus.CHECKING;
        long age = System.currentTimeMillis() - lastNetworkAtMs;
        long interval = currentIntervalMs();
        if (age > Math.max(25_000L, interval * 5)) return LinkStatus.WARN;
        if (age > interval * 2) return LinkStatus.CHECKING;
        return LinkStatus.OK;
    }

    /** Effective cadence — BO {@code heartbeatIntervalSec} via {@link OpsPulsePrefs}. */
    public static long currentIntervalMs() {
        if (app != null) return OpsPulsePrefs.heartbeatIntervalMs(app);
        return INTERVAL_MS;
    }

    private static void scheduleNext() {
        long interval = currentIntervalMs();
        nextCheckAtMs = System.currentTimeMillis() + interval;
        MAIN.postDelayed(TICK, interval);
    }

    private static void notifyListener() {
        StatusListener l = listener;
        if (l == null) return;
        MAIN.post(() -> l.onStatus(lastPairing, lastSeenAt, lastError));
    }
}
