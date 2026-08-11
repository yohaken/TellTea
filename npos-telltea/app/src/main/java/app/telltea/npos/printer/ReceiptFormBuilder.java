package app.telltea.npos.printer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * ESC/POS plain-text body matching web {@code buildUnifiedReceiptBody}
 * (src/lib/pos-printer/receipt-template.ts) field order + labels.
 *
 * Front-counter only — never prints order-channel / service-type badge.
 *
 * Brand on paper = shop settings ({@code shopName} / {@code shopNameTh}).
 * Defaults are our shop (TELL TEA). Layout may follow common counter UX;
 * never print third-party POS brands or a product-system footer.
 */
public final class ReceiptFormBuilder {
  /** Typical 58mm printable columns (TIS-620 / monospace). */
  public static final int COLS_58 = 32;
  /** Typical 80mm printable columns. */
  public static final int COLS_80 = 42;

  /**
   * Placeholder line replaced by printer layer with a claim QR (USB EscPos / SUNMI bitmap).
   * Must stay ASCII so {@link ThermalSafe} keeps it.
   */
  public static final String CLAIM_QR_MARKER = "<<<CLAIM_QR>>>";

  public static final String CLAIM_QR_INVITE = "สแกนสะสมแต้ม";
  /** Short redeem hint under invite — keep short for 58mm. */
  public static final String CLAIM_QR_HINT = "1แต้ม=ลด1฿ · ครั้งหน้าบอกเบอร์";

  /** Our shop fallback when settings are empty — not a third-party POS brand. */
  private static final String DEFAULT_SHOP_EN = "TELL TEA";
  private static final String DEFAULT_SHOP_TH = "เทล ที";
  private static final String DEFAULT_FOOTER = "ขอบคุณที่อุดหนุน";

  private ReceiptFormBuilder() {}

  public static String build(
      JSONObject shop, JSONObject payload, String billNo, double total, int cols) {
    return renderEscPos(buildLines(shop, payload, billNo, total, cols), cols);
  }

  /** Default 80mm columns. */
  public static String build(JSONObject shop, JSONObject payload, String billNo, double total) {
    return build(shop, payload, billNo, total, COLS_80);
  }

