package app.telltea.npos.printer;

/**
 * Cash-drawer policy for counter hardware.
 *
 * Drawer is attached to the selected receipt printer (ESC/POS kick), not a
 * separate Bluetooth/USB device. Keep kick moments deterministic.
 *
 * Auto kick:
 * - cash sale — queued on the printer thread before the receipt so the drawer
 *   opens while paper prints (staff can make change immediately)
 *
 * Never auto kick:
 * - PromptPay
 * - bank transfer (โอนเงิน — sticker QR / account)
 * - reprint / reprint-only flows
 * - X snapshot / Z close reports
 * - open shift / close shift UI alone
 *
 * Manual kick:
 * - Settings → test drawer
 * - Sell hub → เปิดลิ้นชัก (No Sale) — always logged
 */
public final class CashDrawerPolicy {
  private CashDrawerPolicy() {}

  /** True when a completed cash sale should pulse the drawer (queued before paper). */
  public static boolean shouldKickAfterSale(String paymentMethod) {
    return app.telltea.npos.sell.PaymentMethods.isCash(paymentMethod);
  }

  /** Shift X/Z reports are documents only — never open the drawer. */
  public static boolean shouldKickAfterShiftReport() {
    return false;
  }

  /** Reprints must not open the drawer (already handled cash at sale time). */
  public static boolean shouldKickOnReprint() {
    return false;
  }
}
