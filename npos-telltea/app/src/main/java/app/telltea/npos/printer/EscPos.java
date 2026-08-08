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
    return documentReceipt(body, null);
  }

  /**
   * Full document with optional claim QR. When {@code claimUrl} is set and body contains {@link
   * ReceiptFormBuilder#CLAIM_QR_MARKER}, emits Esc/POS QR (model 2) at the marker.
   */
  public static byte[] documentReceipt(String body, String claimUrl) {
    List<byte[]> parts = new ArrayList<>();
    parts.add(new byte[] {0x1B, 0x40}); // init
    parts.add(new byte[] {0x1B, 0x61, 0x00}); // left (builder centers with spaces)
    String safe = ThermalSafe.ascii(body == null ? "" : body);
    String url = claimUrl == null ? "" : claimUrl.trim();
    String marker = ReceiptFormBuilder.CLAIM_QR_MARKER;
    int idx = url.isEmpty() ? -1 : safe.indexOf(marker);
    if (idx < 0) {
      // Strip leftover marker if URL missing (offline fallback).
      safe = safe.replace(marker + "\n", "").replace(marker, "");
      appendTextWithBold(parts, safe);
    } else {
      String before = safe.substring(0, idx);
      String after = safe.substring(idx + marker.length());
      if (after.startsWith("\n")) after = after.substring(1);
      appendTextWithBold(parts, before);
      appendClaimQr(parts, url);
      // Native Esc/POS QR advances the band; space-padded invite in after stacks under it.
      appendTextWithBold(parts, after);
    }
    if (!safe.endsWith("\n")) parts.add(text("\n"));
    parts.add(text("\n\n"));
    parts.add(new byte[] {0x1D, 0x56, 0x00}); // full cut
    return concat(parts);
  }

  /**
   * Drop the first body line that contains {@link ReceiptFormBuilder#CLAIM_QR_INVITE} so the
   * invite can be re-emitted centered under the QR (not as space-padded text beside it).
   */
  static String peelClaimInviteLine(String after) {
    if (after == null || after.isEmpty()) return "";
    String invite = ReceiptFormBuilder.CLAIM_QR_INVITE;
    int pos = 0;
    while (pos < after.length()) {
      int nl = after.indexOf('\n', pos);
      String line = nl < 0 ? after.substring(pos) : after.substring(pos, nl);
      String plain = stripBoldMarkers(line).trim();
      if (plain.isEmpty()) {
        pos = nl < 0 ? after.length() : nl + 1;
        continue;
      }
      if (plain.contains(invite)) {
        return nl < 0 ? "" : after.substring(nl + 1);
      }
      return after;
    }
    return "";
  }

  /** Esc/POS QR Code: Model 2 · module size 4 · ECC M — compact on 58mm. */
  static void appendClaimQr(List<byte[]> parts, String data) {
    if (data == null || data.isEmpty()) return;
    byte[] raw = data.getBytes(StandardCharsets.UTF_8);
    // Center QR block.
    parts.add(new byte[] {0x1B, 0x61, 0x01});
    // GS ( k 4 0 49 65 50 0 — model 2
    parts.add(new byte[] {0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00});
    // GS ( k 3 0 49 67 n — module size (3–16); 4 = smaller paper footprint
    parts.add(new byte[] {0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x04});
    // GS ( k 3 0 49 69 n — error correction M (49)
    parts.add(new byte[] {0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31});
    // Store: GS ( k pL pH 49 80 48 + data
    int storeLen = raw.length + 3;
    parts.add(
        new byte[] {
          0x1D,
          0x28,
          0x6B,
          (byte) (storeLen & 0xFF),
          (byte) ((storeLen >> 8) & 0xFF),
          0x31,
          0x50,
          0x30
        });
    parts.add(raw);
    // Print: GS ( k 3 0 49 81 48
    parts.add(new byte[] {0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30});
    parts.add(text("\n"));
    // Back to left for invite / footer.
    parts.add(new byte[] {0x1B, 0x61, 0x00});
  }

  /** Remove inline bold markers (for one-shot print paths that cannot toggle ESC E). */
  public static String stripBoldMarkers(String s) {
    if (s == null || s.isEmpty()) return s == null ? "" : s;
    StringBuilder sb = new StringBuilder(s.length());
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == BOLD_ON || c == BOLD_OFF) continue;
      sb.append(c);
    }
    return sb.toString();
  }

  /** Count BOLD_ON markers — used to decide Sunmi chunked vs one-shot print. */
  public static int boldOnCount(String s) {
    if (s == null || s.isEmpty()) return 0;
    int n = 0;
    for (int i = 0; i < s.length(); i++) {
      if (s.charAt(i) == BOLD_ON) n++;
    }
    return n;
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
