package app.telltea.npos.update;

import android.content.Context;

import java.util.concurrent.atomic.AtomicReference;

import app.telltea.npos.diagnose.OpsPulsePrefs;

/**
 * Shared APK version check throttle — piggybacks on the BO server sync pulse
 * (ForegroundHeartbeat) so the sell-screen countdown also discovers updates
 * without waiting for the next activity resume.
 *
 * <p>Throttle scales with BO {@link OpsPulsePrefs} (min 20s, typically 4× heartbeat)
 * so slow shops do not spam {@code latest.json}.
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
    if (now - lastCheckAtMs < throttleMs(context)) return;
    lastCheckAtMs = now;
    host.runAutoCheck(reason == null ? "auto" : reason);
  }

  /** Min 20s · scales with BO heartbeat (4×) · cap 10 min. */
  static long throttleMs(Context context) {
    try {
      long hb = OpsPulsePrefs.heartbeatIntervalMs(context);
      long scaled = Math.max(UpdateConfig.AUTO_CHECK_MIN_INTERVAL_MS, hb * 4L);
      return Math.min(scaled, 10L * 60_000L);
    } catch (Throwable t) {
      return UpdateConfig.AUTO_CHECK_MIN_INTERVAL_MS;
    }
  }
}
