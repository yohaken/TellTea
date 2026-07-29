package app.telltea.npos.printer;

/**
 * Make paper body safe for Thai thermal printers that encode as TIS-620.
 *
 * <p>Many USB/BT/LAN printers replace unknown glyphs with {@code ?}. This helper
 * rewrites common “pretty” Unicode (× • … — · − …) to ASCII before bytes go out.
 * Applied as a final pass in {@link EscPos#documentReceipt} so every document
 * (sale, reprint, X, Z, test) is covered — not one slip at a time.
 */
public final class ThermalSafe {
  private ThermalSafe() {}

  /** Rewrite unsafe glyphs; keep Thai, ASCII, newlines, and EscPos bold markers. */
  public static String ascii(String input) {
    if (input == null || input.isEmpty()) return input == null ? "" : input;
    StringBuilder sb = new StringBuilder(input.length() + 8);
    for (int i = 0; i < input.length(); ) {
      int cp = input.codePointAt(i);
      i += Character.charCount(cp);
      switch (cp) {
        case 0x00D7: // ×
          sb.append('x');
          break;
        case 0x2022: // •
        case 0x00B7: // ·
          sb.append('-');
          break;
        case 0x2026: // …
          sb.append("...");
          break;
        case 0x2014: // —
        case 0x2013: // –
        case 0x2212: // −
          sb.append('-');
          break;
        case 0x201C: // “
        case 0x201D: // ”
        case 0x2018: // ‘
        case 0x2019: // ’
          sb.append('\'');
          break;
        case 0x2713: // ✓
        case 0x2714: // ✔
          sb.append('v');
          break;
        case 0x2605: // ★
          sb.append('*');
          break;
        case 0x2192: // →
          sb.append("->");
          break;
        case 0x2190: // ←
          sb.append("<-");
          break;
        case 0x00A0: // nbsp
          sb.append(' ');
          break;
        default:
          if (cp == EscPos.BOLD_ON || cp == EscPos.BOLD_OFF) {
            sb.append((char) cp);
          } else if (cp == '\n' || cp == '\r' || cp == '\t' || cp >= 32) {
            sb.appendCodePoint(cp);
          }
          // drop other C0 controls
          break;
      }
    }
    return sb.toString();
  }

  /** True if any code point is outside ASCII + Thai + EscPos markers (pre-sanitize check). */
  public static boolean hasRiskyGlyph(String input) {
    if (input == null || input.isEmpty()) return false;
    for (int i = 0; i < input.length(); ) {
      int cp = input.codePointAt(i);
      i += Character.charCount(cp);
      if (cp == EscPos.BOLD_ON || cp == EscPos.BOLD_OFF) continue;
      if (cp == '\n' || cp == '\r' || cp == '\t') continue;
      if (cp >= 0x20 && cp <= 0x7E) continue; // printable ASCII
      if (cp >= 0x0E01 && cp <= 0x0E5B) continue; // Thai
      return true;
    }
    return false;
  }
}
