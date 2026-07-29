package app.telltea.npos.printer;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Minimal ESC/POS helpers for test page + cash-drawer kick.
 *
 * <p>Customer / shift documents use {@link #documentReceipt(String)} so the body owns shop branding
 * — never inject product brand ("TellTea") on paper.
 *
 * <p>Inline emphasis: body may contain {@link #BOLD_ON}/{@link #BOLD_OFF} markers (not printable).
 * They become {@code ESC E} for USB/BT/LAN printers. Prefer ASCII {@code x}/{@code -} in the body —
 * Unicode {@code ×}/{@code •} become {@code ?} under TIS-620 on many Thai thermal printers.
 */
public final class EscPos {
  /** Start bold segment in receipt body text (stripped / converted before paper). */
  public static final char BOLD_ON = '\u0001';
  /** End bold segment. */
  public static final char BOLD_OFF = '\u0002';

  private EscPos() {}

  /** ESC p m t1 t2 — pulse drawer pin 2 (common default). */
  public static byte[] drawerKick() {
    return new byte[] {0x1B, 0x70, 0x00, 0x19, (byte) 0xFA};
  }

  /** Hardware install test page only — not a customer document. */
  public static byte[] testReceipt(String versionName, int versionCode, String endpointLabel) {
    List<byte[]> parts = new ArrayList<>();
    parts.add(new byte[] {0x1B, 0x40}); // init
    parts.add(new byte[] {0x1B, 0x61, 0x01}); // center
    parts.add(text("PRINTER TEST\n"));
    parts.add(text("ติดตั้งเครื่องพิมพ์\n"));
    parts.add(new byte[] {0x1B, 0x61, 0x00}); // left
    parts.add(text("----------------\n"));
    parts.add(text("ver " + safe(versionName) + " (" + versionCode + ")\n"));
    parts.add(text("via " + safe(endpointLabel) + "\n"));
    parts.add(text("ok if this paper prints\n"));
    parts.add(text("----------------\n\n\n"));
    parts.add(new byte[] {0x1D, 0x56, 0x00}); // full cut (many ignore harmlessly)
    return concat(parts);
  }

  /**
   * @deprecated Prefer {@link #documentReceipt(String)} — body already has shop header. Kept as
   *     alias so callers do not accidentally reintroduce product branding.
   */
  public static byte[] saleReceipt(String body) {
    return documentReceipt(body);
  }

  /**
   * Full document — body already includes shop/bill/totals (see {@link ReceiptFormBuilder} / {@link
   * ShiftReportFormBuilder}). No extra brand header.
   */
  public static byte[] documentReceipt(String body) {
    List<byte[]> parts = new ArrayList<>();
    parts.add(new byte[] {0x1B, 0x40}); // init
    parts.add(new byte[] {0x1B, 0x61, 0x00}); // left (builder centers with spaces)
    // Final safety net: every paper doc (sale / X / Z / reprint) — no TIS "?" glyphs.
    String safe = ThermalSafe.ascii(body == null ? "" : body);
    appendTextWithBold(parts, safe);
    if (!safe.endsWith("\n")) parts.add(text("\n"));
    parts.add(text("\n\n"));
    parts.add(new byte[] {0x1D, 0x56, 0x00}); // full cut
    return concat(parts);
  }

  /** Emit TIS-620 text with {@code ESC E} around {@link #BOLD_ON}/{@link #BOLD_OFF} segments. */
  static void appendTextWithBold(List<byte[]> parts, String s) {
    if (s == null || s.isEmpty()) return;
    StringBuilder acc = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == BOLD_ON) {
        flushText(parts, acc);
        parts.add(new byte[] {0x1B, 0x45, 0x01}); // bold on
      } else if (c == BOLD_OFF) {
        flushText(parts, acc);
        parts.add(new byte[] {0x1B, 0x45, 0x00}); // bold off
      } else {
        acc.append(c);
      }
    }
    flushText(parts, acc);
  }

  private static void flushText(List<byte[]> parts, StringBuilder acc) {
    if (acc.length() == 0) return;
    parts.add(text(acc.toString()));
    acc.setLength(0);
  }

  private static String safe(String s) {
    if (s == null || s.trim().isEmpty()) return "-";
    String t = s.trim();
    return t.length() > 40 ? t.substring(0, 40) : t;
  }

  private static byte[] text(String s) {
    // Prefer TIS-620 when available; fall back to ASCII-ish UTF-8 bytes.
    try {
      Charset tis = Charset.forName("TIS-620");
      return s.getBytes(tis);
    } catch (Exception e) {
      return s.getBytes(StandardCharsets.UTF_8);
    }
  }

  private static byte[] concat(List<byte[]> parts) {
    int n = 0;
    for (byte[] p : parts) n += p.length;
    byte[] out = new byte[n];
    int o = 0;
    for (byte[] p : parts) {
      System.arraycopy(p, 0, out, o, p.length);
      o += p.length;
    }
    return out;
  }
}