  /**
   * Structured slip rows — same content as {@link #build}. SUNMI InnerPrinter prints these with
   * full-width columns (proportional font); Esc/POS renders via {@link #renderEscPos}.
   */
  public static List<ReceiptSlipLine> buildLines(
      JSONObject shop, JSONObject payload, String billNo, double total, int cols) {
    int width = cols <= 0 ? COLS_80 : cols;
    boolean compact = width <= COLS_58;
    List<ReceiptSlipLine> out = new ArrayList<>();

    String shopEn = firstNonEmpty(opt(shop, "shopName"), DEFAULT_SHOP_EN);
    String shopTh = firstNonEmpty(opt(shop, "shopNameTh"), DEFAULT_SHOP_TH);
    String shopName = shopDisplayName(shopEn, shopTh);
    String shopAddress = opt(shop, "shopAddress");
    String shopPhone = opt(shop, "shopPhone");
    String footerNote =
        firstNonEmpty(
            opt(shop, "receiptFooterNote"),
            opt(payload, "receiptFooterNote"),
            DEFAULT_FOOTER);
    String staffName =
        firstNonEmpty(opt(payload, "staffName"), opt(shop, "receiptStaffName"));
    String staffId = opt(payload, "staffId");

    String pay = payload != null ? payload.optString("paymentMethod", "") : "";
    double manualDisc =
        payload != null && payload.has("manualDiscountBaht")
            ? payload.optDouble("manualDiscountBaht", 0)
            : 0;
    double redeem =
        payload != null && payload.has("redeemBaht") ? payload.optDouble("redeemBaht", 0) : 0;
    int pointsRedeemed =
        payload != null
            ? Math.max(0, payload.optInt("pointsToRedeem", payload.optInt("pointsRedeemed", 0)))
            : 0;
    double discountLegacy = payload != null ? payload.optDouble("discountBaht", 0) : 0;
    if (manualDisc <= 0 && redeem <= 0 && discountLegacy > 0) {
      manualDisc = discountLegacy;
    }
    double offTotal = Math.max(0, manualDisc) + Math.max(0, redeem);
    double subtotal =
        payload != null && payload.has("subtotal")
            ? payload.optDouble("subtotal", total)
            : inferSubtotal(payload, total, offTotal);
    double cashReceived = payload != null ? payload.optDouble("cashReceived", 0) : 0;
    double change =
        payload != null && payload.has("change")
            ? payload.optDouble("change", 0)
            : ("cash".equals(pay) ? Math.max(0, cashReceived - total) : 0);
    long createdAt =
        payload != null && payload.has("createdAt")
            ? payload.optLong("createdAt", System.currentTimeMillis())
            : System.currentTimeMillis();
    String customerName = payload != null ? payload.optString("customerName", "").trim() : "";
    String memberName = payload != null ? payload.optString("memberName", "").trim() : "";
    String memberPhone =
        payload != null
            ? firstNonEmpty(
                payload.optString("memberPhoneDisplay", ""),
                payload.optString("memberPhone", ""))
            : "";
    String claimUrl = payload != null ? payload.optString("claimUrl", "").trim() : "";
    int pointsEarned = payload != null ? Math.max(0, payload.optInt("pointsEarned", 0)) : 0;
    int claimPointsPreview =
        payload != null
            ? Math.max(
                0,
                payload.optInt(
                    "claimPointsPreview", payload.optInt("pointsPreview", 0)))
            : 0;
    String externalOrderId =
        payload != null ? payload.optString("externalOrderId", "").trim() : "";
    String orderNotes = payload != null ? payload.optString("orderNotes", "").trim() : "";

    String billDisplay = billDisplay(billNo);
    JSONArray lines = payload != null ? payload.optJSONArray("lines") : null;
    int itemCount = itemQtyTotal(lines);

    out.add(ReceiptSlipLine.center(billDisplay, true));
    if (!customerName.isEmpty()) out.add(ReceiptSlipLine.center(customerName, false));
    // Logo above shop name when BO flag on + brandLogo present (Sunmi bitmap draws it).
    if (shouldPrintShopLogo(shop)) {
      out.add(ReceiptSlipLine.logoMark());
    }
    out.add(ReceiptSlipLine.center(shopName, true));
    if (!shopAddress.isEmpty()) {
      for (String part : wrap(shopAddress, width)) {
        out.add(ReceiptSlipLine.center(part, false));
      }
    }
    if (!shopPhone.isEmpty()) out.add(ReceiptSlipLine.center("โทร : " + shopPhone, false));
    String taxId = opt(shop, "taxId");
    if (!taxId.isEmpty()) out.add(ReceiptSlipLine.center("เลขผู้เสียภาษี : " + taxId, false));
    out.add(ReceiptSlipLine.blank());
    out.add(ReceiptSlipLine.center("ใบเสร็จ", true));
    out.add(ReceiptSlipLine.blank());

    if (!externalOrderId.isEmpty()) {
      appendMetaLines(out, "Order", externalOrderId, width);
    }
    if (!staffName.isEmpty()) appendMetaLines(out, "Staff", staffName, width);
    if (!staffId.isEmpty()) appendMetaLines(out, "ID", staffId, width);
    appendMetaLines(out, "วันที่", formatDate(createdAt), width);
    appendMetaLines(out, "เวลา", formatTime(createdAt), width);
    out.add(ReceiptSlipLine.rule());
    out.add(ReceiptSlipLine.blank());

    if (lines != null) {
      boolean firstItem = true;
      for (int i = 0; i < lines.length(); i++) {
        JSONObject line = lines.optJSONObject(i);
        if (line == null) continue;
        if (!firstItem) out.add(ReceiptSlipLine.blank());
        firstItem = false;
        appendItemLines(out, line, width, compact);
      }
    }

    out.add(ReceiptSlipLine.blank());
    out.add(ReceiptSlipLine.rule());
    out.add(ReceiptSlipLine.leftRight("จำนวน:", String.valueOf(itemCount), false));
    out.add(ReceiptSlipLine.leftRight("รวม:", formatMoney(subtotal), false));
    if (manualDisc > 0.0001) {
      out.add(ReceiptSlipLine.leftRight("ส่วนลด", "-" + formatMoney(manualDisc), false));
    }
    if (redeem > 0.0001) {
      String redeemLabel =
          pointsRedeemed > 0 ? ("แลกแต้ม (" + pointsRedeemed + ")") : "แลกแต้ม";
      out.add(ReceiptSlipLine.leftRight(redeemLabel, "-" + formatMoney(redeem), false));
    }
    out.add(ReceiptSlipLine.doubleRule());
    out.add(ReceiptSlipLine.leftRight("ยอดสุทธิ:", formatMoney(total), true));
    out.add(ReceiptSlipLine.doubleRule());
    if (total > 0.009) {
      out.add(ReceiptSlipLine.leftRight("ชำระ", paymentLabel(pay), false));
      if ("cash".equals(pay)) {
        out.add(ReceiptSlipLine.leftRight("เงินสด", formatMoney(cashReceived), false));
        out.add(ReceiptSlipLine.leftRight("เงินทอน", formatMoney(change), false));
      }
    }
    // Modern-trade style: points sit with tender totals (not under QR).
    if (pointsEarned > 0) {
      out.add(ReceiptSlipLine.leftRight("แต้มที่ได้", "+" + pointsEarned, false));
    } else if (claimPointsPreview > 0) {
      out.add(ReceiptSlipLine.leftRight("แต้มบิลนี้", "+" + claimPointsPreview, false));
    }
    if (!memberName.isEmpty() || !memberPhone.isEmpty()) {
      String mem =
          "สมาชิก: "
              + firstNonEmpty(memberName, "สมาชิก")
              + (memberPhone.isEmpty() ? "" : (" · " + memberPhone));
      for (String part : wrap(mem, width)) {
        out.add(ReceiptSlipLine.left(part, false));
      }
    }
    if (!orderNotes.isEmpty()) {
      out.add(ReceiptSlipLine.rule());
      for (String part : wrap(orderNotes, width)) {
        out.add(ReceiptSlipLine.left(part, false));
      }
    }
    if (!claimUrl.isEmpty()) {
      out.add(ReceiptSlipLine.blank());
      out.add(ReceiptSlipLine.qrMark());
      out.add(ReceiptSlipLine.center(CLAIM_QR_INVITE, true));
      out.add(ReceiptSlipLine.center(CLAIM_QR_HINT, false));
    }
    out.add(ReceiptSlipLine.blank());
    out.add(ReceiptSlipLine.center(footerNote, false));
    return out;
  }

