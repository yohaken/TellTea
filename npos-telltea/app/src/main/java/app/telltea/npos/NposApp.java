package app.telltea.npos;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import java.lang.ref.WeakReference;

import app.telltea.npos.diagnose.ForegroundHeartbeat;
import app.telltea.npos.diagnose.PaymentVoice;
import app.telltea.npos.diagnose.StoreClaimPrefs;
import app.telltea.npos.printer.SunmiInnerPrinter;
import app.telltea.npos.sell.MenuWarmup;
import app.telltea.npos.shift.ShiftPrefs;
import app.telltea.npos.ui.NposConfirmDialog;

/**
 * Tracks the foreground activity for PixelCopy + keeps heartbeat alive while UI is open.
 * Also bounces sell/settings/etc. back to the claim hub when BO kicks the seat.
 */
public final class NposApp extends Application {
  private static WeakReference<Activity> currentActivity = new WeakReference<>(null);
  private static volatile long lastKickUiAt;

  @Override
  public void onCreate() {
    super.onCreate();
    StoreClaimPrefs.addKickListener(this::onKickedOrLostSeat);
    ShiftPrefs.addRemoteCloseListener(this::onRemoteSessionClosed);
    // D2s etc.: pick built-in InnerPrinter without staff scanning.
    try {
      SunmiInnerPrinter.autoSelectIfNeeded(this);
    } catch (RuntimeException ignored) {
      /* never block boot */
    }
    try {
      PaymentVoice.warm(this);
    } catch (RuntimeException ignored) {
      /* OEM TTS must not block boot */
    }
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
          long now = System.currentTimeMillis();
          // Debounce duplicate listeners (NposApp + MainActivity).
          if (now - lastKickUiAt < 800L) {
            bounceToClaimHub(fg);
            return;
          }
          lastKickUiAt = now;

          int titleRes =
              StoreClaimPrefs.wasCodeChanged(fg)
                  ? R.string.store_claim_code_changed
                  : R.string.store_claim_kicked;
          String reason = StoreClaimPrefs.kickReasonMessage(fg);
          Toast.makeText(fg, titleRes, Toast.LENGTH_LONG).show();
          try {
            NposConfirmDialog.alert(
                fg,
                fg.getString(titleRes),
                reason,
                fg.getString(R.string.store_claim_reenter_ok),
                false,
                () -> bounceToClaimHub(fg));
          } catch (RuntimeException e) {
            bounceToClaimHub(fg);
          }
          if (ShiftPrefs.isOpen(fg)) {
            ShiftPrefs.clearLocalOpen(fg);
          }
        });
  }

  private static void bounceToClaimHub(Activity fg) {
    if (fg == null || fg.isFinishing()) return;
    Intent i = new Intent(fg, MainActivity.class);
    i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    i.putExtra(MainActivity.EXTRA_SHOW_CLAIM_GATE, true);
    fg.startActivity(i);
    if (!(fg instanceof MainActivity) && !fg.isFinishing()) {
      fg.finish();
    }
  }

  /**
   * BO force-close via heartbeat — keep seat. SellActivity finishes the cart first;
   * other screens settle immediately and return to hub.
   */
  private void onRemoteSessionClosed() {
    Activity fg = foregroundActivity();
    if (fg == null) return;
    fg.runOnUiThread(
        () -> {
          if (fg instanceof SellActivity) {
            ((SellActivity) fg).onRemoteSessionClosedFromSync();
            return;
          }
          Toast.makeText(fg, R.string.shift_remote_closed_toast, Toast.LENGTH_LONG).show();
          ShiftPrefs.settleRemoteClosed(fg);
          if (!(fg instanceof MainActivity) && !fg.isFinishing()) {
            Intent i = new Intent(fg, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            fg.startActivity(i);
            fg.finish();
          }
        });
  }
}
