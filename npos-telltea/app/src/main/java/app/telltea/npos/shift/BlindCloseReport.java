package app.telltea.npos.shift;

/** Result of Wongnai-style blind shift close (native POS). */
public final class BlindCloseReport {
  public final double openingCash;
  public final double cashSales;
  public final double promptpaySales;
  public final double transferSales;
  public final int cashBills;
  public final int promptpayBills;
  public final int transferBills;
  public final int saleCount;
  public final int voidedCount;
  public final double discountTotal;
  public final double cashOutTotal;
  public final double cashInTotal;
  public final int cashDropCount;
  public final double expectedCash;
  public final double countedCash;
  public final double cashDifference;
  public final double leaveFloat;
  public final String discrepancyNote;

  public BlindCloseReport(
      double openingCash,
      double cashSales,
      double promptpaySales,
      double transferSales,
      int cashBills,
      int promptpayBills,
      int transferBills,
      int saleCount,
      int voidedCount,
      double discountTotal,
      double cashOutTotal,
      double cashInTotal,
      int cashDropCount,
      double countedCash,
      double leaveFloat,
      String discrepancyNote) {
    this.openingCash = openingCash;
    this.cashSales = cashSales;
    this.promptpaySales = promptpaySales;
    this.transferSales = transferSales;
    this.cashBills = cashBills;
    this.promptpayBills = promptpayBills;
    this.transferBills = transferBills;
    this.saleCount = saleCount;
    this.voidedCount = voidedCount;
    this.discountTotal = discountTotal;
    this.cashOutTotal = Math.max(0, cashOutTotal);
    this.cashInTotal = Math.max(0, cashInTotal);
    this.cashDropCount = Math.max(0, cashDropCount);
    this.expectedCash = openingCash + cashSales - this.cashOutTotal + this.cashInTotal;
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
