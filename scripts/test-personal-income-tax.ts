/**
 * Pure tests for personal income tax + income bridge.
 */
import assert from "node:assert/strict";
import {
  buildIncomeBridge,
  computePersonalIncomeTax,
  DEFAULT_PERSONAL_ALLOWANCE,
  mapPersonalTaxSettings,
  proposeDeliveryGpDeduct,
  THAI_PIT_BRACKETS,
} from "../src/lib/personal-income-tax";

assert.equal(DEFAULT_PERSONAL_ALLOWANCE, 60_000);
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

{
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "exVat",
    gpDeduct: 10_000,
  });
  assert.equal(bridge.deliveryGross, 50_000);
  assert.equal(bridge.storefrontGross, 40_000);
  assert.equal(bridge.grossTotal, 90_000);
  assert.equal(bridge.gpDeduct, 10_000);
  assert.equal(bridge.pnlIncome, 80_000);
}

{
  // กำไร 200,000 − ลดหย่อน 60,000 = ภาษี 5% ของ 50,000 = 2,500
  const r = computePersonalIncomeTax(200_000, {
    personalAllowance: 60_000,
    otherDeductions: 0,
  });
  assert.equal(r.taxable, 140_000);
  assert.equal(r.tax, 0); // อยู่ในชั้น 0–150k
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

console.log("test-personal-income-tax: ok");
