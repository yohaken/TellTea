/**
 * Pure tests for monthly VAT play-safe math (no Firebase).
 */
import assert from "node:assert/strict";
import {
  computeOutputVat,
  computeVatSegment,
  DEFAULT_VAT_LOGIC_RATES,
  floorMoney,
  formatThaiDateKey,
  getVatPeriodBoundary,
  mapVatLogicRates,
  proposePnlIncome,
  recomputeSegment,
  sumMonthlyTotals,
} from "../src/lib/vat-monthly";

// 7/107 of 10700 = 700
{
  const { outputVat, vatBase } = computeOutputVat(10700);
  assert.equal(outputVat, 700);
  assert.equal(vatBase, 10000);
}

// floorMoney play-safe
assert.equal(floorMoney(10.999), 10.99);
assert.equal(floorMoney(0), 0);

// segment: GP estimate ~1/3 of output, claim 0.98, floor
{
  const seg = computeVatSegment({
    grossSales: 107000,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 100,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  // output = 107000 * 7/107 = 7000
  assert.equal(seg.outputVat, 7000);
  // gpEstimate = floor(7000/3) = floor(2333.333...) = 2333.33
  assert.equal(seg.gpEstimate, 2333.33);
  // gpClaimed = floor(2333.33 * 0.98) = floor(2286.6634) = 2286.66
  assert.equal(seg.gpVatClaimed, 2286.66);
  // ingredient = floor(100 * 0.98) = 98
  assert.equal(seg.ingredientVatClaimed, 98);
  assert.equal(seg.inputVat, 2384.66);
  assert.equal(seg.netVat, 4615.34);
}

// manual GP overrides estimate
{
  const seg = computeVatSegment({
    grossSales: 10700,
    gpVat: 200,
    useGpEstimate: false,
    ingredientVat: 0,
    rates: { ...DEFAULT_VAT_LOGIC_RATES, inputClaimFactor: 1, floorInput: true },
  });
  assert.equal(seg.outputVat, 700);
  assert.equal(seg.gpVatClaimed, 200);
  assert.equal(seg.netVat, 500);
}

// different rates per segment
{
  const delivery = recomputeSegment({
    grossSales: 10700,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  const storefront = recomputeSegment({
    grossSales: 10700,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: mapVatLogicRates({
      outputNum: 7,
      outputDen: 107,
      gpOfOutput: 0.25,
      inputClaimFactor: 1,
      floorInput: true,
    }),
  });
  const totals = sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );
  assert.equal(totals.grossSales, 21400);
  assert.equal(totals.outputVat, 1400);
  assert.ok(delivery.gpVatClaimed !== storefront.gpVatClaimed);
  assert.equal(proposePnlIncome(totals, "exVat"), totals.vatBase);
  assert.equal(proposePnlIncome(totals, "incVat"), totals.grossSales);
}

// รอบตัดยอด: 00:00 1/7/2569 → 00:00 1/8/2569 (ไม่รวม)
{
  assert.equal(formatThaiDateKey("2026-07-01"), "1/7/2569");
  const p = getVatPeriodBoundary("2026-07", 1);
  assert.equal(p.startDateKey, "2026-07-01");
  assert.equal(p.endExclusiveDateKey, "2026-08-01");
  assert.equal(p.endInclusiveDateKey, "2026-07-31");
  assert.equal(p.labelInclusive, "00:00 น. 1/7/2569 → 23:59 น. 31/7/2569");
  assert.equal(
    p.labelExclusive,
    "00:00 น. 1/7/2569 → 00:00 น. 1/8/2569 (ไม่รวม)",
  );
}

console.log("test-vat-monthly: ok");
