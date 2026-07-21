package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.WindowManager;

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
    public static final long MIN_INTERVAL_MS = 55_000L;

    public interface Callback {
        void onSuccess(String pairingCode, long lastSeenAt);

        void onError(Exception error);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicLong lastSentAt = new AtomicLong(0);

    public void heartbeat(Context context, boolean force, Callback callback) {
        long now = System.currentTimeMillis();
        if (!force && now - lastSentAt.get() < MIN_INTERVAL_MS) {
            if (callback != null) {
                callback.onSuccess(DeviceIdentity.pairingCode(context), lastSentAt.get());
            }
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = buildBody(context);
                conn = (HttpURLConnection) new URL(HEARTBEAT_URL).openConnection();
                conn.setConnectTimeout(12_000);
                conn.setReadTimeout(15_000);
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
                        res.optString("pairingCode", DeviceIdentity.pairingCode(context));
                long seen = res.optLong("lastSeenAt", System.currentTimeMillis());
                lastSentAt.set(seen);
                if (callback != null) callback.onSuccess(pairing, seen);
            } catch (Exception e) {
                if (callback != null) callback.onError(e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    private static JSONObject buildBody(Context context) throws Exception {
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
