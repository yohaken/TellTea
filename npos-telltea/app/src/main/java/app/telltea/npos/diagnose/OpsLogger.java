package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Compact ops timeline → Cloud Function → back-office fold.
 * Prefer errors/warns + hardware outcomes; keep payloads small.
 */
public final class OpsLogger {
    public static final String REPORT_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/reportNposOpsLog";

    private static final String PREFS = "npos_ops";
    private static final Object LOCK = new Object();
    private static final List<JSONObject> QUEUE = new ArrayList<>();
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final long FLUSH_DELAY_MS = 800L;
    private static final int MAX_QUEUE = 40;

    private static Runnable pendingFlush;

    private OpsLogger() {}

    public static void info(Context context, String cat, String msg, String detail) {
        enqueue(context, "info", cat, msg, detail, null);
    }

    public static void warn(Context context, String cat, String msg, String detail) {
        enqueue(context, "warn", cat, msg, detail, null);
    }

    public static void error(Context context, String cat, String msg, String detail) {
        enqueue(context, "error", cat, msg, detail, false);
    }

    public static void result(
            Context context, String cat, String msg, String detail, boolean ok) {
        enqueue(context, ok ? "info" : "error", cat, msg, detail, ok);
    }

    public static void flushNow(Context context) {
        Context app = context.getApplicationContext();
        EXEC.execute(() -> flushSync(app));
    }

    private static void enqueue(
            Context context,
            String level,
            String cat,
            String msg,
            String detail,
            Boolean ok) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        try {
            JSONObject ev = new JSONObject();
            ev.put("at", System.currentTimeMillis());
            ev.put("level", level == null ? "info" : level);
            ev.put("cat", cat == null ? "app" : cat);
            ev.put("msg", truncate(msg, 160));
            ev.put("detail", truncate(detail == null ? "" : detail, 280));
            if (ok != null) ev.put("ok", ok.booleanValue());

            synchronized (LOCK) {
                QUEUE.add(ev);
                while (QUEUE.size() > MAX_QUEUE) QUEUE.remove(0);
            }
            scheduleFlush(app);
        } catch (Exception ignored) {
            /* never crash host UI for logging */
        }
    }

    private static void scheduleFlush(Context app) {
        synchronized (LOCK) {
            if (pendingFlush != null) MAIN.removeCallbacks(pendingFlush);
            pendingFlush = () -> EXEC.execute(() -> flushSync(app));
            MAIN.postDelayed(pendingFlush, FLUSH_DELAY_MS);
        }
    }

    private static void flushSync(Context app) {
        List<JSONObject> batch;
        synchronized (LOCK) {
            if (QUEUE.isEmpty()) return;
            batch = new ArrayList<>(QUEUE);
            QUEUE.clear();
        }
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("versionCode", readVersionCode(app));
            body.put("versionName", readVersionName(app));
            JSONArray events = new JSONArray();
            for (JSONObject e : batch) events.put(e);
            body.put("events", events);

            conn = (HttpURLConnection) new URL(REPORT_URL).openConnection();
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
            readAll(stream);
            if (code < 200 || code >= 300) {
                synchronized (LOCK) {
                    QUEUE.addAll(0, batch);
                    while (QUEUE.size() > MAX_QUEUE) QUEUE.remove(QUEUE.size() - 1);
                }
            } else {
                SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                prefs.edit().putLong("lastFlushAt", System.currentTimeMillis()).apply();
            }
        } catch (Exception e) {
            synchronized (LOCK) {
                QUEUE.addAll(0, batch);
                while (QUEUE.size() > MAX_QUEUE) QUEUE.remove(QUEUE.size() - 1);
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static int readVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static String readVersionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "0" : info.versionName;
        } catch (Exception ignored) {
            return "0";
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
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
