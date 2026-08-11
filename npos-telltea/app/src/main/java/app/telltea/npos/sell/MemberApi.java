package app.telltea.npos.sell;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.telltea.npos.diagnose.DeviceIdentity;

/**
 * Counter member lookup / quick create — HTTPS + installId (same auth as sales).
 */
public final class MemberApi {
  public static final String LOOKUP_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposMemberLookup";
  public static final String CREATE_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposMemberQuickCreate";
  public static final String COMP_STATUS_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposCompCouponStatus";
  public static final String COMP_ISSUE_URL =
      "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposIssueCompCoupon";

  public interface Callback {
    void onResult(JSONObject res);

    void onError(String message);
  }

  private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  private MemberApi() {}

  public static void lookup(Context context, String phone, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("phone", phone == null ? "" : phone.trim());
            JSONObject res = MenuRepository.postJson(LOOKUP_URL, body, 6_000, 10_000);
            MAIN.post(() -> deliver(res, callback));
          } catch (Exception e) {
            MAIN.post(
                () -> {
                  if (callback != null) {
                    callback.onError(
                        e.getMessage() == null ? "ค้นหาสมาชิกไม่สำเร็จ" : e.getMessage());
                  }
                });
          }
        });
  }

  public static void quickCreate(
      Context context, String phone, String displayName, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            body.put("phone", phone == null ? "" : phone.trim());
            if (displayName != null && !displayName.trim().isEmpty()) {
              body.put("displayName", displayName.trim());
            }
            JSONObject res = MenuRepository.postJson(CREATE_URL, body, 6_000, 12_000);
            MAIN.post(() -> deliver(res, callback));
          } catch (Exception e) {
            MAIN.post(
                () -> {
                  if (callback != null) {
                    callback.onError(
                        e.getMessage() == null ? "สมัครสมาชิกไม่สำเร็จ" : e.getMessage());
                  }
                });
          }
        });
  }

  private static void deliver(JSONObject res, Callback callback) {
    if (callback == null) return;
    if (res == null) {
      callback.onError("ไม่มีคำตอบจากเซิร์ฟเวอร์");
      return;
    }
    if (!res.optBoolean("ok", false)) {
      String err = res.optString("error", "lookup_failed");
      callback.onError(humanError(err));
      return;
    }
    callback.onResult(res);
  }

  /** Remaining daily quota for QR ให้แต้ม. */
  public static void compCouponStatus(Context context, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            JSONObject res = MenuRepository.postJson(COMP_STATUS_URL, body, 6_000, 10_000);
            MAIN.post(() -> deliver(res, callback));
          } catch (Exception e) {
            MAIN.post(
                () -> {
                  if (callback != null) {
                    callback.onError(
                        e.getMessage() == null ? "เช็คโควต้าไม่สำเร็จ" : e.getMessage());
                  }
                });
          }
        });
  }

  /** Issue one gift-point coupon (decrements quota). */
  public static void issueCompCoupon(Context context, Callback callback) {
    Context app = context.getApplicationContext();
    EXEC.execute(
        () -> {
          try {
            JSONObject body = new JSONObject();
            body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
            JSONObject res = MenuRepository.postJson(COMP_ISSUE_URL, body, 6_000, 12_000);
            MAIN.post(() -> deliver(res, callback));
          } catch (Exception e) {
            MAIN.post(
                () -> {
                  if (callback != null) {
                    callback.onError(
                        e.getMessage() == null ? "ออก QR ให้แต้มไม่สำเร็จ" : e.getMessage());
                  }
                });
          }
        });
  }

  static String humanError(String code) {
    if (code == null || code.isEmpty()) return "ค้นหาสมาชิกไม่สำเร็จ";
    if ("invalid_phone".equals(code)) return "เบอร์ไม่ถูกต้อง";
    if ("disabled".equals(code)) return "ระบบสมาชิกยังไม่เปิด";
    if ("comp_off".equals(code)) return "ยังไม่เปิด QR ให้แต้มที่หลังร้าน";
    if ("quota_exhausted".equals(code)) return "โควต้าวันนี้หมดแล้ว";
    if ("quota_zero".equals(code)) return "ยังไม่ได้ตั้งโควต้า QR ให้แต้ม";
    if ("lookup_failed".equals(code) || "create_failed".equals(code) || "issue_failed".equals(code)) {
      return "เชื่อมต่อสมาชิกไม่สำเร็จ — ลองใหม่";
    }
    return code;
  }

  /** Baht from points — mirrors server {@code redeemBahtFromPoints}. */
  public static double redeemBahtFromPoints(int points, double pointsPerBahtRedeem) {
    if (points <= 0 || !(pointsPerBahtRedeem > 0)) return 0;
    return Math.floor(points / pointsPerBahtRedeem);
  }
}
