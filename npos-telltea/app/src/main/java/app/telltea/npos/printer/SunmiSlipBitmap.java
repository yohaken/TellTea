package app.telltea.npos.printer;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.TextPaint;

import app.telltea.npos.sell.QrBitmaps;

import java.util.ArrayList;
import java.util.List;

/**
 * Renders a sale slip to a bitmap matching the InnerPrinter printable width.
 *
 * <p>Sunmi {@code printText} / space-padding cannot fill 80mm paper (proportional Thai fonts).
 * Painting onto 384/576 px and {@code printBitmap} uses the full band — isolated to the nPos
 * Sunmi sale path; USB Esc/POS and other apps are untouched.
 */
public final class SunmiSlipBitmap {
  /** Active print pixels — Sunmi docs: 58mm→384, 80mm→576. */
  public static final int WIDTH_58 = 384;
  public static final int WIDTH_80 = 576;

  private static final int PAD_X = 8;
  private static final float BODY_SP = 22f;
  private static final float TITLE_SP = 28f;
  private static final float INVITE_SP = 30f;
  private static final float LINE_GAP = 6f;

  private SunmiSlipBitmap() {}

  public static int paperWidthPx(int paperMm) {
    return paperMm == PrinterPrefs.PAPER_58 ? WIDTH_58 : WIDTH_80;
  }

  public static int claimQrPx(int paperMm) {
    return paperMm == PrinterPrefs.PAPER_58 ? 200 : 280;
  }

  /** Null when nothing to draw. */
  public static Bitmap render(
      List<ReceiptSlipLine> lines, String claimUrl, int paperMm) {
    if (lines == null || lines.isEmpty()) return null;
    int width = paperWidthPx(paperMm);
    int contentW = width - PAD_X * 2;
    int qrPx = claimQrPx(paperMm);

    TextPaint body = makePaint(BODY_SP, false);
    TextPaint bodyBold = makePaint(BODY_SP, true);
    TextPaint title = makePaint(TITLE_SP, true);
    TextPaint invite = makePaint(INVITE_SP, true);
    Paint rulePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    rulePaint.setColor(Color.BLACK);
    rulePaint.setStrokeWidth(2f);

    List<DrawOp> ops = new ArrayList<>();
    float y = 8f;
    String url = claimUrl == null ? "" : claimUrl.trim();

    for (ReceiptSlipLine line : lines) {
      if (line == null) continue;
      switch (line.kind) {
        case BLANK:
          y += BODY_SP * 0.55f;
          break;
        case RULE:
          ops.add(DrawOp.rule(y, false));
          y += 10f;
          break;
        case DOUBLE_RULE:
          ops.add(DrawOp.rule(y, true));
          y += 14f;
          break;
        case CENTER:
          {
            TextPaint p =
                ReceiptFormBuilder.CLAIM_QR_INVITE.equals(line.left)
                    ? invite
                    : (line.bold ? title : body);
            String t = line.left == null ? "" : line.left;
            for (String part : wrapPaint(t, p, contentW)) {
              ops.add(DrawOp.center(part, y, p));
              y += p.getTextSize() + LINE_GAP;
            }
          }
          break;
        case LEFT:
          {
            TextPaint p = line.bold ? bodyBold : body;
            String t = line.left == null ? "" : line.left;
            for (String part : wrapPaint(t, p, contentW)) {
              ops.add(DrawOp.left(part, y, p));
              y += p.getTextSize() + LINE_GAP;
            }
          }
          break;
        case LEFT_RIGHT:
          {
            TextPaint p = line.bold ? bodyBold : body;
            String left = line.left == null ? "" : line.left;
            String right = line.right == null ? "" : line.right;
            float rightW = p.measureText(right);
            float leftMax = Math.max(8f, contentW - rightW - 12f);
            List<String> leftParts = wrapPaint(left, p, leftMax);
            if (leftParts.isEmpty()) leftParts.add("");
            for (int i = 0; i < leftParts.size(); i++) {
              String lp = leftParts.get(i);
              String rp = i == 0 ? right : "";
              ops.add(DrawOp.leftRight(lp, rp, y, p));
              y += p.getTextSize() + LINE_GAP;
            }
          }
          break;
        case QR_MARK:
          if (!url.isEmpty()) {
            Bitmap qr = QrBitmaps.encode(url, qrPx);
            if (qr != null) {
              y += 8f;
              ops.add(DrawOp.qr(qr, y));
              y += qr.getHeight() + 10f;
            }
          }
          break;
        default:
          break;
      }
    }
    y += 12f;
    int height = Math.max(32, (int) Math.ceil(y));
    Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    canvas.drawColor(Color.WHITE);

    for (DrawOp op : ops) {
      switch (op.kind) {
        case RULE:
          {
            float yy = op.y;
            canvas.drawLine(PAD_X, yy, width - PAD_X, yy, rulePaint);
            if (op.doubleRule) {
              canvas.drawLine(PAD_X, yy + 4f, width - PAD_X, yy + 4f, rulePaint);
            }
          }
          break;
        case CENTER:
          {
            float tw = op.paint.measureText(op.text);
            float x = (width - tw) / 2f;
            canvas.drawText(op.text, x, op.y + op.paint.getTextSize(), op.paint);
          }
          break;
        case LEFT:
          canvas.drawText(op.text, PAD_X, op.y + op.paint.getTextSize(), op.paint);
          break;
        case LEFT_RIGHT:
          {
            float baseline = op.y + op.paint.getTextSize();
            canvas.drawText(op.text, PAD_X, baseline, op.paint);
            if (op.right != null && !op.right.isEmpty()) {
              float rw = op.paint.measureText(op.right);
              canvas.drawText(op.right, width - PAD_X - rw, baseline, op.paint);
            }
          }
          break;
        case QR:
          if (op.qr != null) {
            float x = (width - op.qr.getWidth()) / 2f;
            canvas.drawBitmap(op.qr, x, op.y, null);
          }
          break;
        default:
          break;
      }
    }
    return bmp;
  }