  /** Monospace Esc/POS body from structured lines (USB/BT/LAN). */
  public static String renderEscPos(List<ReceiptSlipLine> lines, int cols) {
    int width = cols <= 0 ? COLS_80 : cols;
    StringBuilder sb = new StringBuilder();
    if (lines == null) return "";
    for (ReceiptSlipLine line : lines) {
      if (line == null) continue;
      switch (line.kind) {
        case CENTER:
          if (line.bold) sb.append(EscPos.BOLD_ON);
          sb.append(center(line.left, width));
          if (line.bold) sb.append(EscPos.BOLD_OFF);
          sb.append('\n');
          break;
        case LEFT_RIGHT:
          if (line.bold) sb.append(EscPos.BOLD_ON);
          sb.append(pairRow(line.left, line.right, width));
          if (line.bold) sb.append(EscPos.BOLD_OFF);
          sb.append('\n');
          break;
        case LEFT:
          if (line.bold) sb.append(EscPos.BOLD_ON);
          sb.append(line.left);
          if (line.bold) sb.append(EscPos.BOLD_OFF);
          sb.append('\n');
          break;
        case RULE:
          sb.append(rule(width)).append('\n');
          break;
        case DOUBLE_RULE:
          sb.append(doubleRule(width)).append('\n');
          break;
        case BLANK:
          sb.append('\n');
          break;
        case QR_MARK:
          sb.append(CLAIM_QR_MARKER).append('\n');
          break;
        case LOGO_MARK:
          // Esc/POS text path skips logo (Sunmi bitmap path draws it). Fail-open.
          break;
        default:
          break;
      }
    }
    return sb.toString();
  }

