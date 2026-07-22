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
 */
public final class ReceiptFormBuilder {
  /** Typical 58mm printable columns (TIS-620 / monospace). */
  public static final int COLS_58 = 32;
  /** Typical 80mm printable columns. */
  public static final int COLS_80 = 42;

  private static final String DEFAULT_SHOP_EN = "TELL TEA";
  private static final String DEFAULT_SHOP_TH = "เทล ที";
  private static final String DEFAULT_ADDRESS =
      "ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี";
  private static final String DEFAULT_PHONE = "0884818817";
  private static final String DEFAULT_FOOTER = "ขอบคุณที่อุดหนุน";

  private ReceiptFormBuilder() {}

  public static String build(
      JSONObject shop, JSONObject payload, String billNo, double total, int cols) {
    int width = cols <= 0 ? COLS_80 : cols;
    boolean compact = width <= COLS_58;

    String shopEn = firstNonEmpty(opt(shop, "shopName"), DEFAULT_SHOP_EN);
    String shopTh = firstNonEmpty(opt(shop, "shopNameTh"), DEFAULT_SHOP_TH);
    String shopName = shopDisplayName(shopEn, shopTh);
    String shopAddress = firstNonEmpty(opt(shop, "shopAddress"), DEFAULT_ADDRESS);
    String shopPhone = firstNonEmpty(opt(shop, "shopPhone"), DEFAULT_PHONE);
    String footerNote =
        firstNonEmpty(
            opt(shop, "receiptFooterNote"),
            opt(payload, "receiptFooterNote"),
            DEFAULT_FOOTER);
    String staffName =
        firstNonEmpty(opt(payload, "staffName"), opt(shop, "receiptStaffName"));
    String staffId = opt(payload, "staffId");

    String pay = payload != null ? payload.optString("paymentMethod", "") : "";
    double discount = payload != null ? payload.optDouble("discountBaht", 0) : 0;
    double subtotal =
        payload != null && payload.has("subtotal")
            ? payload.optDouble("subtotal", total)
            : inferSubtotal(payload, total, discount);
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
    String externalOrderId =
        payload != null ? payload.optString("externalOrderId", "").trim() : "";
    String orderNotes = payload != null ? payload.optString("orderNotes", "").trim() : "";

    String billDisplay = billDisplay(billNo);
    JSONArray lines = payload != null ? payload.optJSONArray("lines") : null;
    int itemCount = itemQtyTotal(lines);

    StringBuilder sb = new StringBuilder();
    sb.append(center(billDisplay, width)).append('\n');
    if (!customerName.isEmpty()) {
      sb.append(center(customerName, width)).append('\n');
    }
    sb.append(center(shopName, width)).append('\n');
    if (!shopAddress.isEmpty()) {
      for (String part : wrap(shopAddress, width)) {
        sb.append(center(part, width)).append('\n');
      }
    }
    if (!shopPhone.isEmpty()) {
      sb.append(center("โทร : " + shopPhone, width)).append('\n');
    }
    sb.append(center("ใบเสร็จ", width)).append('\n');

    if (!externalOrderId.isEmpty()) sb.append(metaRow("Order", externalOrderId, width));
    if (!staffName.isEmpty()) sb.append(metaRow("Staff", staffName, width));
    if (!staffId.isEmpty()) sb.append(metaRow("ID", staffId, width));
    sb.append(metaRow("วันที่", formatDate(createdAt), width));
    sb.append(metaRow("เวลา", formatTime(createdAt), width));
    sb.append(rule(width)).append('\n');

    if (lines != null) {
      for (int i = 0; i < lines.length(); i++) {
        JSONObject line = lines.optJSONObject(i);
        if (line == null) continue;
        appendItem(sb, line, width, compact);
      }
    }

    sb.append(rule(width)).append('\n');
    sb.append(moneyRow("จำนวน:", String.valueOf(itemCount), width)).append('\n');
    sb.append(moneyRow("รวม:", formatMoney(subtotal), width)).append('\n');
    if (discount > 0.0001) {
      sb.append(moneyRow("ส่วนลด", "-" + formatMoney(discount), width)).append('\n');
    }
    sb.append(doubleRule(width)).append('\n');
    sb.append(moneyRow("ยอดสุทธิ:", formatMoney(total), width)).append('\n');
    sb.append(doubleRule(width)).append('\n');
    sb.append(moneyRow("ชำระ", paymentLabel(pay), width)).append('\n');
    if ("cash".equals(pay)) {
      sb.append(moneyRow("เงินสด", formatMoney(cashReceived), width)).append('\n');
      sb.append(moneyRow("เงินทอน", formatMoney(change), width)).append('\n');
    }
    if (!orderNotes.isEmpty()) {
      sb.append(rule(width)).append('\n');
      for (String part : wrap(orderNotes, width)) {
        sb.append(part).append('\n');
      }
    }
    sb.append('\n');
    sb.append(center(footerNote, width)).append('\n');
    sb.append(center("TellTea POS", width)).append('\n');
    return sb.toString();
  }

  /** Default 80mm columns. */
  public static String build(JSONObject shop, JSONObject payload, String billNo, double total) {
    return build(shop, payload, billNo, total, COLS_80);
  }

  static String billDisplay(String billNo) {
    String raw = billNo == null || billNo.trim().isEmpty() ? "—" : billNo.trim();
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
    return "promptpay".equals(method) ? "PromptPay" : "เงินสด";
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

  private static void appendItem(StringBuilder sb, JSONObject line, int width, boolean compact) {
    int qty = line.optInt("qty", 1);
    double price = line.optDouble("price", 0);
    double lineTotal = Math.round(price * qty * 100.0) / 100.0;
    String title = receiptLineBaseName(line.optString("name", ""));
    String priceText = formatMoney(lineTotal);

    if (qtyEmphasized(qty)) {
      String left = "×" + qty + " " + title;
      sb.append(pairRow(left, priceText, width)).append('\n');
    } else {
      sb.append(pairRow(title, priceText, width)).append('\n');
    }

    for (ModTally mod : tallyModifiers(line.opt("options"), compact)) {
      String label = "• " + mod.label;
      if (mod.count > 1) label = label + " ×" + mod.count;
      for (String part : wrap("  " + label, width)) {
        sb.append(part).append('\n');
      }
    }
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
