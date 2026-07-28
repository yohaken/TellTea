package app.telltea.npos.printer;

import android.content.Context;
import android.os.Build;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterException;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Built-in SUNMI InnerPrinter via official AIDL service (same path Wongnai uses).
 * Raw ESC/POS over USB/BT does not drive this hardware.
 */
public final class SunmiInnerPrinter {
  public static final String ENDPOINT_ID = "sunmi:inner";
  public static final String ENDPOINT_LABEL = "SUNMI InnerPrinter";

  private static final Object LOCK = new Object();
  private static volatile SunmiPrinterService service;
  private static volatile InnerPrinterCallback boundCallback;
  private static volatile Context appCtx;

  private SunmiInnerPrinter() {}

  public static boolean isSunmiDevice() {
    String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
    String b = Build.BRAND == null ? "" : Build.BRAND;
    String model = Build.MODEL == null ? "" : Build.MODEL;
    return containsSunmi(m) || containsSunmi(b) || containsSunmi(model);
  }

  private static boolean containsSunmi(String s) {
    return s.toLowerCase(java.util.Locale.US).contains("sunmi");
  }

  public static PrinterEndpoint endpoint() {
    return new PrinterEndpoint(
        PrinterEndpoint.Kind.SUNMI,
        ENDPOINT_ID,
        ENDPOINT_LABEL,
        "built-in · AIDL (เหมือน Wongnai)");
  }

  public static PrinterTransport.Result sendRaw(Context context, byte[] payload) {
    if (payload == null || payload.length == 0) {
      return new PrinterTransport.Result(false, "empty payload");
    }
    if (isDrawerKick(payload)) {
      return openDrawer(context);
    }
    try {
      SunmiPrinterService svc = ensureService(context);
      if (svc == null) {
        return new PrinterTransport.Result(
            false, "ไม่พบบริการปริ้น SUNMI — เครื่องนี้มี InnerPrinter หรือยัง?");
      }
      if (!InnerPrinterManager.getInstance().hasPrinter(svc)) {
        return new PrinterTransport.Result(false, "เครื่องนี้ไม่มีปริ้นในตัว");
      }
      CountDownLatch done = new CountDownLatch(1);
      AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
      svc.sendRAWData(
          payload,
          new InnerResultCallback() {
            @Override
            public void onRunResult(boolean isSuccess) {
              out.set(
                  new PrinterTransport.Result(
                      isSuccess,
                      isSuccess
                          ? "SUNMI ส่งแล้ว " + payload.length + " bytes"
                          : "SUNMI ส่งไม่สำเร็จ"));
              done.countDown();
            }

            @Override
            public void onReturnString(String result) {}

            @Override
            public void onRaiseException(int code, String msg) {
              out.set(
                  new PrinterTransport.Result(
                      false, "SUNMI exception " + code + (msg == null ? "" : ": " + msg)));
              done.countDown();
            }

            @Override
            public void onPrintResult(int code, String msg) {
              // Some firmwares report completion here instead of onRunResult.
              if (out.get() == null) {
                boolean ok = code == 0;
                out.set(
                    new PrinterTransport.Result(
                        ok, ok ? "SUNMI พิมพ์แล้ว" : "SUNMI printResult " + code + " " + msg));
                done.countDown();
              }
            }
          });
      if (!done.await(20, TimeUnit.SECONDS)) {
        return new PrinterTransport.Result(false, "SUNMI timeout (sendRAWData)");
      }
      PrinterTransport.Result r = out.get();
      return r != null ? r : new PrinterTransport.Result(false, "SUNMI ไม่ตอบ");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new PrinterTransport.Result(false, "interrupted");
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      return new PrinterTransport.Result(false, msg);
    }
  }

  public static PrinterTransport.Result openDrawer(Context context) {
    try {
      SunmiPrinterService svc = ensureService(context);
      if (svc == null) {
        return new PrinterTransport.Result(false, "ไม่พบบริการปริ้น SUNMI");
      }
      CountDownLatch done = new CountDownLatch(1);
      AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
      svc.openDrawer(
          new InnerResultCallback() {
            @Override
            public void onRunResult(boolean isSuccess) {
              out.set(
                  new PrinterTransport.Result(
                      isSuccess, isSuccess ? "SUNMI เปิดลิ้นชักแล้ว" : "เปิดลิ้นชักไม่สำเร็จ"));
              done.countDown();
            }

            @Override
            public void onReturnString(String result) {}

            @Override
            public void onRaiseException(int code, String msg) {
              out.set(
                  new PrinterTransport.Result(
                      false, "drawer exception " + code + (msg == null ? "" : ": " + msg)));
              done.countDown();
            }

            @Override
            public void onPrintResult(int code, String msg) {
              if (out.get() == null) {
                out.set(
                    new PrinterTransport.Result(
                        code == 0, code == 0 ? "SUNMI เปิดลิ้นชักแล้ว" : "drawer " + code));
                done.countDown();
              }
            }
          });
      if (!done.await(12, TimeUnit.SECONDS)) {
        return new PrinterTransport.Result(false, "SUNMI timeout (openDrawer)");
      }
      PrinterTransport.Result r = out.get();
      return r != null ? r : new PrinterTransport.Result(false, "SUNMI ลิ้นชักไม่ตอบ");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new PrinterTransport.Result(false, "interrupted");
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      return new PrinterTransport.Result(false, msg);
    }
  }

  private static boolean isDrawerKick(byte[] payload) {
    return Arrays.equals(payload, EscPos.drawerKick());
  }

  private static SunmiPrinterService ensureService(Context context)
      throws InnerPrinterException, InterruptedException {
    if (context == null) return null;
    SunmiPrinterService existing = service;
    if (existing != null) return existing;

    synchronized (LOCK) {
      if (service != null) return service;
      appCtx = context.getApplicationContext();
      CountDownLatch connected = new CountDownLatch(1);
      AtomicReference<SunmiPrinterService> got = new AtomicReference<>();
      InnerPrinterCallback cb =
          new InnerPrinterCallback() {
            @Override
            protected void onConnected(SunmiPrinterService sunmiPrinterService) {
              got.set(sunmiPrinterService);
              service = sunmiPrinterService;
              connected.countDown();
            }

            @Override
            protected void onDisconnected() {
              service = null;
            }
          };
      boundCallback = cb;
      boolean ok = InnerPrinterManager.getInstance().bindService(appCtx, cb);
      if (!ok) {
        return null;
      }
      if (!connected.await(8, TimeUnit.SECONDS)) {
        return null;
      }
      return got.get();
    }
  }
}
