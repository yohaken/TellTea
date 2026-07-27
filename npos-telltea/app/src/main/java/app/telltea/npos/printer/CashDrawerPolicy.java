package app.telltea.npos.printer;

/**
 * Cash-drawer policy for counter hardware.
 *
 * Drawer is attached to the selected receipt printer (ESC/POS kick), not a
 * separate Bluetooth/USB device. Keep kick moments deterministic.
 *
 * Auto kick:
 * - cash sale after a successful receipt print
 *
 * Never auto kick:
 * - PromptPay
 * - reprint / reprint-only flows
 * - X snapshot / Z close reports
 * - open shift / close shift UI alone
 *
 * Manual kick:
 * - Settings → test drawer only
 */
public final class CashDrawerPolicy {
  private CashDrawerPolicy() {}

  /** True when a completed sale should pulse the drawer after paper prints. */
  public static boolean shouldKickAfterSale(String paymentMethod) {
    return "cash".equals(paymentMethod);
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
