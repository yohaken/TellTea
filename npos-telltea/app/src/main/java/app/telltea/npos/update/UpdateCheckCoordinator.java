package app.telltea.npos.update;

import android.content.Context;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Shared APK version check throttle — piggybacks on the BO server sync pulse
 * (ForegroundHeartbeat) so the sell-screen countdown also discovers updates
 * without waiting for the next activity resume.
 */
public final class UpdateCheckCoordinator {
  private static final AtomicReference<UpdatePromptController> LIVE = new AtomicReference<>();
  private static volatile long lastCheckAtMs;

  private UpdateCheckCoordinator() {}

  public static void bind(UpdatePromptController controller) {
    if (controller != null) LIVE.set(controller);
  }

  public static void unbind(UpdatePromptController controller) {
    if (controller != null) LIVE.compareAndSet(controller, null);
  }

  public static void resetThrottle() {
    lastCheckAtMs = 0L;
  }

  /** After a successful device heartbeat / seat check. */
  public static void onServerSyncPulse(Context context) {
    UpdatePromptController host = LIVE.get();
    if (host != null && host.hasPendingUpdate()) {
      // Mandatory: keep resurfacing even if staff dismissed many times.
      host.reassertPendingUpdate();
      return;
    }
    requestCheck(context, "sync");
  }

  public static void requestCheck(Context context, String reason) {
    UpdatePromptController host = LIVE.get();
    if (host == null) return;
    long now = System.currentTimeMillis();
    if (now - lastCheckAtMs < UpdateConfig.AUTO_CHECK_MIN_INTERVAL_MS) return;
    lastCheckAtMs = now;
    host.runAutoCheck(reason == null ? "auto" : reason);
  }
}