  private static TextPaint makePaint(float sizePx, boolean bold) {
    TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    p.setColor(Color.BLACK);
    p.setTextSize(sizePx);
    p.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    p.setElegantTextHeight(true);
    return p;
  }

  private static List<String> wrapPaint(String text, TextPaint paint, float maxWidth) {
    List<String> out = new ArrayList<>();
    String t = text == null ? "" : text;
    if (t.isEmpty()) {
      out.add("");
      return out;
    }
    if (paint.measureText(t) <= maxWidth) {
      out.add(t);
      return out;
    }
    StringBuilder acc = new StringBuilder();
    for (int i = 0; i < t.length(); ) {
      int cp = t.codePointAt(i);
      int n = Character.charCount(cp);
      String next = acc.toString() + new String(Character.toChars(cp));
      if (acc.length() > 0 && paint.measureText(next) > maxWidth) {
        out.add(acc.toString());
        acc.setLength(0);
      }
      acc.appendCodePoint(cp);
      i += n;
    }
    if (acc.length() > 0) out.add(acc.toString());
    return out;
  }

  private static final class DrawOp {
    enum Kind {
      RULE,
      CENTER,
      LEFT,
      LEFT_RIGHT,
      QR
    }

    final Kind kind;
    final String text;
    final String right;
    final float y;
    final TextPaint paint;
    final Bitmap qr;
    final boolean doubleRule;

    private DrawOp(
        Kind kind, String text, String right, float y, TextPaint paint, Bitmap qr, boolean doubleRule) {
      this.kind = kind;
      this.text = text;
      this.right = right;
      this.y = y;
      this.paint = paint;
      this.qr = qr;
      this.doubleRule = doubleRule;
    }

    static DrawOp rule(float y, boolean dbl) {
      return new DrawOp(Kind.RULE, "", "", y, null, null, dbl);
    }

    static DrawOp center(String text, float y, TextPaint paint) {
      return new DrawOp(Kind.CENTER, text, "", y, paint, null, false);
    }

    static DrawOp left(String text, float y, TextPaint paint) {
      return new DrawOp(Kind.LEFT, text, "", y, paint, null, false);
    }

    static DrawOp leftRight(String left, String right, float y, TextPaint paint) {
      return new DrawOp(Kind.LEFT_RIGHT, left, right, y, paint, null, false);
    }

    static DrawOp qr(Bitmap bmp, float y) {
      return new DrawOp(Kind.QR, "", "", y, null, bmp, false);
    }
  }
}
