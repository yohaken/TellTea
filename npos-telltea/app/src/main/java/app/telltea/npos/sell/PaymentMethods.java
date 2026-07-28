package app.telltea.npos.sell;

/**
 * Canonical POS tender codes.
 *
 * <ul>
 *   <li>{@code cash} — drawer cash; kicks cash drawer; counts toward expected drawer
 *   <li>{@code promptpay} — POS PromptPay QR (parked on counter UI)
 *   <li>{@code transfer} — customer bank transfer to shop account / sticker QR
 *       (staff verifies slip); no drawer; not in expected cash
 * </ul>
 */
public final class PaymentMethods {
  public static final String CASH = "cash";
  public static final String PROMPTPAY = "promptpay";
  public static final String TRANSFER = "transfer";

  private PaymentMethods() {}

  public static String normalize(String raw) {
    if (raw == null) return CASH;
    String m = raw.trim().toLowerCase(java.util.Locale.US);
    if (PROMPTPAY.equals(m)) return PROMPTPAY;
    if (TRANSFER.equals(m) || "bank".equals(m) || "bank_transfer".equals(m) || "โอน".equals(m)) {
      return TRANSFER;
    }
    return CASH;
  }

  public static boolean isCash(String raw) {
    return CASH.equals(normalize(raw));
  }

  public static boolean isPromptPay(String raw) {
    return PROMPTPAY.equals(normalize(raw));
  }

  public static boolean isTransfer(String raw) {
    return TRANSFER.equals(normalize(raw));
  }

  /** Thai label for receipts / shift UI. */
  public static String labelTh(String raw) {
    String m = normalize(raw);
    if (PROMPTPAY.equals(m)) return "PromptPay";
    if (TRANSFER.equals(m)) return "โอนเงิน";
    return "เงินสด";
  }

  /** Short slip tag. */
  public static String labelShort(String raw) {
    String m = normalize(raw);
    if (PROMPTPAY.equals(m)) return "PP";
    if (TRANSFER.equals(m)) return "โอน";
    return "สด";
  }
}
