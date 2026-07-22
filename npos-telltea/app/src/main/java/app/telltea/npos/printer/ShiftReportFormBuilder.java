package app.telltea.npos.printer;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * ESC/POS plain-text for X (mid-shift snapshot) and Z (blind close) reports.
 *
 * Front-counter only — cash + PromptPay. No delivery / dine-in channel blocks.
 * Signature lines on Z are blank for handwritten confirm (Wongnai-style slip).
 */
public final class ShiftReportFormBuilder {
  public static final int COLS_80 = 42;

  private static final String DEFAULT_SHOP_EN = "TELL TEA";
  private static final String DEFAULT_SHOP_TH = "เทล ที";
  private static final String DEFAULT_ADDRESS =
      "ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี";
  private static final String DEFAULT_PHONE = "0884818817";

  private ShiftReportFormBuilder() {}

  public static String build(
      JSONObject shop,
      String kind,
      String shift,
      String sessionId,
      long openedAt,
      long closedOrPrintedAt,
      int saleCount,
      int voidedCount,
      int cashBills,
      double cashSales,
      int promptpayBills,
      double promptpaySales,
      double discountTotal,
      double openingCash,
      Double countedCash,
      Double expectedCash,
      Double cashDifference,
      String discrepancyLabel,
      double leaveFloat,
      String discrepancyNote,
      int cols) {
    int width = cols <= 0 ? COLS_80 : cols;
    boolean isClose = "close".equals(kind);

    String shopEn = firstNonEmpty(opt(shop, "shopName"), DEFAULT_SHOP_EN);
    String shopTh = firstNonEmpty(opt(shop, "shopNameTh"), DEFAULT_SHOP_TH);
    String shopName = shopDisplayName(shopEn, shopTh);
    String shopAddress = firstNonEmpty(opt(shop, "shopAddress"), DEFAULT_ADDRESS);
    String shopPhone = firstNonEmpty(opt(shop, "shopPhone"), DEFAULT_PHONE);
    String staff = firstNonEmpty(opt(shop, "receiptStaffName"), "หน้าร้าน");

    StringBuilder sb = new StringBuilder();
    sb.append(center(shopName, width)).append('\n');
    if (!shopAddress.isEmpty()) {
      for (String part : wrap(shopAddress, width)) {
        sb.append(center(part, width)).append('\n');
      }
    }
    if (!shopPhone.isEmpty()) {
      sb.append(center("โทร : " + shopPhone, width)).append('\n');
    }
    sb.append(rule(width)).append('\n');
    sb.append(center(isClose ? "ปิดรอบ / Z-REPORT" : "Snapshot / X-REPORT", width))
        .append('\n');
    sb.append(rule(width)).append('\n');

    sb.append(pairRow("พนักงาน", staff, width)).append('\n');
    sb.append(pairRow("รอบ", shiftLabel(shift), width)).append('\n');
    if (sessionId != null && !sessionId.isEmpty()) {
      String sid = sessionId.length() > 18 ? sessionId.substring(sessionId.length() - 18) : sessionId;
      sb.append(pairRow("session", sid, width)).append('\n');
    }
    if (openedAt > 0) {
      sb.append(pairRow("เปิดกะ", formatDateTime(openedAt), width)).append('\n');
    }
    if (isClose) {
      sb.append(pairRow("ปิดกะ", formatDateTime(closedOrPrintedAt), width)).append('\n');
    } else {
      sb.append(pairRow("พิมพ์เมื่อ", formatDateTime(closedOrPrintedAt), width)).append('\n');
    }

    sb.append(rule(width)).append('\n');
    sb.append(center("สรุปยอดขาย", width)).append('\n');
    sb.append(pairRow("จำนวนบิล", String.valueOf(saleCount), width)).append('\n');
    sb.append(pairRow("ทำลายบิล", String.valueOf(voidedCount), width)).append('\n');
    sb.append(pairRow("ส่วนลดรวม", money(discountTotal), width)).append('\n');
    sb.append(pairRow("ยอดสุทธิ", money(cashSales + promptpaySales), width)).append('\n');

    sb.append(rule(width)).append('\n');
    sb.append(center("ชำระเงิน", width)).append('\n');
    sb.append(pairRow("เงินสด", cashBills + " บิล · " + money(cashSales), width)).append('\n');
    sb.append(pairRow("PromptPay", promptpayBills + " บิล · " + money(promptpaySales), width))
        .append('\n');

    if (isClose) {
      double expected = expectedCash != null ? expectedCash : openingCash + cashSales;
      double counted = countedCash != null ? countedCash : expected;
      double diff = cashDifference != null ? cashDifference : counted - expected;
      String label =
          discrepancyLabel != null && !discrepancyLabel.isEmpty()
              ? discrepancyLabel
              : (Math.abs(diff) < 0.5 ? "ตรง" : (diff > 0 ? "เกิน (Over)" : "ขาด (Short)"));

      sb.append(rule(width)).append('\n');
      sb.append(center("เงินสดในลิ้นชัก", width)).append('\n');
      sb.append(pairRow("เงินทอนเริ่ม", money(openingCash), width)).append('\n');
      sb.append(pairRow("+ ขายเงินสด", money(cashSales), width)).append('\n');
      sb.append(pairRow("= ควรมี", money(expected), width)).append('\n');
      sb.append(pairRow("นับได้จริง", money(counted), width)).append('\n');
      sb.append(pairRow("ส่วนต่าง", label + " " + money(diff), width)).append('\n');
      if (leaveFloat > 0.0001) {
        sb.append(pairRow("ทอนรอบถัดไป", money(leaveFloat), width)).append('\n');
      }
      if (discrepancyNote != null && !discrepancyNote.trim().isEmpty()) {
        sb.append(pairRow("เหตุผล", discrepancyNote.trim(), width)).append('\n');
      }

      sb.append(rule(width)).append('\n');
      sb.append(center("ปิดรอบเรียบร้อย", width)).append('\n');
      sb.append('\n');
      sb.append("ลงชื่อผู้ส่งกะ").append('\n');
      sb.append(signLine(width)).append('\n');
      sb.append('\n');
      sb.append("ลงชื่อผู้รับกะ").append('\n');
      sb.append(signLine(width)).append('\n');
    } else {
      sb.append(rule(width)).append('\n');
      sb.append(center("*** ไม่ใช่การปิดรอบ ***", width)).append('\n');
    }

    return sb.toString();
  }

