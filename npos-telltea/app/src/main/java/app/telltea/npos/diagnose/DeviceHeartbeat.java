package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import app.telltea.npos.printer.PrinterPrefs;
import app.telltea.npos.printer.SunmiInnerPrinter;
import app.telltea.npos.sell.MenuSyncCoordinator;
import app.telltea.npos.shift.ShiftPrefs;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/** Registers / heartbeats this tablet into posDevices via Cloud Function. */
public final class DeviceHeartbeat {
    public static final String HEARTBEAT_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposDeviceHeartbeat";
    /** Soft throttle for non-forced callers only — never fake success (kick would lag). */
    public static final long MIN_INTERVAL_MS = 4_000L;

    public interface Callback {
        void onSuccess(String pairingCode, long lastSeenAt);

        void onError(Exception error);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicLong lastSentAt = new AtomicLong(0);

    public void heartbeat(Context context, boolean force, Callback callback) {
        long now = System.currentTimeMillis();
        if (!force && now - lastSentAt.get() < MIN_INTERVAL_MS) {
            // Do not call onSuccess — that used to skip applyFromServer and delay kicks ~1m.
            return;
        }
        Context app = context.getApplicationContext();
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = buildBody(app);
                conn = (HttpURLConnection) new URL(HEARTBEAT_URL).openConnection();
                conn.setConnectTimeout(6_000);
                conn.setReadTimeout(8_000);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
                int code = conn.getResponseCode();
                InputStream stream =
                        code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                String raw = readAll(stream);
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("HTTP " + code + (raw.isEmpty() ? "" : ": " + raw));
                }
                JSONObject res = new JSONObject(raw.isEmpty() ? "{}" : raw);
                String pairing =
                        res.optString("pairingCode", DeviceIdentity.pairingCode(app));
                long seen = res.optLong("lastSeenAt", System.currentTimeMillis());
                lastSentAt.set(seen);
                StoreClaimPrefs.applyFromServer(
                        app,
                        res.optBoolean("storeClaimRequired", false),
                        res.optBoolean("storeClaimed", false),
                        res.optBoolean("deviceBlocked", false),
                        res.optBoolean("storeClaimRejectDev", true),
                        res.optBoolean("seatHeldByMe", res.optBoolean("storeClaimed", false)),
                        res.optBoolean("seatTaken", false),
                        res.optBoolean("kicked", false),
                        res.optString("storeClaimCodeHash", ""),
                        res.optLong("storeClaimUpdatedAt", 0L));
                if (res.has("heartbeatIntervalSec")) {
                    OpsPulsePrefs.applyFromServer(app, res.optInt("heartbeatIntervalSec", 5));
                }
                if (res.has("menuVersion")) {
                    MenuSyncCoordinator.applyFromServer(app, res.optLong("menuVersion", 0L));
                }
                // Kick ≠ close: BO-closed round settles via sessionRemoteClosed (seat kept).
                if (res.optBoolean("sessionRemoteClosed", false)
                        && ShiftPrefs.isOpen(app)
                        && !res.optBoolean("kicked", false)) {
                    ShiftPrefs.applyRemoteSessionClosed(
                            app,
                            res.optString("sessionId", ShiftPrefs.sessionId(app)),
                            res.optString("sessionCloseSource", ""));
                }
                handleCaptureCommand(app, res);
                if (callback != null) callback.onSuccess(pairing, seen);
            } catch (Exception e) {
                if (callback != null) callback.onError(e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static void handleCaptureCommand(Context app, JSONObject res) {
        try {
            JSONObject capture = res.optJSONObject("capture");
            if (capture == null) return;
            int interval = capture.optInt("intervalMinutes", 0);
            CapturePrefs.setIntervalMinutes(app, interval);
            long requestAt = capture.optLong("requestAt", 0L);
            boolean due = capture.optBoolean("due", false);
            long lastAck = CapturePrefs.lastAckRequestAt(app);
            // Do NOT ack before upload succeeds — retry on next heartbeat if capture fails.
            if (requestAt > 0 && requestAt > lastAck) {
                ScreenCapture.requestCapture(app, requestAt, "manual");
                return;
            }
            if (due && interval > 0) {
                long now = System.currentTimeMillis();
                long last = CapturePrefs.lastCaptureAt(app);
                if (last <= 0 || now - last >= interval * 60_000L - 5_000L) {
                    ScreenCapture.requestCapture(app, now, "interval");
                }
            }
        } catch (Exception e) {
            OpsLogger.warn(
                    app,
                    "display",
                    "อ่านคำสั่งแคปไม่สำเร็จ",
                    e.getMessage() == null ? "" : e.getMessage());
        }
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    private static JSONObject buildBody(Context context) throws Exception {
        // Heal Sunmi ready flag so BO equipment ✓ catches up after a false markNotReady.
        try {
            SunmiInnerPrinter.autoSelectIfNeeded(context);
        } catch (RuntimeException ignored) {
            /* never block heartbeat */
        }
        int versionCode = 0;
        String versionName = "0";
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            versionName = info.versionName == null ? "0" : info.versionName;
            if (Build.VERSION.SDK_INT >= 28) {
                versionCode = (int) info.getLongVersionCode();
            } else {
                versionCode = info.versionCode;
            }
        } catch (Exception ignored) {
            /* defaults */
        }

        String hint = Build.MANUFACTURER + " " + Build.MODEL;
        String screen = "";
        try {
            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                DisplayMetrics dm = new DisplayMetrics();
                wm.getDefaultDisplay().getMetrics(dm);
                screen = dm.widthPixels + "x" + dm.heightPixels;
            }
        } catch (Exception ignored) {
            /* optional */
        }

        JSONObject body = new JSONObject();
        body.put("installId", DeviceIdentity.getOrCreateInstallId(context));
        body.put("versionCode", versionCode);
        body.put("versionName", versionName);
        body.put("deviceHint", hint.trim());
        body.put("screenSize", screen);
        body.put("stableKey", DeviceIdentity.stableKey(context));
        body.put("isEmulator", DeviceIdentity.isEmulator());
        body.put("deviceClass", DeviceIdentity.deviceClass());
        body.put("customerDisplay", DisplayProbe.customerDisplayStatus(context));
        boolean printerReady = PrinterPrefs.isReady(context);
        // Drawer shares the receipt printer endpoint (Sunmi openDrawer / ESC kick).
        body.put("printerReady", printerReady);
        body.put("drawerReady", printerReady);
        body.put("printerLabel", PrinterPrefs.label(context));
        body.put("permissionsOk", PermissionBootstrap.allCriticalGranted(context));
        body.put("permissionsStatus", PermissionBootstrap.statusLine(context));
        int[] outbox = app.telltea.npos.sell.SaleSync.outboxCounts(context);
        body.put("syncPendingCount", outbox[0]);
        body.put("syncFailedCount", outbox[1]);
        if (ShiftPrefs.isOpen(context)) {
            String sid = ShiftPrefs.sessionId(context);
            if (sid != null && !sid.isEmpty()) {
                body.put("sessionId", sid);
            }
        }
        return body;
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }
}
