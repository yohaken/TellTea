package app.telltea.npos.shift;

/** Result of Wongnai-style blind shift close (native POS). */
public final class BlindCloseReport {
  public final double openingCash;
  public final double cashSales;
  public final double promptpaySales;
  public final int cashBills;
  public final int promptpayBills;
  public final int saleCount;
  public final int voidedCount;
  public final double discountTotal;
  public final double expectedCash;
  public final double countedCash;
  public final double cashDifference;
  public final double leaveFloat;
  public final String discrepancyNote;

  public BlindCloseReport(
      double openingCash,
      double cashSales,
      double promptpaySales,
      int cashBills,
      int promptpayBills,
      int saleCount,
      int voidedCount,
      double discountTotal,
      double countedCash,
      double leaveFloat,
      String discrepancyNote) {
    this.openingCash = openingCash;
    this.cashSales = cashSales;
    this.promptpaySales = promptpaySales;
    this.cashBills = cashBills;
    this.promptpayBills = promptpayBills;
    this.saleCount = saleCount;
    this.voidedCount = voidedCount;
    this.discountTotal = discountTotal;
    this.expectedCash = openingCash + cashSales;
    this.countedCash = countedCash;
    this.cashDifference = countedCash - this.expectedCash;
    this.leaveFloat = Math.max(0, leaveFloat);
    this.discrepancyNote = discrepancyNote == null ? "" : discrepancyNote.trim();
  }

  public boolean isBalanced() {
    return Math.abs(cashDifference) < 0.5;
  }

  public String discrepancyLabel() {
    if (isBalanced()) return "ตรง";
    if (cashDifference > 0) return "เกิน (Over)";
    return "ขาด (Short)";
  }
}
