package app.telltea.npos.update;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Fetches and parses the remote update manifest on a background thread. */
public final class UpdateChecker {
    public interface Callback {
        void onResult(UpdateManifest manifest);

        void onError(Exception error);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public void check(String manifestUrl, Callback callback) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                String url = manifestUrl + (manifestUrl.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(12_000);
                conn.setReadTimeout(12_000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Cache-Control", "no-cache");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("HTTP " + code);
                }
                String body = readAll(conn.getInputStream());
                callback.onResult(UpdateManifest.fromJson(body));
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

    private static String readAll(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString();
    }
}
