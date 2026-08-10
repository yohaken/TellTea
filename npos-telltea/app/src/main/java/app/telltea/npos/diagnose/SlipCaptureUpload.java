package app.telltea.npos.diagnose;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * After a successful Sunmi slip print, JPEG the rendered bitmap and POST to BO
 * ({@code reportNposScreenCapture} with {@code role=slip}). Runs only after
 * InnerPrinter is released — never holds the printer for upload.
 */
public final class SlipCaptureUpload {
  private static final String REPORT_URL = ScreenCapture.REPORT_URL;
  private static final int JPEG_QUALITY = 88;
  private static final int MAX_JPEG_BYTES = 3_500_000;
  private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

  private SlipCaptureUpload() {}

  /**
   * Copy {@code slip} and upload on a background thread. Safe to call from the
   * print finally-block after {@code releaseService()}. Fail-open.
   */
  public static void uploadPrintedSlip(Context context, Bitmap slip, String billNo) {
    if (context == null || slip == null || slip.isRecycled()) return;
    Context app = context.getApplicationContext();
    final Bitmap copy;
    try {
      copy = slip.copy(Bitmap.Config.ARGB_8888, false);
    } catch (Exception e) {
      OpsLogger.warn(app, "printer", "คัดลอกสลิปไปหลังร้านไม่สำเร็จ", billNo);
      return;
    }
    if (copy == null) return;
    final String bill = billNo == null ? "" : billNo.trim();
    EXEC.execute(
        () -> {
          try {
            postSlip(app, copy, bill);
          } catch (Exception e) {
            OpsLogger.error(
                app,
                "printer",
                "ส่งภาพสลิปหลังร้านไม่สำเร็จ",
                e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
          } finally {
            try {
              if (!copy.isRecycled()) copy.recycle();
            } catch (Exception ignored) {
              /* ignore */
            }
          }
        });
  }

  private static void postSlip(Context app, Bitmap slip, String billNo) throws Exception {
    byte[] jpeg = compressJpegUnder(slip, JPEG_QUALITY, MAX_JPEG_BYTES);
    if (jpeg == null || jpeg.length < 32) {
      throw new IllegalStateException("slip_jpeg_empty");
    }
    JSONObject slipObj = new JSONObject();
    slipObj.put("role", "slip");
    slipObj.put("ok", true);
    slipObj.put("detail", billNo.isEmpty() ? "sale_slip" : billNo);
    slipObj.put("width", slip.getWidth());
    slipObj.put("height", slip.getHeight());
    slipObj.put("jpegBase64", Base64.encodeToString(jpeg, Base64.NO_WRAP));

    JSONObject body = new JSONObject();
    body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
    body.put("stableKey", DeviceIdentity.stableKey(app));
    body.put("isEmulator", DeviceIdentity.isEmulator());
    body.put("deviceClass", DeviceIdentity.deviceClass());
    body.put("requestAt", 0L);
    body.put("reason", "slip");
    body.put("capturedAt", System.currentTimeMillis());
    body.put("slip", slipObj);
    if (!billNo.isEmpty()) body.put("billNo", billNo);

    JSONObject res = postJson(body);
    boolean hasImages = res != null && res.optBoolean("hasImages", false);
    String shotId = res != null ? res.optString("shotId", "") : "";
    if (hasImages) {
      OpsLogger.info(app, "printer", "ส่งภาพสลิปหลังร้านแล้ว", "shot=" + shotId + " · " + billNo);
    } else {
      OpsLogger.warn(app, "printer", "ส่งภาพสลิปแล้วแต่ไม่มีรูป", billNo);
    }
  }

  private static byte[] compressJpegUnder(Bitmap bmp, int startQuality, int maxBytes) {
    int q = Math.min(95, Math.max(50, startQuality));
    byte[] best = null;
    while (q >= 50) {
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      bmp.compress(Bitmap.CompressFormat.JPEG, q, bos);
      best = bos.toByteArray();
      if (best.length <= maxBytes) return best;
      q -= 8;
    }
    return best == null ? new byte[0] : best;
  }

  private static JSONObject postJson(JSONObject body) throws Exception {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(REPORT_URL).openConnection();
      conn.setConnectTimeout(20_000);
      conn.setReadTimeout(90_000);
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
      if (raw == null || raw.isEmpty()) return new JSONObject();
      try {
        return new JSONObject(raw);
      } catch (Exception parseErr) {
        return new JSONObject();
      }
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
