package app.telltea.npos.diagnose;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * System dialog for screen-capture consent (MediaProjection).
 *
 * <p>While a BO capture is outstanding and staff have not granted, re-prompt until they accept —
 * do not stop after one dismiss.
 */
public final class CaptureConsentActivity extends Activity {
  public static final String EXTRA_PENDING_REQUEST_AT = "pendingRequestAt";
  public static final String EXTRA_PENDING_REASON = "pendingReason";
  public static final String EXTRA_AFTER_UPDATE = "afterUpdate";

  private static final int REQ_CAPTURE = 7110;
  /** Delay before re-asking after dismiss — long enough to leave the system dialog. */
  private static final long RETRY_AFTER_DENY_MS = 2_500L;

  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static final AtomicBoolean SHOWING = new AtomicBoolean(false);
  private static final Runnable RETRY =
      new Runnable() {
        @Override
        public void run() {
          Context app = appCtx;
          if (app == null) return;
          if (!CaptureProjectionPrefs.needsCaptureConsent(app)) return;
          if (!CapturePrefs.hasOutstandingCaptureRequest(app)
              && !CaptureProjectionPrefs.shouldNagUntilGrant(app)) {
            return;
          }
          long reqAt = CapturePrefs.pendingConsentRequestAt(app);
          String reason = CapturePrefs.pendingConsentReason(app);
          if (CaptureProjectionPrefs.shouldNagUntilGrant(app) && reqAt <= 0) {
            reason = "after_update";
          }
          launchIfNeeded(app, reqAt, reason);
        }
      };

  private static volatile Context appCtx;

  private long pendingRequestAt;
  private String pendingReason;
  private boolean launched;

  /** Prompt if projection not live. Safe to call from any context; will not stack dialogs. */
  public static void launchIfNeeded(Context context, long requestAt, String reason) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    appCtx = app;
    if (!CaptureProjectionPrefs.needsCaptureConsent(app)) return;
    if (requestAt > 0) {
      CapturePrefs.setPendingConsent(app, requestAt, reason);
    }
    if ("after_update".equals(reason) || "manual".equals(reason)) {
      CaptureProjectionPrefs.markNagUntilGrant(app);
    }
    if (!SHOWING.compareAndSet(false, true)) {
      // Dialog already up — pending prefs updated; retry after current dismiss if needed.
      return;
    }
    Intent i = new Intent(app, CaptureConsentActivity.class);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    i.putExtra(EXTRA_PENDING_REQUEST_AT, requestAt);
    i.putExtra(EXTRA_PENDING_REASON, reason == null ? "manual" : reason);
    try {
      app.startActivity(i);
    } catch (Exception e) {
      SHOWING.set(false);
      OpsLogger.error(
          app,
          "display",
          "แคปจอ · เปิด dialog ไม่สำเร็จ",
          e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
      scheduleRetry();
    }
  }

  /** After APK update — ask capture; keep naging until granted if staff dismiss. */
  public static void launchAfterUpdateIfNeeded(Activity activity) {
    if (activity == null) return;
    if (!CaptureProjectionPrefs.consumePromptAfterUpdate(activity)) {
      // Sticky nag from a previous dismiss after update / outstanding BO ask.
      if (CaptureProjectionPrefs.shouldNagUntilGrant(activity)
          && CaptureProjectionPrefs.needsCaptureConsent(activity)) {
        launchIfNeeded(activity, CapturePrefs.pendingConsentRequestAt(activity), "after_update");
      } else if (CapturePrefs.hasOutstandingCaptureRequest(activity)
          && CaptureProjectionPrefs.needsCaptureConsent(activity)) {
        launchIfNeeded(
            activity,
            CapturePrefs.pendingConsentRequestAt(activity),
            CapturePrefs.pendingConsentReason(activity));
      }
      return;
    }
    if (!CaptureProjectionPrefs.needsCaptureConsent(activity)) return;
    CaptureProjectionPrefs.markNagUntilGrant(activity);
    launchIfNeeded(activity, 0L, "after_update");
  }

