package app.telltea.npos.printer;

import android.content.Context;

import app.telltea.npos.diagnose.OpsLogger;

/**
 * Manual cash-drawer open via the selected receipt printer (RJ11 kick pulse).
 * Used from Settings (test) and Sell hub (No Sale).
 */
public final class DrawerKick {
  public interface ResultCallback {
    void onDone(boolean ok, String message, PrinterEndpoint endpoint);
  }

  private DrawerKick() {}

  public static void send(Context context, String reason, ResultCallback callback) {
    if (context == null) return;
    PrinterEndpoint ep = PrinterPrefs.savedOrNull(context);
    if (ep == null) {
      OpsLogger.warn(context, "drawer", "ยังไม่เลือกปริ้นเตอร์สำหรับลิ้นชัก", reason == null ? "" : reason);
      if (callback != null) callback.onDone(false, "no-printer", null);
      return;
    }
    String detail = reason == null || reason.trim().isEmpty() ? "manual" : reason.trim();
    new PrinterTransport()
        .send(
            context,
            ep,
            EscPos.drawerKick(),
            result -> {
              if (result.ok) {
                PrinterPrefs.saveSuccess(context, ep);
                OpsLogger.result(
                    context,
                    "drawer",
                    "เปิดลิ้นชัก",
                    detail + " · " + ep.displayLine() + " · " + result.message,
                    true);
              } else {
                OpsLogger.error(
                    context,
                    "drawer",
                    "เปิดลิ้นชักไม่สำเร็จ",
                    detail + " · " + ep.displayLine() + " · " + result.message);
              }
              if (callback != null) callback.onDone(result.ok, result.message, ep);
            });
  }
}
