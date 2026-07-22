package app.telltea.npos.printer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * ESC/POS shift bill — field order / labels clone web {@code buildShiftReportHtml}
 * (src/lib/pos-printer/shift-snapshot-template.ts) frame-by-frame.
 *
 * Front-counter only: no dine-in / delivery channel block.
 * Z adds real blind-close cash drawer numbers + handwritten signature lines.
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
        "",
        0,
        null,
        cols);
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

  /** Full web-parity build with device code, pending count, and local receipt detail. */
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
      String deviceCode,
      int pendingCount,
      JSONArray sessionReceipts,
      int cols) {
    int width = cols <= 0 ? COLS_80 : cols;
    boolean isClose = "close".equals(kind);

    String shopEn = firstNonEmpty(opt(shop, "shopName"), DEFAULT_SHOP_EN);
    String shopTh = firstNonEmpty(opt(shop, "shopNameTh"), DEFAULT_SHOP_TH);
    String shopAddress = firstNonEmpty(opt(shop, "shopAddress"), DEFAULT_ADDRESS);
    String shopPhone = firstNonEmpty(opt(shop, "shopPhone"), DEFAULT_PHONE);
    String staff = firstNonEmpty(opt(shop, "receiptStaffName"), "หน้าร้าน");
    String device =
        firstNonEmpty(deviceCode, opt(shop, "pairingCode"), "—");
    String sessionShort =
        sessionId == null || sessionId.isEmpty()
            ? "—"
            : "#"
                + sessionId
                    .substring(Math.max(0, sessionId.length() - 4))
                    .toUpperCase(Locale.US);

    double netSales = cashSales + promptpaySales;
    int discountCount = discountTotal > 0.0001 ? 1 : 0;
    DetailAgg detail = DetailAgg.fromReceipts(sessionReceipts, sessionId);
    if (detail.discountTotal > discountTotal) {
      discountTotal = detail.discountTotal;
      discountCount = detail.discountCount;
    }
    double grossSales = detail.hasLines ? detail.grossSales : netSales + discountTotal;
    int customerCount = saleCount > 0 ? saleCount : detail.activeBills;
    double avgPerBill = customerCount > 0 ? netSales / customerCount : 0;

    StringBuilder sb = new StringBuilder();

    // --- Frame 1: shop header (center) — match web ---
    sb.append(center(shopEn, width)).append('\n');
    if (!shopTh.isEmpty() && !shopEn.toLowerCase(Locale.US).contains(shopTh.toLowerCase(Locale.US))) {
      sb.append(center(shopTh, width)).append('\n');
    }
    if (!shopAddress.isEmpty()) {
      for (String part : wrap(shopAddress, width)) {
        sb.append(center(part, width)).append('\n');
      }
    }
    if (!shopPhone.isEmpty()) {
      sb.append(center(shopPhone, width)).append('\n');
    }
    sb.append(rule(width)).append('\n');

    // --- Frame 2: title + print time ---
    String title = isClose ? "รายงานยอดการขาย" : "Snapshot ระหว่างรอบการขาย";
    sb.append(center(title, width)).append('\n');
    sb.append(center("พิมพ์ " + formatDateTime(closedOrPrintedAt), width)).append('\n');

    // --- Frame 3: meta ---
    sb.append(pairRow("รหัสเครื่อง", device + " · รอบ " + sessionShort, width)).append('\n');
    if (openedAt > 0) {
      sb.append(pairRow("เปิดรอบ", formatDateTime(openedAt), width)).append('\n');
    }
    if (isClose) {
      sb.append(pairRow("ปิดรอบ", formatDateTime(closedOrPrintedAt), width)).append('\n');
    }
    sb.append(pairRow("โดย", staff, width)).append('\n');
    if (shift != null && !shift.isEmpty()) {
      sb.append(pairRow("รอบงาน", shiftLabel(shift), width)).append('\n');
    }

    // --- Frame 4: ยอดขายตามหมวดหมู่ ---
    if (!detail.byCategory.isEmpty()) {
      sb.append(rule(width)).append('\n');
      sb.append("ยอดขายตามหมวดหมู่").append('\n');
      for (NamedAmt row : detail.byCategory) {
        sb.append(tripleRow(row.name, String.valueOf(row.qty), money(row.amount), width))
            .append('\n');
      }
      sb.append(
              tripleRow(
                  "รวม",
                  String.valueOf(detail.itemQty > 0 ? detail.itemQty : customerCount),
                  money(grossSales),
                  width))
          .append('\n');
    }

    // --- Frame 5: สรุปยอด (web totals block) ---
    sb.append(rule(width)).append('\n');
    sb.append("สรุปยอด").append('\n');
    sb.append(pairRow("ยอดขายรวม", money(grossSales), width)).append('\n');
    sb.append(pairRow("ส่วนลด", "-" + money(discountTotal), width)).append('\n');
    sb.append(pairRow("ค่าบริการ", money(0), width)).append('\n');
    sb.append(pairRow("ยอดก่อนภาษี", money(netSales), width)).append('\n');
    sb.append(pairRow("ภาษี (VAT 0%)", money(0), width)).append('\n');
    sb.append(pairRow("ปัดเศษ", money(0), width)).append('\n');
    sb.append(pairRow("ยอดขายสุทธิ", money(netSales), width)).append('\n');
    sb.append(pairRow("จำนวนลูกค้า", String.valueOf(customerCount), width)).append('\n');
    sb.append(pairRow("ยอดเฉลี่ยต่อบิล", money(avgPerBill), width)).append('\n');

    // --- Frame 6: ส่วนลด & โปรโมชั่น ---
    sb.append(rule(width)).append('\n');
    sb.append("ส่วนลด & โปรโมชั่น").append('\n');
    sb.append(
            pairRow(
                "ส่วนลดท้ายบิล",
                discountCount + " ครั้ง · -" + money(discountTotal),
                width))
        .append('\n');

    // --- Frame 7: ยอดขายตามการชำระเงิน ---
    sb.append(rule(width)).append('\n');
    sb.append("ยอดขายตามการชำระเงิน").append('\n');
    sb.append(tripleRow("ช่องทาง", "บิล", "ยอด", width)).append('\n');
    sb.append(tripleRow("เงินสด", String.valueOf(cashBills), money(cashSales), width))
        .append('\n');
    sb.append(
            tripleRow("PromptPay", String.valueOf(promptpayBills), money(promptpaySales), width))
        .append('\n');
    sb.append(tripleRow("ยอดขายสุทธิ", String.valueOf(saleCount), money(netSales), width))
        .append('\n');

    // --- Frame 8: รอบการขาย (เงินสด) — web labels + real blind numbers on Z ---
    sb.append(rule(width)).append('\n');
    sb.append("รอบการขาย (เงินสด)").append('\n');
    if (isClose) {
      double expected = expectedCash != null ? expectedCash : openingCash + cashSales;
      double counted = countedCash != null ? countedCash : expected;
      double diff = cashDifference != null ? cashDifference : counted - expected;
      String label =
          discrepancyLabel != null && !discrepancyLabel.isEmpty()
              ? discrepancyLabel
              : (Math.abs(diff) < 0.5 ? "ตรง" : (diff > 0 ? "เกิน (Over)" : "ขาด (Short)"));
      sb.append(pairRow("เงินสดเริ่มต้น", money(openingCash), width)).append('\n');
      sb.append(pairRow("ยอดขายเงินสด", money(cashSales), width)).append('\n');
      sb.append(pairRow("คืนเงิน", money(0), width)).append('\n');
      sb.append(pairRow("เงินเข้า/เงินออก", money(0), width)).append('\n');
      sb.append(pairRow("ควรมีในลิ้นชัก", money(expected), width)).append('\n');
      sb.append(pairRow("นับจริงในลิ้นชัก", money(counted), width)).append('\n');
      sb.append(pairRow("ส่วนต่าง", label + " " + money(diff), width)).append('\n');
      if (leaveFloat > 0.0001) {
        sb.append(pairRow("ทอนรอบถัดไป", money(leaveFloat), width)).append('\n');
      }
      if (discrepancyNote != null && !discrepancyNote.trim().isEmpty()) {
        sb.append(pairRow("เหตุผล", discrepancyNote.trim(), width)).append('\n');
      }
    } else {
      sb.append(pairRow("เงินสดเริ่มต้น", money(openingCash), width)).append('\n');
      sb.append(pairRow("ยอดขายเงินสด", money(cashSales), width)).append('\n');
      sb.append(pairRow("คืนเงิน", money(0), width)).append('\n');
      sb.append(pairRow("เงินเข้า/เงินออก", money(0), width)).append('\n');
      sb.append(pairRow("ควรมีในลิ้นชัก*", money(openingCash + cashSales), width)).append('\n');
      sb.append(pairRow("นับจริงในลิ้นชัก", "—", width)).append('\n');
      sb.append(pairRow("ส่วนต่าง", "—", width)).append('\n');
      sb.append(center("*รวมเงินทอนเริ่มต้น", width)).append('\n');
    }

    // --- Frame 9: ทำลายบิล / ยกเลิก ---
    sb.append(rule(width)).append('\n');
    sb.append("ทำลายบิล / ยกเลิก").append('\n');
    sb.append(
            pairRow(
                "ทำลายทั้งบิล",
                voidedCount + " · " + money(detail.voidedTotal),
                width))
        .append('\n');
    sb.append(pairRow("ทำลายรายเมนู", "0 · " + money(0), width)).append('\n');
    sb.append(pairRow("ยกเลิกบิล", "0 · " + money(0), width)).append('\n');
    for (String head : detail.voidedHeads) {
      sb.append(head).append('\n');
    }

    // --- Frame 10: บิลรอส่ง ---
    sb.append(pairRow("บิลรอส่ง", String.valueOf(Math.max(0, pendingCount)), width)).append('\n');

    // --- Frame 11: ยอดขายตามรายการ ---
    if (!detail.byItem.isEmpty()) {
      sb.append(rule(width)).append('\n');
      sb.append("ยอดขายตามรายการ").append('\n');
      int shown = 0;
      for (NamedAmt row : detail.byItem) {
        if (shown++ >= 40) {
          sb.append(center("…", width)).append('\n');
          break;
        }
        sb.append(tripleRow(row.name, String.valueOf(row.qty), money(row.amount), width))
            .append('\n');
      }
    }

    // --- Frame 12: รายการขายแยกตามบิล ---
    if (!detail.billBlocks.isEmpty()) {
      sb.append(rule(width)).append('\n');
      sb.append("รายการขายแยกตามบิล (" + detail.billBlocks.size() + ")").append('\n');
      int shown = 0;
      for (String block : detail.billBlocks) {
        if (shown++ >= 25) {
          sb.append(center("…", width)).append('\n');
          break;
        }
        sb.append(block);
      }
    }

    // --- Frame 13: footer (+ Z signatures) ---
    sb.append(rule(width)).append('\n');
    if (isClose) {
      sb.append(center("ปิดรอบเรียบร้อย", width)).append('\n');
      sb.append('\n');
      sb.append("ลงชื่อผู้ส่งกะ").append('\n');
      sb.append(signLine(width)).append('\n');
      sb.append('\n');
      sb.append("ลงชื่อผู้รับกะ").append('\n');
      sb.append(signLine(width)).append('\n');
    } else {
      sb.append(center("*** ไม่ใช่การปิดรอบ ***", width)).append('\n');
    }

    return sb.toString();
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

  static String formatTime(long ts) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ts);
    return String.format(
        Locale.US,
        "%02d:%02d",
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

  /** Left | mid | right — mid+right glued on the right like a 3-col table. */
  static String tripleRow(String left, String mid, String right, int width) {
    String l = left == null ? "" : left;
    String tail = (mid == null ? "" : mid) + " " + (right == null ? "" : right);
    return pairRow(l, tail.trim(), width);
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

  private static final class NamedAmt {
    final String name;
    int qty;
    double amount;

    NamedAmt(String name) {
      this.name = name;
    }
  }

  private static final class DetailAgg {
    boolean hasLines;
    int itemQty;
    int activeBills;
    double grossSales;
    double discountTotal;
    int discountCount;
    double voidedTotal;
    List<NamedAmt> byCategory = new ArrayList<>();
    List<NamedAmt> byItem = new ArrayList<>();
    List<String> billBlocks = new ArrayList<>();
    List<String> voidedHeads = new ArrayList<>();

    static DetailAgg fromReceipts(JSONArray receipts, String sessionId) {
      DetailAgg d = new DetailAgg();
      if (receipts == null || receipts.length() == 0) return d;
      Map<String, NamedAmt> cats = new LinkedHashMap<>();
      Map<String, NamedAmt> items = new LinkedHashMap<>();
      String sid = sessionId == null ? "" : sessionId;
      for (int i = 0; i < receipts.length(); i++) {
        JSONObject r = receipts.optJSONObject(i);
        if (r == null) continue;
        if (!sid.isEmpty()) {
          String rs = r.optString("sessionId", "");
          if (!rs.isEmpty() && !sid.equals(rs)) continue;
        }
        boolean voided = r.optBoolean("voided", false);
        double total = r.optDouble("total", 0);
        double disc = r.optDouble("discountBaht", 0);
        String billNo = r.optString("billNo", "—");
        long at = r.optLong("at", System.currentTimeMillis());
        String pay = r.optString("paymentMethod", "cash");
        String payLabel = "promptpay".equals(pay) ? "PP" : "สด";
        if (voided) {
          d.voidedTotal += total;
          d.voidedHeads.add(
              "#" + billNo + " " + formatTime(at) + " · " + money(total));
          continue;
        }
        d.activeBills += 1;
        if (disc > 0.0001) {
          d.discountTotal += disc;
          d.discountCount += 1;
        }
        JSONArray lines = r.optJSONArray("lines");
        StringBuilder block = new StringBuilder();
        block
            .append("#")
            .append(billNo)
            .append(" · ")
            .append(formatTime(at))
            .append(" · ")
            .append(payLabel)
            .append('\n');
        if (lines != null && lines.length() > 0) {
          d.hasLines = true;
          for (int j = 0; j < lines.length(); j++) {
            JSONObject line = lines.optJSONObject(j);
            if (line == null) continue;
            String name = line.optString("name", "รายการ").trim();
            if (name.isEmpty()) name = "รายการ";
            int qty = Math.max(1, line.optInt("qty", 1));
            double unit = line.optDouble("unitPrice", 0);
            double amount = qty * unit;
            if (amount <= 0 && line.has("amount")) amount = line.optDouble("amount", 0);
            d.itemQty += qty;
            d.grossSales += amount;
            String cat = line.optString("categoryName", "").trim();
            if (cat.isEmpty()) cat = "อื่นๆ";
            NamedAmt c = cats.get(cat);
            if (c == null) {
              c = new NamedAmt(cat);
              cats.put(cat, c);
            }
            c.qty += qty;
            c.amount += amount;
            NamedAmt it = items.get(name);
            if (it == null) {
              it = new NamedAmt(name);
              items.put(name, it);
            }
            it.qty += qty;
            it.amount += amount;
            block
                .append("  ")
                .append(name)
                .append(" x")
                .append(qty)
                .append("  ")
                .append(money(amount))
                .append('\n');
          }
        } else {
          d.grossSales += total + disc;
          NamedAmt c = cats.get("อื่นๆ");
          if (c == null) {
            c = new NamedAmt("อื่นๆ");
            cats.put("อื่นๆ", c);
          }
          c.qty += 1;
          c.amount += total + disc;
          block.append("  (ไม่มีรายการรายละเอียด)\n");
        }
        if (disc > 0.0001) {
          block.append("  ส่วนลด  -").append(money(disc)).append('\n');
        }
        block.append("  รวมบิล  ").append(money(total)).append('\n');
        d.billBlocks.add(block.toString());
      }
      d.byCategory = sortedAmts(cats);
      d.byItem = sortedAmts(items);
      return d;
    }

    private static List<NamedAmt> sortedAmts(Map<String, NamedAmt> map) {
      List<NamedAmt> list = new ArrayList<>(map.values());
      Collections.sort(
          list,
          new Comparator<NamedAmt>() {
            @Override
            public int compare(NamedAmt a, NamedAmt b) {
              int cmp = Double.compare(b.amount, a.amount);
              if (cmp != 0) return cmp;
              return a.name.compareTo(b.name);
            }
          });
      return list;
    }
  }
}
