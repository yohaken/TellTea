package app.telltea.npos;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import java.lang.ref.WeakReference;

import app.telltea.npos.diagnose.ForegroundHeartbeat;
import app.telltea.npos.diagnose.StoreClaimPrefs;
import app.telltea.npos.sell.MenuWarmup;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * Tracks the foreground activity for PixelCopy + keeps heartbeat alive while UI is open.
 * Also bounces sell/settings/etc. back to the claim hub when BO kicks the seat.
 */
public final class NposApp extends Application {
  private static WeakReference<Activity> currentActivity = new WeakReference<>(null);

  @Override
  public void onCreate() {
    super.onCreate();
    StoreClaimPrefs.addKickListener(this::onKickedOrLostSeat);
    registerActivityLifecycleCallbacks(
        new ActivityLifecycleCallbacks() {
          @Override
          public void onActivityResumed(Activity activity) {
            currentActivity = new WeakReference<>(activity);
            ForegroundHeartbeat.onActivityResumed(activity);
            MenuWarmup.warm(activity);
          }

          @Override
          public void onActivityPaused(Activity activity) {
            ForegroundHeartbeat.onActivityPaused();
            // Keep last activity for PixelCopy while briefly paused
            // (heartbeat capture can race with UI pause).
          }

          @Override
          public void onActivityCreated(Activity a, Bundle b) {}

          @Override
          public void onActivityStarted(Activity a) {}

          @Override
          public void onActivityStopped(Activity a) {}

          @Override
          public void onActivitySaveInstanceState(Activity a, Bundle b) {}

          @Override
          public void onActivityDestroyed(Activity a) {
            Activity cur = currentActivity.get();
            if (cur == a) currentActivity = new WeakReference<>(null);
          }
        });
  }

  public static Activity foregroundActivity() {
    return currentActivity.get();
  }

  private void onKickedOrLostSeat() {
    Activity fg = foregroundActivity();
    if (fg == null) return;
    fg.runOnUiThread(
        () -> {
          int toastRes =
              StoreClaimPrefs.wasCodeChanged(fg)
                  ? R.string.store_claim_code_changed
                  : R.string.store_claim_kicked;
          Toast.makeText(fg, toastRes, Toast.LENGTH_LONG).show();
          // Keep server session open — drop local open so hub shows claim gate.
          if (ShiftPrefs.isOpen(fg)) {
            ShiftPrefs.clearLocalOpen(fg);
          }
          // Finish sell / settings / shift / receipts stack → claim hub.
          Intent i = new Intent(fg, MainActivity.class);
          i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
          fg.startActivity(i);
          if (!(fg instanceof MainActivity) && !fg.isFinishing()) {
            fg.finish();
          }
        });
  }
}
