package app.telltea.npos.sell;

/** PromptPay EMV payload (phone 10 digits or tax 13) — for QR / display. */
public final class PromptPayPayload {
  private PromptPayPayload() {}

  public static String normalize(String id) {
    if (id == null) return "";
    return id.replaceAll("\\D", "");
  }

  public static boolean isValid(String id) {
    String d = normalize(id);
    return (d.length() == 10 && d.startsWith("0")) || d.length() == 13;
  }

  public static String build(String promptPayId, double amount) {
    String digits = normalize(promptPayId);
    String merchantInfo;
    if (digits.length() == 10 && digits.startsWith("0")) {
      merchantInfo = tlv("01", tlv("01", "0066" + digits.substring(1)));
    } else if (digits.length() == 13) {
      merchantInfo = tlv("02", tlv("01", digits));
    } else {
      throw new IllegalArgumentException("invalid promptpay");
    }
    StringBuilder payload = new StringBuilder();
    payload.append(tlv("00", "01"));
    payload.append(tlv("01", amount > 0 ? "12" : "11"));
    payload.append(tlv("29", merchantInfo));
    payload.append(tlv("53", "764"));
    payload.append(tlv("58", "TH"));
    if (amount > 0) {
      payload.append(tlv("54", String.format(java.util.Locale.US, "%.2f", amount)));
    }
    payload.append("6304");
    return payload.toString() + crc16(payload.toString());
  }

  public static String qrImageUrl(String emvPayload) {
    try {
      return "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data="
          + java.net.URLEncoder.encode(emvPayload, "UTF-8");
    } catch (Exception e) {
      return "";
    }
  }

  private static String tlv(String id, String value) {
    return id + String.format(java.util.Locale.US, "%02d", value.length()) + value;
  }

  private static String crc16(String data) {
    int crc = 0xFFFF;
    for (int i = 0; i < data.length(); i++) {
      crc ^= (((int) data.charAt(i)) << 8);
      for (int j = 0; j < 8; j++) {
        if ((crc & 0x8000) != 0) crc = (crc << 1) ^ 0x1021;
        else crc <<= 1;
        crc &= 0xFFFF;
      }
    }
    return String.format(java.util.Locale.US, "%04X", crc);
  }
}
