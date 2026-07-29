/**
 * Pure tests for personal income tax + income bridge + GP deduct modes.
 */
import assert from "node:assert/strict";
import {
  buildIncomeBridge,
  computePersonalIncomeTax,
  DEFAULT_GP_DEDUCT_PCT,
  DEFAULT_PERSONAL_ALLOWANCE,
  mapPersonalTaxSettings,
  proposeDeliveryGpDeduct,
  proposeGpDeductPct,
  resolveGpDeductAmount,
  THAI_PIT_BRACKETS,
} from "../src/lib/personal-income-tax";
import {
  formatVatInt,
  formatVatMoney,
  formatVatPct,
} from "../src/lib/vat-number-format";

assert.equal(DEFAULT_PERSONAL_ALLOWANCE, 60_000);
assert.equal(DEFAULT_GP_DEDUCT_PCT, 30);
assert.ok(THAI_PIT_BRACKETS.length >= 8);
assert.equal(THAI_PIT_BRACKETS[0]?.rate, 0);
assert.equal(THAI_PIT_BRACKETS[THAI_PIT_BRACKETS.length - 1]?.rate, 0.35);

{
  const s = mapPersonalTaxSettings(undefined);
  assert.equal(s.personalAllowance, 60_000);
  assert.equal(s.otherDeductions, 0);
}

// GP VAT 7% → ต้นทุนก่อน VAT = vat * 100/7
assert.equal(proposeDeliveryGpDeduct({ gpVatClaimed: 700, gpEstimate: 0, outputPct: 7 }), 10_000);

assert.equal(proposeGpDeductPct(50_000, 10_000), 20);
assert.equal(proposeGpDeductPct(0, 10_000), DEFAULT_GP_DEDUCT_PCT);

assert.equal(
  resolveGpDeductAmount({
    mode: "pct",
    pct: 30,
    amount: 999,
    deliveryGross: 50_000,
  }),
  15_000,
);
assert.equal(
  resolveGpDeductAmount({
    mode: "amount",
    pct: 30,
    amount: 10_000,
    deliveryGross: 50_000,
  }),
  10_000,
);

{
  // โหมดยอดบาท — หักตามยอดที่ใส่
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "exVat",
    gpDeductMode: "amount",
    gpDeduct: 10_000,
  });
  assert.equal(bridge.deliveryGross, 50_000);
  assert.equal(bridge.storefrontGross, 40_000);
  assert.equal(bridge.grossTotal, 90_000);
  assert.equal(bridge.gpDeductMode, "amount");
  assert.equal(bridge.gpDeduct, 10_000);
  assert.equal(bridge.pnlIncome, 80_000);
}

{
  // โหมดเรท % คงที่ — หัก deliveryGross × pct%
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "exVat",
    gpDeductMode: "pct",
    gpDeductPct: 30,
  });
  assert.equal(bridge.gpDeductMode, "pct");
  assert.equal(bridge.gpDeductPct, 30);
  assert.equal(bridge.gpDeduct, 15_000);
  assert.equal(bridge.pnlIncome, 75_000);
}

{
  // default = pct 30%
  const bridge = buildIncomeBridge({
    deliveryVatBase: 100_000,
    deliveryGrossSales: 107_000,
    storefrontVatBase: 0,
    storefrontGrossSales: 0,
    mode: "exVat",
  });
  assert.equal(bridge.gpDeductMode, "pct");
  assert.equal(bridge.gpDeductPct, DEFAULT_GP_DEDUCT_PCT);
  assert.equal(bridge.gpDeduct, 30_000);
  assert.equal(bridge.pnlIncome, 70_000);
}

{
  // กำไร 200,000 − ลดหย่อน 60,000 = taxable 140k อยู่ในชั้น 0%
  const r = computePersonalIncomeTax(200_000, {
    personalAllowance: 60_000,
    otherDeductions: 0,
  });
  assert.equal(r.taxable, 140_000);
  assert.equal(r.tax, 0);
}

{
  const r = computePersonalIncomeTax(400_000, {
    personalAllowance: 60_000,
    otherDeductions: 0,
  });
  // taxable 340,000 → 150k@0 + 150k@5% + 40k@10% = 0 + 7500 + 4000 = 11500
  assert.equal(r.taxable, 340_000);
  assert.equal(r.tax, 11_500);
}

assert.equal(formatVatMoney(1234.5), "1,234.50");
assert.equal(formatVatMoney(0), "0.00");
assert.equal(formatVatPct(7), "7.00%");
assert.equal(formatVatInt(31.4), "31");

console.log("test-personal-income-tax: ok");
