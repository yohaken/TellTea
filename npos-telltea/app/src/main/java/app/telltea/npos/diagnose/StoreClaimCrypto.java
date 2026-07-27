package app.telltea.npos.diagnose;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Store-code hash — must match functions/npos-device-gate.js */
public final class StoreClaimCrypto {
  private static final String PREFIX = "telltea-store-claim:v1:";

  private StoreClaimCrypto() {}

  public static String normalize(String code) {
    if (code == null) return "";
    return code.trim().toUpperCase().replaceAll("[\\s\\-]", "");
  }

  public static boolean isValidShape(String code) {
    String n = normalize(code);
    return n.length() >= 4 && n.length() <= 16 && n.matches("^[A-Z0-9]+$");
  }

  public static String hash(String code) {
    String n = normalize(code);
    if (n.length() < 4) return "";
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] dig = md.digest((PREFIX + n).getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder(dig.length * 2);
      for (byte b : dig) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (Exception e) {
      return "";
    }
  }

  public static boolean matchesCachedHash(String code, String cachedHash) {
    if (cachedHash == null || cachedHash.length() < 32) return false;
    String h = hash(code);
    return !h.isEmpty() && h.equalsIgnoreCase(cachedHash.trim());
  }
}
