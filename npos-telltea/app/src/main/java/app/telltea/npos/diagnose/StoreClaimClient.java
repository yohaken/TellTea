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

/**
 * Store-code claim — local-first when heartbeat cached the code hash:
 * verify instantly → unlock UI → assign seat on server in background.
 */
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
    String code = StoreClaimCrypto.normalize(storeCode);
    if (!StoreClaimCrypto.isValidShape(code)) {
      if (callback != null) callback.onError("รหัสร้านไม่ถูกต้อง");
      return;
    }
    StoreClaimPrefs.rememberStoreCode(app, code);

    // Local-first: hash already warmed from heartbeat / shop settings.
    if (StoreClaimCrypto.matchesCachedHash(code, StoreClaimPrefs.cachedCodeHash(app))) {
      if (StoreClaimPrefs.isBlocked(app)) {
        if (callback != null) callback.onError("เครื่องนี้ถูกบล็อกจากหลังบ้าน");
        return;
      }
      if (StoreClaimPrefs.rejectDev(app) && DeviceIdentity.isEmulator()) {
        if (callback != null) {
          callback.onError("เครื่องจำลองถูกปิดกั้น — ปิด reject-dev หลังบ้าน หรือใช้แท็บเล็ตจริง");
        }
        return;
      }
      if (StoreClaimPrefs.isSeatTaken(app) && !StoreClaimPrefs.isSeatHeld(app)) {
        if (callback != null) {
          callback.onError("มีเครื่องอื่นใช้อยู่ — หลังบ้านกดเตะ / เคลียร์ seat ก่อน");
        }
        return;
      }
      StoreClaimPrefs.markClaimed(app, true, code);
      if (callback != null) callback.onSuccess();
      EXEC.execute(() -> syncClaimToServer(app));
      return;
    }

    EXEC.execute(
        () -> {
          try {
            JSONObject res = postClaim(app, code, 4_000, 6_000);
            handleServerResult(app, res, callback);
          } catch (Exception e) {
            try {
              JSONObject res = postClaim(app, code, 8_000, 12_000);
              handleServerResult(app, res, callback);
            } catch (Exception e2) {
              if (callback != null) {
                callback.onError(
                    e2.getMessage() == null ? "เชื่อมต่อไม่สำเร็จ — ลองใหม่" : e2.getMessage());
              }
            }
          }
        });
  }

  /** Background seat assign after local-first unlock. */
  public static void syncPendingClaim(Context context) {
    Context app = context.getApplicationContext();
    if (!StoreClaimPrefs.isClaimPendingSync(app)) return;
    EXEC.execute(() -> syncClaimToServer(app));
  }

  private static void syncClaimToServer(Context app) {
    String code = StoreClaimPrefs.pendingClaimCode(app);
    if (code == null || code.isEmpty()) return;
    try {
      JSONObject res = postClaim(app, code, 6_000, 10_000);
      String errCode = res.optString("code", "");
      if (res.optBoolean("ok", false)) {
        StoreClaimPrefs.markClaimed(app, false);
        return;
      }
      if ("seat_taken".equals(errCode)
          || "device_blocked".equals(errCode)
          || "device_dev_rejected".equals(errCode)
          || "bad_code".equals(errCode)
          || "claim_not_configured".equals(errCode)) {
        boolean seatTaken = "seat_taken".equals(errCode);
        StoreClaimPrefs.clearClaim(app);
        StoreClaimPrefs.applyFromServer(
            app,
            true,
            false,
            StoreClaimPrefs.isBlocked(app),
            StoreClaimPrefs.rejectDev(app),
            false,
            seatTaken,
            true);
      }
    } catch (Exception ignored) {
      /* keep pending — retry on next resume */
    }
  }

  private static void handleServerResult(Context app, JSONObject res, Callback callback) {
    if (res.optBoolean("ok", false)) {
      StoreClaimPrefs.markClaimed(app, false);
      if (callback != null) callback.onSuccess();
      return;
    }
    String err = res.optString("error", "claim_failed");
    String errCode = res.optString("code", "");
    if ("seat_taken".equals(errCode)) {
      err = "มีเครื่องอื่นใช้อยู่ — หลังบ้านกดเตะ / เคลียร์ seat ก่อน";
    } else if ("claim_not_configured".equals(errCode)) {
      err = "ยังไม่ได้ตั้งรหัสร้านหลังบ้าน — ไป /pos-sales/?tab=manage ตั้งรหัสก่อน";
    } else if ("bad_code".equals(errCode)) {
      err = "รหัสร้านไม่ตรง";
    } else if ("device_unknown".equals(errCode)) {
      err = "ยังไม่พบเครื่อง — รอสักครู่แล้วลองใหม่";
    } else if ("device_dev_rejected".equals(errCode)) {
      err = "เครื่องจำลองถูกปิดกั้น — ปิด reject-dev หลังบ้าน หรือใช้แท็บเล็ตจริง";
    } else if ("device_blocked".equals(errCode)) {
      err = "เครื่องนี้ถูกบล็อกจากหลังบ้าน";
    }
    if (callback != null) callback.onError(err);
  }

  private static JSONObject postClaim(Context app, String code, int connectMs, int readMs)
      throws Exception {
    HttpURLConnection conn = null;
    try {
      JSONObject body = new JSONObject();
      body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
      body.put("storeCode", code);
      conn = (HttpURLConnection) new URL(CLAIM_URL).openConnection();
      conn.setConnectTimeout(connectMs);
      conn.setReadTimeout(readMs);
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
      return new JSONObject(raw.isEmpty() ? "{}" : raw);
    } finally {
      if (conn != null) conn.disconnect();
    }
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
