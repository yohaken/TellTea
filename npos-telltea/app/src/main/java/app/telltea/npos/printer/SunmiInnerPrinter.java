package app.telltea.npos.printer;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Build;

import org.json.JSONObject;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterException;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import app.telltea.npos.sell.ImageLoader;
import app.telltea.npos.sell.QrBitmaps;

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
 *
 * <p><b>Share with LINE MAN / delivery apps:</b> bind only for the job, reset font/alignment, then
 * {@code unBindService}. Holding the AIDL connection for the whole app session can leave the
 * system printer sticky so LINE MAN tickets stop printing after nPos opens or OTA-restarts.
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

  /**
   * Sale slip on InnerPrinter — full paper width via bitmap (384/576 px).
   *
   * <p>Text+columns still leave a right gap on D2s because Sunmi fonts are proportional. Painting
   * the slip onto the printable pixel width then {@code printBitmap} fills the band. Path is
   * Sunmi-sale only; USB Esc/POS unchanged. Still {@link #releaseService} so LINE MAN is unaffected.
   */
  public static PrinterTransport.Result printSlip(
      Context context, java.util.List<ReceiptSlipLine> lines, String claimUrl) {
    return printSlip(context, lines, claimUrl, null);
  }

  /**
   * @param shop optional shopJson — when present and logo enabled, brandLogo is drawn on the slip.
   */
  public static PrinterTransport.Result printSlip(
      Context context,
      java.util.List<ReceiptSlipLine> lines,
      String claimUrl,
      JSONObject shop) {
    String url = claimUrl == null ? "" : claimUrl.trim();
    Bitmap shopLogo = null;
    Bitmap slipForBo = null;
    boolean printedOk = false;
    try {
      SunmiPrinterService svc = ensureService(context);
      if (svc == null) {
        return new PrinterTransport.Result(
            false, "ไม่พบบริการปริ้น SUNMI — เครื่องนี้มี InnerPrinter หรือยัง?");
      }
      if (!InnerPrinterManager.getInstance().hasPrinter(svc)) {
        return new PrinterTransport.Result(false, "เครื่องนี้ไม่มีปริ้นในตัว");
      }
      resetPrinterDefaults(svc);
      int paperMm = syncPaperWidthFromPrinter(context, svc);

      // Fail-open: bad/missing logo never blocks the sale slip.
      if (ReceiptFormBuilder.shouldPrintShopLogo(shop)) {
        try {
          shopLogo = ImageLoader.decode(shop.optString("brandLogo", "").trim());
        } catch (Exception ignored) {
          shopLogo = null;
        }
      }

      Bitmap slip = SunmiSlipBitmap.render(lines, url, paperMm, shopLogo);
      if (slip != null) {
        PrinterTransport.Result bmpRes = printBitmapBands(svc, slip);
        if (!bmpRes.ok) return bmpRes;
        slipForBo = slip; // upload after release — same pixels staff saw on paper
      } else {
        // Fallback: structured columns (better than space-padded printText).
        int qrPx = SunmiSlipBitmap.claimQrPx(paperMm);
        int ruleChars = paperMm == PrinterPrefs.PAPER_58 ? 22 : 32;
        if (lines != null) {
          for (ReceiptSlipLine line : lines) {
            if (line == null) continue;
            PrinterTransport.Result row = printSlipLine(svc, line, url, qrPx, ruleChars);
            if (!row.ok) return row;
          }
        }
      }

      try {
        svc.lineWrap(2, null);
      } catch (Exception ignored) {
        /* optional */
      }
      PrinterTransport.Result cut = cutPaperBestEffort(svc, "SUNMI พิมพ์ใบเสร็จแล้ว");
      resetPrinterDefaults(svc);
      printedOk = cut != null && cut.ok;
      return cut;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new PrinterTransport.Result(false, "interrupted");
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      return new PrinterTransport.Result(false, msg);
    } finally {
      releaseService();
      // After printer is free (LINE MAN share) — send rendered slip to BO.
      if (printedOk && slipForBo != null) {
        String billHint = "";
        if (lines != null) {
          for (ReceiptSlipLine line : lines) {
            if (line != null && line.kind == ReceiptSlipLine.Kind.CENTER && line.bold) {
              billHint = line.left == null ? "" : line.left.trim();
              break;
            }
          }
        }
        app.telltea.npos.diagnose.SlipCaptureUpload.uploadPrintedSlip(context, slipForBo, billHint);
      }
    }
  }

  /** Print tall slip as horizontal bands (Sunmi image size limits). */
  private static PrinterTransport.Result printBitmapBands(SunmiPrinterService svc, Bitmap full)
      throws Exception {
    if (full == null) return new PrinterTransport.Result(true, "ok");
    try {
      svc.setAlignment(1, null);
    } catch (Exception ignored) {
      /* optional — full-width bitmap is already paper-wide */
    }
    final int maxBand = 1600;
    int h = full.getHeight();
    int w = full.getWidth();
    int y = 0;
    while (y < h) {
      int bandH = Math.min(maxBand, h - y);
      Bitmap band = bandH == h ? full : Bitmap.createBitmap(full, 0, y, w, bandH);
      PrinterTransport.Result r = printBitmapOnce(svc, band);
      if (band != full) band.recycle();
      if (!r.ok) return r;
      boolean wrapped = false;
      try {
        svc.lineWrap(1, null);
        wrapped = true;
      } catch (Exception ignored) {
        /* optional */
      }
      if (!wrapped) {
        PrinterTransport.Result feed = printTextOnce(svc, "\n");
        if (!feed.ok) return feed;
      }
      y += bandH;
    }
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    return new PrinterTransport.Result(true, "ok");
  }

  /**
   * Legacy plain+marker path — prefer {@link #printSlip}. Kept for callers that only have a body
   * string; falls back to structured-less UTF print.
   */
  public static PrinterTransport.Result printPlainWithClaimQr(
      Context context, String body, String claimUrl) {
    String safe = body == null ? "" : body;
    String url = claimUrl == null ? "" : claimUrl.trim();
    String marker = ReceiptFormBuilder.CLAIM_QR_MARKER;
    if (url.isEmpty() || safe.indexOf(marker) < 0) {
      safe = safe.replace(marker + "\n", "").replace(marker, "");
      return printPlain(context, EscPos.stripBoldMarkers(safe));
    }
    // Best-effort: rebuild is unavailable here — use slip printer only when lines exist upstream.
    return printPlain(context, EscPos.stripBoldMarkers(safe.replace(marker, "\n")));
  }

  /** {@code getPrinterPaper}: 0 → 80mm, 1 → 58mm. Writes {@link PrinterPrefs}. */
  static int syncPaperWidthFromPrinter(Context context, SunmiPrinterService svc) {
    int fallback = PrinterPrefs.getPaperWidthMm(context);
    if (svc == null) return fallback;
    try {
      int code = svc.getPrinterPaper();
      int mm = code == 1 ? PrinterPrefs.PAPER_58 : PrinterPrefs.PAPER_80;
      PrinterPrefs.setPaperWidthMm(context, mm);
      return mm;
    } catch (Exception ignored) {
      return fallback;
    }
  }

  private static PrinterTransport.Result printSlipLine(
      SunmiPrinterService svc, ReceiptSlipLine line, String claimUrl, int qrPx, int ruleChars)
      throws Exception {
    switch (line.kind) {
      case BLANK:
        return printTextOnce(svc, "\n");
      case RULE:
        return printFullRule(svc, '─', ruleChars);
      case DOUBLE_RULE:
        return printFullRule(svc, '═', ruleChars);
      case CENTER:
        return printCentered(svc, line.left, line.bold);
      case LEFT:
        return printLeft(svc, line.left, line.bold);
      case LEFT_RIGHT:
        return printLeftRight(svc, line.left, line.right, line.bold);
      case QR_MARK:
        return printClaimQrBlock(svc, claimUrl, qrPx);
      default:
        return new PrinterTransport.Result(true, "ok");
    }
  }

  private static PrinterTransport.Result printFullRule(
      SunmiPrinterService svc, char ch, int count) throws Exception {
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    StringBuilder sb = new StringBuilder(count + 1);
    for (int i = 0; i < count; i++) sb.append(ch);
    sb.append('\n');
    // Full-width glyphs (─ / ═) match Thai cell width → rule spans the paper.
    return printColumnsOnce(svc, new String[] {sb.toString().trim()}, new int[] {1}, new int[] {0});
  }

  private static PrinterTransport.Result printCentered(
      SunmiPrinterService svc, String text, boolean bold) throws Exception {
    String t = text == null ? "" : text.trim();
    if (t.isEmpty()) return printTextOnce(svc, "\n");
    try {
      svc.setAlignment(1, null);
    } catch (Exception ignored) {
      /* optional */
    }
    if (bold) sendEscE(svc, true);
    // Invite: slightly larger on InnerPrinter when possible.
    if (ReceiptFormBuilder.CLAIM_QR_INVITE.equals(t)) {
      try {
        svc.setFontSize(28, null);
      } catch (Exception ignored) {
        /* optional */
      }
    }
    PrinterTransport.Result r = printTextOnce(svc, t + "\n");
    if (ReceiptFormBuilder.CLAIM_QR_INVITE.equals(t)) {
      try {
        svc.setFontSize(24, null);
      } catch (Exception ignored) {
        /* optional */
      }
    }
    if (bold) sendEscE(svc, false);
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    return r;
  }

  private static PrinterTransport.Result printLeft(
      SunmiPrinterService svc, String text, boolean bold) throws Exception {
    String t = text == null ? "" : text;
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    if (bold) sendEscE(svc, true);
    PrinterTransport.Result r = printTextOnce(svc, t.endsWith("\n") ? t : t + "\n");
    if (bold) sendEscE(svc, false);
    return r;
  }

  private static PrinterTransport.Result printLeftRight(
      SunmiPrinterService svc, String left, String right, boolean bold) throws Exception {
    if (bold) sendEscE(svc, true);
    // Weights: label wider, price snug on the right edge of the full paper band.
    PrinterTransport.Result r =
        printColumnsOnce(
            svc,
            new String[] {left == null ? "" : left, right == null ? "" : right},
            new int[] {2, 1},
            new int[] {0, 2});
    if (bold) sendEscE(svc, false);
    return r;
  }

  private static PrinterTransport.Result printClaimQrBlock(
      SunmiPrinterService svc, String claimUrl, int qrPx) throws Exception {
    String url = claimUrl == null ? "" : claimUrl.trim();
    if (url.isEmpty()) return new PrinterTransport.Result(true, "ok");
    Bitmap qr = QrBitmaps.encode(url, qrPx);
    if (qr == null) return new PrinterTransport.Result(true, "ok");
    try {
      svc.setAlignment(1, null);
    } catch (Exception ignored) {
      /* optional */
    }
    PrinterTransport.Result qrRes = printBitmapOnce(svc, qr);
    if (!qrRes.ok) return qrRes;
    boolean wrapped = false;
    try {
      svc.lineWrap(1, null);
      wrapped = true;
    } catch (Exception ignored) {
      /* fall through */
    }
    if (!wrapped) {
      PrinterTransport.Result feed = printTextOnce(svc, "\n");
      if (!feed.ok) return feed;
    }
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    return new PrinterTransport.Result(true, "ok");
  }

  private static PrinterTransport.Result printColumnsOnce(
      SunmiPrinterService svc, String[] texts, int[] widths, int[] aligns) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
    svc.printColumnsString(
        texts,
        widths,
        aligns,
        latchCallback(
            out,
            done,
            new PrinterTransport.Result(true, "ok"),
            new PrinterTransport.Result(false, "SUNMI printColumnsString ไม่สำเร็จ")));
    if (!done.await(20, TimeUnit.SECONDS)) {
      return new PrinterTransport.Result(false, "SUNMI timeout (printColumnsString)");
    }
    PrinterTransport.Result r = out.get();
    return r != null ? r : new PrinterTransport.Result(false, "SUNMI ไม่ตอบ");
  }

  private static PrinterTransport.Result printBitmapOnce(SunmiPrinterService svc, Bitmap bmp)
      throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
    svc.printBitmap(
        bmp,
        latchCallback(
            out,
            done,
            new PrinterTransport.Result(true, "ok"),
            new PrinterTransport.Result(false, "SUNMI printBitmap ไม่สำเร็จ")));
    if (!done.await(20, TimeUnit.SECONDS)) {
      return new PrinterTransport.Result(false, "SUNMI timeout (printBitmap)");
    }
    PrinterTransport.Result r = out.get();
    return r != null ? r : new PrinterTransport.Result(false, "SUNMI ไม่ตอบ");
  }

  /**
   * UTF text path — same family as stock SUNMI / Wongnai receipts.
   *
   * <p>Always one-shot {@code printText} (bold ESC E markers stripped). Chunked bold toggles used
   * many AIDL round-trips and made cash slips feel slow; X/Z already needed one-shot to avoid
   * mid-slip abort on InnerPrinter.
   */
  public static PrinterTransport.Result printPlain(Context context, String text) {
    String body = text == null ? "" : text;
    if (!body.endsWith("\n")) body = body + "\n";
    boolean longDoc = EscPos.boldOnCount(body) >= 6 || body.length() >= 1200;
    try {
      SunmiPrinterService svc = ensureService(context);
      if (svc == null) {
        return new PrinterTransport.Result(
            false, "ไม่พบบริการปริ้น SUNMI — เครื่องนี้มี InnerPrinter หรือยัง?");
      }
      if (!InnerPrinterManager.getInstance().hasPrinter(svc)) {
        return new PrinterTransport.Result(false, "เครื่องนี้ไม่มีปริ้นในตัว");
      }
      resetPrinterDefaults(svc);
      PrinterTransport.Result printed = printTextOnce(svc, EscPos.stripBoldMarkers(body));
      if (!printed.ok) return printed;
      try {
        svc.lineWrap(2, null);
      } catch (Exception ignored) {
        /* optional */
      }
      PrinterTransport.Result cut =
          cutPaperBestEffort(
              svc, longDoc ? "SUNMI พิมพ์สรุปรอบแล้ว" : "SUNMI พิมพ์ไทยแล้ว");
      resetPrinterDefaults(svc);
      return cut;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new PrinterTransport.Result(false, "interrupted");
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      return new PrinterTransport.Result(false, msg);
    } finally {
      releaseService();
    }
  }

  /** One-shot printText (no inline bold). */
  private static PrinterTransport.Result printTextOnce(SunmiPrinterService svc, String body)
      throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
    svc.printText(
        body,
        latchCallback(
            out,
            done,
            new PrinterTransport.Result(true, "ok"),
            new PrinterTransport.Result(false, "SUNMI printText ไม่สำเร็จ")));
    if (!done.await(20, TimeUnit.SECONDS)) {
      return new PrinterTransport.Result(false, "SUNMI timeout (printText)");
    }
    PrinterTransport.Result r = out.get();
    return r != null ? r : new PrinterTransport.Result(false, "SUNMI ไม่ตอบ");
  }

  /**
   * Walk bold markers: flush text → ESC E on/off → more text. Keeps Thai on printText path.
   * Bold toggle failures are ignored so the rest of the slip still prints.
   */
  private static PrinterTransport.Result printTextBoldSegments(
      SunmiPrinterService svc, String body) throws Exception {
    StringBuilder acc = new StringBuilder();
    boolean bold = false;
    for (int i = 0; i < body.length(); i++) {
      char c = body.charAt(i);
      if (c == EscPos.BOLD_ON) {
        PrinterTransport.Result flush = flushAccPrintText(svc, acc);
        if (!flush.ok) return flush;
        sendEscE(svc, true); // best-effort — do not abort the slip
        bold = true;
      } else if (c == EscPos.BOLD_OFF) {
        PrinterTransport.Result flush = flushAccPrintText(svc, acc);
        if (!flush.ok) return flush;
        sendEscE(svc, false);
        bold = false;
      } else {
        acc.append(c);
      }
    }
    PrinterTransport.Result flush = flushAccPrintText(svc, acc);
    if (!flush.ok) return flush;
    if (bold) {
      sendEscE(svc, false);
    }
    return new PrinterTransport.Result(true, "SUNMI พิมพ์ไทย (ตัวหนา) แล้ว");
  }

  private static PrinterTransport.Result flushAccPrintText(
      SunmiPrinterService svc, StringBuilder acc) throws Exception {
    if (acc.length() == 0) return new PrinterTransport.Result(true, "ok");
    String chunk = acc.toString();
    acc.setLength(0);
    return printTextOnce(svc, chunk);
  }

  private static PrinterTransport.Result sendEscE(SunmiPrinterService svc, boolean on)
      throws Exception {
    byte[] cmd = new byte[] {0x1B, 0x45, (byte) (on ? 0x01 : 0x00)};
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
    svc.sendRAWData(
        cmd,
        latchCallback(
            out,
            done,
            new PrinterTransport.Result(true, "ok"),
            new PrinterTransport.Result(false, "SUNMI bold ไม่สำเร็จ")));
    if (!done.await(8, TimeUnit.SECONDS)) {
      return new PrinterTransport.Result(false, "SUNMI timeout (bold)");
    }
    PrinterTransport.Result r = out.get();
    return r != null ? r : new PrinterTransport.Result(false, "SUNMI bold ไม่ตอบ");
  }

  private static InnerResultCallback latchCallback(
      AtomicReference<PrinterTransport.Result> out,
      CountDownLatch done,
      PrinterTransport.Result ok,
      PrinterTransport.Result fail) {
    return new InnerResultCallback() {
      @Override
      public void onRunResult(boolean isSuccess) {
        out.set(isSuccess ? ok : fail);
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
          out.set(
              code == 0
                  ? ok
                  : new PrinterTransport.Result(false, "SUNMI printResult " + code + " " + msg));
          done.countDown();
        }
      }
    };
  }

  private static PrinterTransport.Result cutPaperBestEffort(
      SunmiPrinterService svc, String okMsg) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<PrinterTransport.Result> out = new AtomicReference<>();
    try {
      svc.cutPaper(
          new InnerResultCallback() {
            @Override
            public void onRunResult(boolean cutOk) {
              out.set(
                  new PrinterTransport.Result(
                      true, okMsg + (cutOk ? "" : " (ตัดกระดาษข้าม)")));
              done.countDown();
            }

            @Override
            public void onReturnString(String result) {}

            @Override
            public void onRaiseException(int code, String msg) {
              out.set(new PrinterTransport.Result(true, okMsg + " (ตัดกระดาษข้าม)"));
              done.countDown();
            }

            @Override
            public void onPrintResult(int code, String msg) {
              if (out.get() == null) {
                out.set(new PrinterTransport.Result(true, okMsg));
                done.countDown();
              }
            }
          });
      if (!done.await(8, TimeUnit.SECONDS)) {
        return new PrinterTransport.Result(true, okMsg);
      }
      PrinterTransport.Result r = out.get();
      return r != null ? r : new PrinterTransport.Result(true, okMsg);
    } catch (Exception cutErr) {
      return new PrinterTransport.Result(true, okMsg);
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
      resetPrinterDefaults(svc);
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
      resetPrinterDefaults(svc);
      return r != null ? r : new PrinterTransport.Result(false, "SUNMI ไม่ตอบ");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return new PrinterTransport.Result(false, "interrupted");
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      return new PrinterTransport.Result(false, msg);
    } finally {
      releaseService();
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
    } finally {
      releaseService();
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
        // ESC E n — keep as bold markers for printPlain chunked bold
        if (n == 0x45 && i + 2 < payload.length) {
          int mode = payload[i + 2] & 0xFF;
          sb.append(mode != 0 ? EscPos.BOLD_ON : EscPos.BOLD_OFF);
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

  /** Clear bold / font / alignment so the next app (LINE MAN) starts clean. */
  static void resetPrinterDefaults(SunmiPrinterService svc) {
    if (svc == null) return;
    try {
      svc.printerInit(null);
    } catch (Exception ignored) {
      /* optional on some firmwares */
    }
    try {
      svc.setFontSize(24, null);
    } catch (Exception ignored) {
      /* optional */
    }
    try {
      svc.setAlignment(0, null);
    } catch (Exception ignored) {
      /* optional */
    }
    try {
      sendEscE(svc, false);
    } catch (Exception ignored) {
      /* optional */
    }
  }

  /**
   * Drop AIDL bind after each job so delivery apps can connect to InnerPrinter.
   * Safe to call when not bound.
   */
  static void releaseService() {
    synchronized (LOCK) {
      Context ctx = appCtx;
      InnerPrinterCallback cb = boundCallback;
      service = null;
      boundCallback = null;
      if (ctx == null || cb == null) return;
      try {
        InnerPrinterManager.getInstance().unBindService(ctx, cb);
      } catch (Exception ignored) {
        /* best-effort — never block the sale path */
      }
    }
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
        boundCallback = null;
        return null;
      }
      if (!connected.await(8, TimeUnit.SECONDS)) {
        try {
          InnerPrinterManager.getInstance().unBindService(appCtx, cb);
        } catch (Exception ignored) {
          /* optional */
        }
        boundCallback = null;
        return null;
      }
      return got.get();
    }
  }
}
