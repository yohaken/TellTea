package app.telltea.npos.printer;

import android.content.Context;
import android.os.Build;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterException;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Built-in SUNMI InnerPrinter via official AIDL service (same path as Wongnai / stock apps).
 *
 * <p>Thai: prefer {@code printText} (UTF-16 Java → printer UTF fonts) instead of raw TIS-620
 * ESC/POS bytes, which Sunmi often mis-decodes as Chinese code pages.
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
        "built-in · AIDL · พิมพ์ไทย");
  }

  /**
   * On SUNMI with no printer saved yet — pick InnerPrinter so staff need not scan/choose.
   * Does not override an already-ready USB/BT/LAN choice.
   */
  public static void autoSelectIfNeeded(Context context) {
    if (context == null || !isSunmiDevice()) return;
    PrinterEndpoint.Kind kind = PrinterPrefs.kind(context);
    if (PrinterPrefs.isReady(context) && kind != null && kind != PrinterEndpoint.Kind.SUNMI) {
      return;
    }
    if (PrinterPrefs.isReady(context) && kind == PrinterEndpoint.Kind.SUNMI) return;
    PrinterPrefs.saveSuccess(context, endpoint());
  }

  public static PrinterTransport.Result sendRaw(Context context, byte[] payload) {
    if (payload == null || payload.length == 0) {
      return new PrinterTransport.Result(false, "empty payload");
    }
    if (isDrawerKick(payload)) {
      return openDrawer(context);
    }
    String plain = escPosTis620ToPlain(payload);
    if (plain != null && !plain.trim().isEmpty()) {
      return printPlain(context, plain);
    }
    return sendRawBytes(context, payload);
  }

  /** UTF text path — same family as stock SUNMI / Wongnai receipts. */
  public static PrinterTransport.Result printPlain(Context context, String text) {
    String body = text == null ? "" : text;
    if (!body.endsWith("\n")) body = body + "\n";
    try {
      SunmiPrinterService svc = ensureService(context);
      if (svc == null) {
        return new PrinterTransport.Result(
            false, "ไม่พบบริการปริ้น SUNMI — เครื่องนี้มี InnerPrinter หรือยัง?");
      }
      if (!InnerPrinterManager.getInstance().hasPrinter(svc)) {
        return new PrinterTransport.Result(false, "เครื่องนี้ไม่มีปริ้นในตัว");
      }
      try {
        svc.setAlignment(0, null);
      } catch (Exception ignored) {
        /* optional */
      }
      CountDownLatch done = new CountDownLatch(1);
      AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
      final String toPrint = body;
      svc.printText(
          toPrint,
          new InnerResultCallback() {
            @Override
            public void onRunResult(boolean isSuccess) {
              if (!isSuccess) {
                out.set(new PrinterTransport.Result(false, "SUNMI printText ไม่สำเร็จ"));
                done.countDown();
                return;
              }
              try {
                svc.lineWrap(2, null);
              } catch (Exception ignored) {
                /* optional */
              }
              try {
                svc.cutPaper(
                    new InnerResultCallback() {
                      @Override
                      public void onRunResult(boolean cutOk) {
                        out.set(
                            new PrinterTransport.Result(
                                true, "SUNMI พิมพ์ไทยแล้ว" + (cutOk ? "" : " (ตัดกระดาษข้าม)")));
                        done.countDown();
                      }

                      @Override
                      public void onReturnString(String result) {}

                      @Override
                      public void onRaiseException(int code, String msg) {
                        out.set(
                            new PrinterTransport.Result(true, "SUNMI พิมพ์ไทยแล้ว (ตัดกระดาษข้าม)"));
                        done.countDown();
                      }

                      @Override
                      public void onPrintResult(int code, String msg) {
                        if (out.get() == null) {
                          out.set(new PrinterTransport.Result(true, "SUNMI พิมพ์ไทยแล้ว"));
                          done.countDown();
                        }
                      }
                    });
              } catch (Exception cutErr) {
                out.set(new PrinterTransport.Result(true, "SUNMI พิมพ์ไทยแล้ว"));
                done.countDown();
              }
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
              if (out.get() == null && code != 0) {
                out.set(
                    new PrinterTransport.Result(
                        false, "SUNMI printResult " + code + " " + msg));
                done.countDown();
              }
            }
          });
      if (!done.await(20, TimeUnit.SECONDS)) {
        return new PrinterTransport.Result(false, "SUNMI timeout (printText)");
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

  private static PrinterTransport.Result sendRawBytes(Context context, byte[] payload) {
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

  /**
   * Strip ESC/POS controls from our receipt payloads so InnerPrinter can print Thai via
   * {@code printText}. Body bytes may be TIS-620 (preferred on device) or UTF-8 fallback.
   */
  static String escPosTis620ToPlain(byte[] payload) {
    if (payload == null || payload.length == 0) return "";
    StringBuilder sb = new StringBuilder();
    int i = 0;
    while (i < payload.length) {
      int b = payload[i] & 0xFF;
      if (b == 0x1B) {
        if (i + 1 >= payload.length) break;
        int n = payload[i + 1] & 0xFF;
        if (n == 0x40) {
          i += 2;
          continue;
        }
        if (n == 0x61 && i + 2 < payload.length) {
          i += 3;
          continue;
        }
        if (n == 0x70 && i + 4 < payload.length) {
          i += 5;
          continue;
        }
        // ESC d n — feed n lines
        if (n == 0x64 && i + 2 < payload.length) {
          i += 3;
          continue;
        }
        // ESC ! n — emphasis
        if (n == 0x21 && i + 2 < payload.length) {
          i += 3;
          continue;
        }
        i += 2;
        continue;
      }
      if (b == 0x1D) {
        if (i + 1 >= payload.length) break;
        int n = payload[i + 1] & 0xFF;
        // GS V m — full cut
        if (n == 0x56) {
          i += Math.min(3, payload.length - i);
          continue;
        }
        i += 2;
        continue;
      }
      int start = i;
      while (i < payload.length) {
        int c = payload[i] & 0xFF;
        if (c == 0x1B || c == 0x1D) break;
        i++;
      }
      if (i > start) {
        sb.append(decodeReceiptChunk(payload, start, i));
      }
    }
    return sb.toString();
  }

  /** UTF-8 when valid multi-byte; else TIS-620 / manual Thai map (Android may lack charset). */
  static String decodeReceiptChunk(byte[] payload, int start, int end) {
    int len = end - start;
    if (len <= 0) return "";
    byte[] slice = Arrays.copyOfRange(payload, start, end);
    if (looksLikeUtf8(slice)) {
      return new String(slice, StandardCharsets.UTF_8);
    }
    Charset tis = tis620OrNull();
    if (tis != null) {
      return new String(slice, tis);
    }
    return decodeTis620Manual(slice);
  }

  private static Charset tis620OrNull() {
    for (String name : new String[] {"TIS-620", "TIS620", "ISO-8859-11", "x-windows-874"}) {
      try {
        return Charset.forName(name);
      } catch (Exception ignored) {
        /* try next */
      }
    }
    return null;
  }

  /** TIS-620 printable Thai block → Unicode (no ICU required). */
  static String decodeTis620Manual(byte[] slice) {
    StringBuilder sb = new StringBuilder(slice.length);
    for (byte value : slice) {
      int b = value & 0xFF;
      if (b < 0x80) {
        sb.append((char) b);
      } else if (b >= 0xA1 && b <= 0xDA) {
        sb.append((char) (0x0E01 + (b - 0xA1)));
      } else if (b >= 0xDF && b <= 0xFB) {
        sb.append((char) (0x0E3F + (b - 0xDF)));
      } else if (b == 0xA0) {
        sb.append('\u00A0');
      }
      /* skip undefined 0x80–0x9F / 0xDB–0xDE */
    }
    return sb.toString();
  }

  static boolean looksLikeUtf8(byte[] slice) {
    boolean sawMulti = false;
    int i = 0;
    while (i < slice.length) {
      int b = slice[i] & 0xFF;
      if (b <= 0x7F) {
        i++;
        continue;
      }
      int need;
      if ((b & 0xE0) == 0xC0) need = 1;
      else if ((b & 0xF0) == 0xE0) need = 2;
      else if ((b & 0xF8) == 0xF0) need = 3;
      else return false;
      if (i + need >= slice.length) return false;
      for (int k = 1; k <= need; k++) {
        if ((slice[i + k] & 0xC0) != 0x80) return false;
      }
      sawMulti = true;
      i += need + 1;
    }
    return sawMulti || isAsciiOnly(slice);
  }

  private static boolean isAsciiOnly(byte[] slice) {
    for (byte value : slice) {
      if ((value & 0xFF) > 0x7F) return false;
    }
    return true;
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