  /**
   * Short gift-point slip (QR ให้แต้ม) — shop name, +N points, claim QR.
   * Reuses {@link #CLAIM_QR_INVITE} so Sunmi bitmap path styles the invite line.
   */
  public static List<ReceiptSlipLine> buildGiftCouponLines(
      JSONObject shop, int points, String claimUrl) {
    List<ReceiptSlipLine> out = new ArrayList<>();
    String shopEn = firstNonEmpty(opt(shop, "shopName"), DEFAULT_SHOP_EN);
    String shopTh = firstNonEmpty(opt(shop, "shopNameTh"), DEFAULT_SHOP_TH);
    String footerNote = firstNonEmpty(opt(shop, "receiptFooterNote"), DEFAULT_FOOTER);
    int pts = Math.max(1, points);
    if (shouldPrintShopLogo(shop)) {
      out.add(ReceiptSlipLine.logoMark());
      out.add(ReceiptSlipLine.blank());
    }
    out.add(ReceiptSlipLine.center(shopEn, true));
    if (!shopTh.isEmpty() && !shopTh.equalsIgnoreCase(shopEn)) {
      out.add(ReceiptSlipLine.center(shopTh, false));
    }
    out.add(ReceiptSlipLine.doubleRule());
    out.add(ReceiptSlipLine.center("ของขวัญแต้ม", true));
    out.add(ReceiptSlipLine.center("+" + pts + " แต้ม", true));
    out.add(ReceiptSlipLine.rule());
    if (claimUrl != null && !claimUrl.trim().isEmpty()) {
      out.add(ReceiptSlipLine.blank());
      out.add(ReceiptSlipLine.qrMark());
      out.add(ReceiptSlipLine.center(CLAIM_QR_INVITE, true));
      out.add(ReceiptSlipLine.center(CLAIM_QR_HINT, false));
    }
    out.add(ReceiptSlipLine.blank());
    out.add(ReceiptSlipLine.center(footerNote, false));
    return out;
  }

  public static String buildGiftCouponBody(JSONObject shop, int points, String claimUrl, int cols) {
    return renderEscPos(buildGiftCouponLines(shop, points, claimUrl), cols);
  }

  /** BO flag default ON when brandLogo exists (`receiptPrintLogo !== false`). */
  static boolean shouldPrintShopLogo(JSONObject shop) {
    if (shop == null) return false;
    if (shop.optBoolean("receiptPrintLogo", true) == false) return false;
    String logo = opt(shop, "brandLogo");
    return logo.startsWith("data:image/");
  }

  private static void appendMetaLines(
      List<ReceiptSlipLine> out, String label, String value, int width) {
    String row = label + ": " + (value == null ? "" : value);
    if (row.length() <= width) {
      out.add(ReceiptSlipLine.left(row, false));
      return;
    }
    for (String part : wrap(row, width)) {
      out.add(ReceiptSlipLine.left(part, false));
    }
  }

  private static void appendItemLines(
      List<ReceiptSlipLine> out, JSONObject line, int width, boolean compact) {
    int qty = Math.max(1, line.optInt("qty", 1));
    double price = line.optDouble("price", 0);
    double lineTotal = Math.round(price * qty * 100.0) / 100.0;
    String title = receiptLineBaseName(line.optString("name", ""));
    String priceText = formatMoney(lineTotal);
    String qtyCol = qty < 10 ? (" " + qty) : String.valueOf(Math.min(qty, 99));
    out.add(ReceiptSlipLine.leftRight(qtyCol + " " + title, priceText, true));
    for (ModTally mod : tallyModifiers(line.opt("options"), compact)) {
      int modCount = Math.max(1, mod.count);
      String label =
          modCount >= 2 ? "- " + mod.label + " x" + modCount : "- " + mod.label;
      boolean emphasizeQty = qtyEmphasized(mod.count);
      for (String part : wrap("    " + label, width)) {
        out.add(ReceiptSlipLine.left(part, emphasizeQty));
      }
    }
  }

  static String billDisplay(String billNo) {
    String raw = billNo == null || billNo.trim().isEmpty() ? "-" : billNo.trim();
    return raw.startsWith("#") ? raw : "#" + raw;
  }

  static String shopDisplayName(String en, String th) {
    String e = en == null ? "" : en.trim();
    String t = th == null ? "" : th.trim();
    if (e.isEmpty()) return t.isEmpty() ? DEFAULT_SHOP_EN : t;
    if (t.isEmpty()) return e;
    if (e.toLowerCase(Locale.US).contains(t.toLowerCase(Locale.US))) return e;
    return e + " (" + t + ")";
  }

  static String paymentLabel(String method) {
    // cash / PromptPay / โอนเงิน — see PaymentMethods.labelTh
    return app.telltea.npos.sell.PaymentMethods.labelTh(method);
  }

  static String receiptLineBaseName(String name) {
    if (name == null) return "";
    int paren = name.indexOf(" (");
    if (paren > 0) return name.substring(0, paren).trim();
    return name.trim();
  }

  static boolean qtyEmphasized(int qty) {
    return qty > 1;
  }