  public static String build(
      JSONObject shop,
      String kind,
      String shift,
      String sessionId,
      long openedAt,
      long closedOrPrintedAt,
      int saleCount,
      int voidedCount,
      int cashBills,
      double cashSales,
      int promptpayBills,
      double promptpaySales,
      double discountTotal,
      double openingCash,
      Double countedCash,
      Double expectedCash,
      Double cashDifference,
      String discrepancyLabel,
      double leaveFloat,
      String discrepancyNote) {
    return build(
        shop,
        kind,
        shift,
        sessionId,
        openedAt,
        closedOrPrintedAt,
        saleCount,
        voidedCount,
        cashBills,
        cashSales,
        promptpayBills,
        promptpaySales,
        discountTotal,
        openingCash,
        countedCash,
        expectedCash,
        cashDifference,
        discrepancyLabel,
        leaveFloat,
        discrepancyNote,
        COLS_80);
  }

  static String shiftLabel(String shift) {
    if (shift == null) return "—";
    switch (shift) {
      case "morning":
        return "เช้า";
      case "afternoon":
        return "บ่าย";
      case "evening":
      case "night":
        return "ดึก";
      default:
        return shift;
    }
  }

  static String shopDisplayName(String en, String th) {
    String e = en == null ? "" : en.trim();
    String t = th == null ? "" : th.trim();
    if (e.isEmpty()) return t.isEmpty() ? DEFAULT_SHOP_EN : t;
    if (t.isEmpty()) return e;
    if (e.toLowerCase(Locale.US).contains(t.toLowerCase(Locale.US))) return e;
    return e + " (" + t + ")";
  }

  static String money(double amount) {
    if (Math.abs(amount - Math.rint(amount)) < 0.0001) {
      return String.format(Locale.US, "%.0f", amount);
    }
    return String.format(Locale.US, "%.2f", amount);
  }

  static String formatDateTime(long ts) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ts);
    return String.format(
        Locale.US,
        "%02d/%02d/%04d %02d:%02d",
        c.get(java.util.Calendar.DAY_OF_MONTH),
        c.get(java.util.Calendar.MONTH) + 1,
        c.get(java.util.Calendar.YEAR),
        c.get(java.util.Calendar.HOUR_OF_DAY),
        c.get(java.util.Calendar.MINUTE));
  }

  static String center(String text, int width) {
    String t = text == null ? "" : text;
    if (t.length() >= width) return t.substring(0, width);
    int pad = (width - t.length()) / 2;
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < pad; i++) sb.append(' ');
    sb.append(t);
    return sb.toString();
  }

  static String pairRow(String left, String right, int width) {
    String l = left == null ? "" : left;
    String r = right == null ? "" : right;
    if (l.length() + 1 + r.length() > width) {
      int maxLeft = Math.max(1, width - r.length() - 1);
      if (l.length() > maxLeft) l = l.substring(0, Math.max(1, maxLeft - 1)) + "…";
    }
    int spaces = width - l.length() - r.length();
    if (spaces < 1) spaces = 1;
    StringBuilder sb = new StringBuilder();
    sb.append(l);
    for (int i = 0; i < spaces; i++) sb.append(' ');
    sb.append(r);
    return sb.toString();
  }

  static String rule(int width) {
    StringBuilder sb = new StringBuilder(width);
    for (int i = 0; i < width; i++) sb.append('-');
    return sb.toString();
  }

  static String signLine(int width) {
    int n = Math.min(width, 28);
    StringBuilder sb = new StringBuilder(n);
    for (int i = 0; i < n; i++) sb.append('_');
    return sb.toString();
  }

  static List<String> wrap(String text, int width) {
    List<String> out = new ArrayList<>();
    String t = text == null ? "" : text;
    if (t.isEmpty()) {
      out.add("");
      return out;
    }
    int i = 0;
    while (i < t.length()) {
      int end = Math.min(t.length(), i + width);
      out.add(t.substring(i, end));
      i = end;
    }
    return out;
  }

  private static String opt(JSONObject o, String key) {
    if (o == null) return "";
    return o.optString(key, "").trim();
  }

  private static String firstNonEmpty(String... values) {
    if (values == null) return "";
    for (String v : values) {
      if (v != null && !v.trim().isEmpty()) return v.trim();
    }
    return "";
  }
}
