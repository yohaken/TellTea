package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Compares server {@code menuVersion} (from heartbeat / menu snapshot) to local cache.
 * When newer, notifies bound Sell screens to {@code reloadMenu(true)} — throttled.
 */
public final class MenuSyncCoordinator {
  public interface Listener {
    void onMenuVersionChanged(long serverVersion);
  }

  private static final String PREFS = "npos_menu";
  private static final String KEY_LOCAL = "localMenuVersion";
  private static final String KEY_LAST_RELOAD = "lastMenuReloadAt";
  private static final long THROTTLE_MS = 30_000L;

  private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

  private MenuSyncCoordinator() {}

  public static void bind(Listener listener) {
    if (listener != null && !listeners.contains(listener)) listeners.add(listener);
  }

  public static void unbind(Listener listener) {
    if (listener != null) listeners.remove(listener);
  }

  public static long localVersion(Context context) {
    if (context == null) return 0L;
    return context
        .getApplicationContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getLong(KEY_LOCAL, 0L);
  }

  public static void markSynced(Context context, long version) {
    if (context == null || version <= 0) return;
    context
        .getApplicationContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putLong(KEY_LOCAL, version)
        .putLong(KEY_LAST_RELOAD, System.currentTimeMillis())
        .apply();
  }

  /** From heartbeat / shop / menu payload. */
  public static void applyFromServer(Context context, long serverVersion) {
    if (context == null || serverVersion <= 0) return;
    long local = localVersion(context);
    if (serverVersion <= local) return;
    SharedPreferences prefs =
        context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    long last = prefs.getLong(KEY_LAST_RELOAD, 0L);
    long now = System.currentTimeMillis();
    if (last > 0 && now - last < THROTTLE_MS) return;
    // Optimistic throttle stamp so parallel heartbeats do not storm.
    prefs.edit().putLong(KEY_LAST_RELOAD, now).apply();
    for (Listener l : listeners) {
      try {
        l.onMenuVersionChanged(serverVersion);
      } catch (RuntimeException ignored) {
        /* one bad listener must not block others */
      }
    }
  }
}