  static List<ModTally> tallyModifiers(Object optionsRaw, boolean compact) {
    Map<String, Integer> tallies = new LinkedHashMap<>();
    if (!(optionsRaw instanceof JSONArray)) return toList(tallies);
    JSONArray groups = (JSONArray) optionsRaw;
    for (int i = 0; i < groups.length(); i++) {
      JSONObject g = groups.optJSONObject(i);
      if (g == null) continue;
      String groupName = g.optString("groupName", "").trim();
      JSONArray choices = g.optJSONArray("choices");
      if (choices == null) continue;
      for (int j = 0; j < choices.length(); j++) {
        JSONObject c = choices.optJSONObject(j);
        if (c == null) continue;
        String n = c.optString("name", "").trim();
        if (n.isEmpty()) continue;
        String label = compact || groupName.isEmpty() ? n : groupName + ": " + n;
        tallies.put(label, tallies.containsKey(label) ? tallies.get(label) + 1 : 1);
      }
    }
    return toList(tallies);
  }

  private static int itemQtyTotal(JSONArray lines) {
    if (lines == null) return 0;
    int n = 0;
    for (int i = 0; i < lines.length(); i++) {
      JSONObject line = lines.optJSONObject(i);
      if (line != null) n += line.optInt("qty", 0);
    }
    return n;
  }

  private static double inferSubtotal(JSONObject payload, double total, double discount) {
    if (payload == null) return total;
    JSONArray lines = payload.optJSONArray("lines");
    if (lines == null) return total + Math.max(0, discount);
    double sum = 0;
    for (int i = 0; i < lines.length(); i++) {
      JSONObject line = lines.optJSONObject(i);
      if (line == null) continue;
      sum += line.optDouble("price", 0) * line.optInt("qty", 0);
    }
    if (sum > 0) return Math.round(sum * 100.0) / 100.0;
    return total + Math.max(0, discount);
  }

  static String formatMoney(double amount) {
    if (Math.abs(amount - Math.rint(amount)) < 0.0001) {
      return String.format(Locale.US, "%.0f", amount);
    }
    return String.format(Locale.US, "%.2f", amount);
  }

  static String formatDate(long ts) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ts);
    return String.format(
        Locale.US,
        "%02d/%02d/%04d",
        c.get(java.util.Calendar.DAY_OF_MONTH),
        c.get(java.util.Calendar.MONTH) + 1,
        c.get(java.util.Calendar.YEAR));
  }

  static String formatTime(long ts) {
    java.util.Calendar c = java.util.Calendar.getInstance();
    c.setTimeInMillis(ts);
    return String.format(
        Locale.US,
        "%02d:%02d:%02d",
        c.get(java.util.Calendar.HOUR_OF_DAY),
        c.get(java.util.Calendar.MINUTE),
        c.get(java.util.Calendar.SECOND));
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
      // ASCII "..." — Unicode ellipsis becomes "?" on TIS-620 thermals.
      if (l.length() > maxLeft) l = l.substring(0, Math.max(1, maxLeft - 3)) + "...";
    }
    int spaces = width - l.length() - r.length();
    if (spaces < 1) spaces = 1;
    StringBuilder sb = new StringBuilder();
    sb.append(l);
    for (int i = 0; i < spaces; i++) sb.append(' ');
    sb.append(r);
    return sb.toString();
  }

  static String moneyRow(String label, String value, int width) {
    return pairRow(label, value, width);
  }

  static String metaRow(String label, String value, int width) {
    String row = label + ": " + (value == null ? "" : value);
    if (row.length() <= width) return row + "\n";
    StringBuilder sb = new StringBuilder();
    for (String part : wrap(row, width)) {
      sb.append(part).append('\n');
    }
    return sb.toString();
  }

  static String rule(int width) {
    return repeat('-', width);
  }

  static String doubleRule(int width) {
    return repeat('=', width);
  }

  private static String repeat(char c, int n) {
    StringBuilder sb = new StringBuilder(n);
    for (int i = 0; i < n; i++) sb.append(c);
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

  private static List<ModTally> toList(Map<String, Integer> tallies) {
    List<ModTally> out = new ArrayList<>();
    for (Map.Entry<String, Integer> e : tallies.entrySet()) {
      out.add(new ModTally(e.getKey(), e.getValue()));
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

  static final class ModTally {
    final String label;
    final int count;

    ModTally(String label, int count) {
      this.label = label;
      this.count = count;
    }
  }
}