  /** Call from sell/hub resume — keep asking while capture consent still required. */
  public static void relaunchPendingIfNeeded(Context context) {
    if (context == null) return;
    Context app = context.getApplicationContext();
    if (!CaptureProjectionPrefs.needsCaptureConsent(app)) return;
    if (CapturePrefs.hasOutstandingCaptureRequest(app)) {
      launchIfNeeded(
          app,
          CapturePrefs.pendingConsentRequestAt(app),
          CapturePrefs.pendingConsentReason(app));
      return;
    }
    if (CaptureProjectionPrefs.shouldNagUntilGrant(app)) {
      launchIfNeeded(app, 0L, "after_update");
    }
  }

  private static void scheduleRetry() {
    MAIN.removeCallbacks(RETRY);
    MAIN.postDelayed(RETRY, RETRY_AFTER_DENY_MS);
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    appCtx = getApplicationContext();
    Window w = getWindow();
    if (w != null) {
      w.setBackgroundDrawableResource(android.R.color.transparent);
    }
    pendingRequestAt =
        getIntent() != null ? getIntent().getLongExtra(EXTRA_PENDING_REQUEST_AT, 0L) : 0L;
    pendingReason =
        getIntent() != null ? getIntent().getStringExtra(EXTRA_PENDING_REASON) : "manual";
    if (pendingReason == null) pendingReason = "manual";
    if (pendingRequestAt > 0) {
      CapturePrefs.setPendingConsent(this, pendingRequestAt, pendingReason);
    }

    if (!CaptureProjectionPrefs.needsCaptureConsent(this)) {
      CaptureProjectionPrefs.clearNagUntilGrant(this);
      SHOWING.set(false);
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
        SHOWING.set(false);
        scheduleRetry();
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
      SHOWING.set(false);
      scheduleRetry();
      finish();
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != REQ_CAPTURE) {
      SHOWING.set(false);
      finish();
      return;
    }
    if (resultCode == RESULT_OK && data != null) {
      MAIN.removeCallbacks(RETRY);
      CaptureProjectionPrefs.clearNagUntilGrant(this);
      CaptureProjectionService.startWithConsent(getApplicationContext(), resultCode, data);
      OpsLogger.info(this, "display", "แคปจอ · อนุญาตแล้ว", pendingReason);
      // Wait until FGS holds a live projection (up to ~3s) before capturing —
      // a fixed 600ms often races startForegroundService and re-opens the dialog.
      if (pendingRequestAt > 0 || "after_update".equals(pendingReason)) {
        final long reqAt =
            pendingRequestAt > 0 ? pendingRequestAt : System.currentTimeMillis();
        final String reason = pendingReason;
        final Context appCtx = getApplicationContext();
        final Runnable[] attempt = new Runnable[1];
        final long deadline = System.currentTimeMillis() + 3200L;
        attempt[0] =
            () -> {
              if (CaptureProjectionService.hasLiveProjection()
                  || System.currentTimeMillis() >= deadline) {
                ScreenCapture.requestCapture(appCtx, reqAt, reason);
                return;
              }
              MAIN.postDelayed(attempt[0], 200L);
            };
        MAIN.postDelayed(attempt[0], 400L);
      }
      SHOWING.set(false);
    } else {
      CaptureProjectionPrefs.markDenied(this);
      OpsLogger.warn(this, "display", "แคปจอ · พนักงานไม่รับสิทธิ์", pendingReason);
      SHOWING.set(false);
      // Keep asking — BO capture / sticky nag until staff accept.
      if (CapturePrefs.hasOutstandingCaptureRequest(this)
          || CaptureProjectionPrefs.shouldNagUntilGrant(this)
          || "manual".equals(pendingReason)
          || "after_update".equals(pendingReason)) {
        CaptureProjectionPrefs.markNagUntilGrant(this);
        scheduleRetry();
      }
    }
    finish();
  }

  @Override
  protected void onDestroy() {
    SHOWING.set(false);
    super.onDestroy();
  }
}
