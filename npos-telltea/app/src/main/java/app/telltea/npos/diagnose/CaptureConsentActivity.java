package app.telltea.npos.diagnose;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.view.Window;

/**
 * One-shot system dialog for screen-capture consent (MediaProjection).
 * Separate from Bluetooth / notification bootstrap — ask only when capture needs it.
 */
public final class CaptureConsentActivity extends Activity {
  public static final String EXTRA_PENDING_REQUEST_AT = "pendingRequestAt";
  public static final String EXTRA_PENDING_REASON = "pendingReason";
  public static final String EXTRA_AFTER_UPDATE = "afterUpdate";

  private static final int REQ_CAPTURE = 7110;

  private long pendingRequestAt;
  private String pendingReason;
  private boolean launched;

  /** Prompt if projection not live. Safe to call from any activity. */
  public static void launchIfNeeded(Context context, long requestAt, String reason) {
    if (!CaptureProjectionPrefs.needsCaptureConsent(context)) return;
    Intent i = new Intent(context, CaptureConsentActivity.class);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    i.putExtra(EXTRA_PENDING_REQUEST_AT, requestAt);
    i.putExtra(EXTRA_PENDING_REASON, reason == null ? "manual" : reason);
    context.startActivity(i);
  }

  /** After APK update — ask capture once if not already live. */
  public static void launchAfterUpdateIfNeeded(Activity activity) {
    if (!CaptureProjectionPrefs.consumePromptAfterUpdate(activity)) return;
    if (!CaptureProjectionPrefs.needsCaptureConsent(activity)) return;
    Intent i = new Intent(activity, CaptureConsentActivity.class);
    i.putExtra(EXTRA_AFTER_UPDATE, true);
    i.putExtra(EXTRA_PENDING_REASON, "after_update");
    activity.startActivity(i);
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Window w = getWindow();
    if (w != null) {
      w.setBackgroundDrawableResource(android.R.color.transparent);
    }
    pendingRequestAt = getIntent() != null ? getIntent().getLongExtra(EXTRA_PENDING_REQUEST_AT, 0L) : 0L;
    pendingReason =
        getIntent() != null
            ? getIntent().getStringExtra(EXTRA_PENDING_REASON)
            : "manual";
    if (pendingReason == null) pendingReason = "manual";

    if (!CaptureProjectionPrefs.needsCaptureConsent(this)) {
      finish();
      return;
    }
    if (launched) return;
    launched = true;
    CaptureProjectionPrefs.touchPrompted(this);
    try {
      MediaProjectionManager mgr =
          (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
      if (mgr == null) {
        CaptureProjectionPrefs.markDenied(this);
        OpsLogger.warn(this, "display", "แคปจอ · ไม่รองรับ MediaProjection", "");
        finish();
        return;
      }
      OpsLogger.info(this, "display", "แคปจอ · ขออนุญาตแชร์หน้าจอ", pendingReason);
      startActivityForResult(mgr.createScreenCaptureIntent(), REQ_CAPTURE);
    } catch (Exception e) {
      CaptureProjectionPrefs.markDenied(this);
      OpsLogger.error(
          this,
          "display",
          "แคปจอ · เปิด dialog ไม่สำเร็จ",
          e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
      finish();
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != REQ_CAPTURE) {
      finish();
      return;
    }
    if (resultCode == RESULT_OK && data != null) {
      CaptureProjectionService.startWithConsent(getApplicationContext(), resultCode, data);
      OpsLogger.info(this, "display", "แคปจอ · อนุญาตแล้ว", pendingReason);
      // Retry pending BO capture shortly after FGS binds projection.
      if (pendingRequestAt > 0 || "after_update".equals(pendingReason)) {
        final long reqAt =
            pendingRequestAt > 0 ? pendingRequestAt : System.currentTimeMillis();
        final String reason = pendingReason;
        getWindow()
            .getDecorView()
            .postDelayed(
                () -> ScreenCapture.requestCapture(getApplicationContext(), reqAt, reason),
                600);
      }
    } else {
      CaptureProjectionPrefs.markDenied(this);
      OpsLogger.warn(this, "display", "แคปจอ · พนักงานไม่รับสิทธิ์", pendingReason);
    }
    finish();
  }
}
