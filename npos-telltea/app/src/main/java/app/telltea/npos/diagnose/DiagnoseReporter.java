package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Posts diagnose snapshots to Cloud Function → back-office nposDiagnose collection. */
public final class DiagnoseReporter {
    public static final String REPORT_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/reportNposDiagnose";

    public interface Callback {
        void onSuccess(String summary);

        void onError(Exception error);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public void report(
            Context context,
            List<DisplayProbe.DisplayInfo> displays,
            List<HardwareProbe.Item> hardware,
            Callback callback) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = buildBody(context, displays, hardware);
                conn = (HttpURLConnection) new URL(REPORT_URL).openConnection();
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(20_000);
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
                String summary = res.optString("summary", body.optString("summary"));
                callback.onSuccess(summary);
            } catch (Exception e) {
                callback.onError(e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    public static String getOrCreateInstallId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("npos_diagnose", Context.MODE_PRIVATE);
        String id = prefs.getString("installId", null);
        if (id != null && id.length() >= 8) return id;
        id = UUID.randomUUID().toString().replace("-", "");
        prefs.edit().putString("installId", id).apply();
        return id;
    }

    private static JSONObject buildBody(
            Context context,
            List<DisplayProbe.DisplayInfo> displays,
            List<HardwareProbe.Item> hardware)
            throws Exception {
        int versionCode = 0;
        String versionName = "0";
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            versionName = info.versionName == null ? "0" : info.versionName;
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                versionCode = (int) info.getLongVersionCode();
            } else {
                versionCode = info.versionCode;
            }
        } catch (Exception ignored) {
            /* keep defaults */
        }

        JSONArray displayArr = new JSONArray();
        if (displays != null) {
            for (DisplayProbe.DisplayInfo d : displays) {
                JSONObject o = new JSONObject();
                o.put("number", d.number);
                o.put("displayId", d.display.getDisplayId());
                o.put("primary", d.primary);
                o.put("name", d.name);
                displayArr.put(o);
            }
        }

        JSONArray hardwareArr = new JSONArray();
        if (hardware != null) {
            for (HardwareProbe.Item h : hardware) {
                JSONObject o = new JSONObject();
                o.put("category", h.category);
                o.put("title", h.title);
                o.put("detail", h.detail == null ? "" : h.detail);
                hardwareArr.put(o);
            }
        }

        String summary =
                "จอ "
                        + displayArr.length()
                        + " · เชื่อมต่อ "
                        + hardwareArr.length();

        JSONObject body = new JSONObject();
        body.put("installId", getOrCreateInstallId(context));
        body.put("versionCode", versionCode);
        body.put("versionName", versionName);
        body.put("summary", summary);
        body.put("displays", displayArr);
        body.put("hardware", hardwareArr);
        body.put("source", "npos-telltea");
        return body;
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }
}
