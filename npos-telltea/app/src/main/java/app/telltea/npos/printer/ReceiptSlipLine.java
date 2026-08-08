package app.telltea.npos.printer;

/**
 * Structured slip row for printers that do not use monospace space-padding.
 *
 * <p>SUNMI {@code printText} uses a proportional font — ASCII spaces/dashes are ~half the width of
 * Thai glyphs, so {@link ReceiptFormBuilder#center}/{@code pairRow} look narrow on real paper.
 * InnerPrinter should print these rows via alignment / {@code printColumnsString} instead.
 */
public final class ReceiptSlipLine {
  public enum Kind {
    /** Centered text (shop name, bill no, footer, invite). */
    CENTER,
    /** Left label + right value (items, totals, tender). */
    LEFT_RIGHT,
    /** Left-aligned body (meta, options, member). */
    LEFT,
    /** Single rule across paper. */
    RULE,
    /** Double rule across paper. */
    DOUBLE_RULE,
    /** Empty feed line. */
    BLANK,
    /** Claim QR marker — printer emits bitmap QR here. */
    QR_MARK
  }

  public final Kind kind;
  public final String left;
  public final String right;
  public final boolean bold;

  private ReceiptSlipLine(Kind kind, String left, String right, boolean bold) {
    this.kind = kind;
    this.left = left == null ? "" : left;
    this.right = right == null ? "" : right;
    this.bold = bold;
  }

  public static ReceiptSlipLine center(String text, boolean bold) {
    return new ReceiptSlipLine(Kind.CENTER, text, "", bold);
  }

  public static ReceiptSlipLine leftRight(String left, String right, boolean bold) {
    return new ReceiptSlipLine(Kind.LEFT_RIGHT, left, right, bold);
  }

  public static ReceiptSlipLine left(String text, boolean bold) {
    return new ReceiptSlipLine(Kind.LEFT, text, "", bold);
  }

  public static ReceiptSlipLine rule() {
    return new ReceiptSlipLine(Kind.RULE, "", "", false);
  }

  public static ReceiptSlipLine doubleRule() {
    return new ReceiptSlipLine(Kind.DOUBLE_RULE, "", "", false);
  }

  public static ReceiptSlipLine blank() {
    return new ReceiptSlipLine(Kind.BLANK, "", "", false);
  }

  public static ReceiptSlipLine qrMark() {
    return new ReceiptSlipLine(Kind.QR_MARK, "", "", false);
  }
}
