package app.telltea.npos.sell;

import android.content.Context;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import app.telltea.npos.diagnose.DeviceIdentity;

/** Admin-bridged member lookup / quick create — never on the local sale-save path. */
public final class MemberApi {
  private static final String LOOKUP_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposMemberLookup";
  private static final String CREATE_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposMemberQuickCreate";

  private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

  public interface Callback {
    void onResult(JSONObject res);

    void onError(String message);
  }

  private MemberApi() {}

  public static void lookup(Context context, String phone, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("phone", phone == null ? "" : phone.trim());
            JSONObject res = postJson(LOOKUP_URL, body);
            if (callback != null) callback.onResult(res);
          } catch (Exception e) {
            if (callback != null) callback.onError(e.getMessage() == null ? "lookup_failed" : e.getMessage());
          }
        });
  }

  public static void quickCreate(Context context, String phone, String displayName, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("phone", phone == null ? "" : phone.trim());
            body.put("displayName", displayName == null ? "" : displayName.trim());
            JSONObject res = postJson(CREATE_URL, body);
            if (callback != null) callback.onResult(res);
          } catch (Exception e) {
            if (callback != null) callback.onError(e.getMessage() == null ? "create_failed" : e.getMessage());
          }
        });
  }

  private static JSONObject postJson(String urlStr, JSONObject body) throws Exception {
    HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
    conn.setConnectTimeout(8_000);
    conn.setReadTimeout(12_000);
    conn.setRequestMethod("POST");
    conn.setDoOutput(true);
    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
    conn.setFixedLengthStreamingMode(bytes.length);
    try (OutputStream os = conn.getOutputStream()) {
      os.write(bytes);
    }
    int code = conn.getResponseCode();
    BufferedReader reader =
        new BufferedReader(
            new InputStreamReader(
                code >= 400 ? conn.getErrorStream() : conn.getInputStream(),
                StandardCharsets.UTF_8));
    StringBuilder sb = new StringBuilder();
    String line;
    while ((line = reader.readLine()) != null) sb.append(line);
    reader.close();
    conn.disconnect();
    return new JSONObject(sb.toString());
  }
}
