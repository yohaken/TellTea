package app.telltea.npos.diagnose;

import android.content.Context;

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

/** POST store code to nposClaimDevice (half-login). */
public final class StoreClaimClient {
  public static final String CLAIM_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposClaimDevice";

  public interface Callback {
    void onSuccess();

    void onError(String message);
  }

  private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

  private StoreClaimClient() {}

  public static void claim(Context context, String storeCode, Callback callback) {
    Context app = context.getApplicationContext();
    String code = storeCode == null ? "" : storeCode.trim().toUpperCase().replaceAll("[\\s\\-]", "");
    EXEC.execute(
        () -> {
          HttpURLConnection conn = null;
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("storeCode", code);
            conn = (HttpURLConnection) new URL(CLAIM_URL).openConnection();
            conn.setConnectTimeout(12_000);
            conn.setReadTimeout(15_000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
              out.write(bytes);
            }
            int http = conn.getResponseCode();
            InputStream stream =
                http >= 200 && http < 300 ? conn.getInputStream() : conn.getErrorStream();
            String raw = readAll(stream);
            JSONObject res = new JSONObject(raw.isEmpty() ? "{}" : raw);
            if (http >= 200 && http < 300 && res.optBoolean("ok", false)) {
              StoreClaimPrefs.markClaimed(app);
              if (callback != null) callback.onSuccess();
              return;
            }
            String err = res.optString("error", "claim_failed");
            if (callback != null) callback.onError(err);
          } catch (Exception e) {
            if (callback != null) {
              callback.onError(e.getMessage() == null ? "claim_failed" : e.getMessage());
            }
          } finally {
            if (conn != null) conn.disconnect();
          }
        });
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
