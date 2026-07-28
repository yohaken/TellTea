/**
 * Pure tests for monthly VAT play-safe math (no Firebase).
 */
import assert from "node:assert/strict";
import {
  computeOutputVat,
  computeVatSegment,
  DEFAULT_VAT_LOGIC_RATES,
  EMPTY_DELIVERY_CHANNELS,
  EMPTY_STOREFRONT_TENDERS,
  floorMoney,
  formatThaiDateKey,
  getVatPeriodBoundary,
  mapVatLogicRates,
  proposePnlIncome,
  recomputeSegment,
  resolveGrossSales,
  sumDeliveryChannels,
  sumMonthlyTotals,
} from "../src/lib/vat-monthly";

// 7/107 of 10700 = 700
{
  const { outputVat, vatBase } = computeOutputVat(10700);
  assert.equal(outputVat, 700);
  assert.equal(vatBase, 10000);
}

assert.equal(floorMoney(10.999), 10.99);
assert.equal(floorMoney(0), 0);

assert.equal(resolveGrossSales(5000, 0), 5000);
assert.equal(resolveGrossSales(5000, 1200), 1200);
assert.equal(
  sumDeliveryChannels({ shopee: 100, grab: 200, lineman: 50 }),
  350,
);

{
  const seg = computeVatSegment({
    kind: "delivery",
    grossManual: 107000,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 100,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  assert.equal(seg.grossSales, 107000);
  assert.equal(seg.outputVat, 7000);
  assert.equal(seg.gpEstimate, 2333.33);
  assert.equal(seg.gpVatClaimed, 2286.66);
  assert.equal(seg.ingredientVatClaimed, 98);
  assert.equal(seg.inputVat, 2384.66);
  assert.equal(seg.netVat, 4615.34);
}

// breakdown overrides manual
{
  const seg = computeVatSegment({
    kind: "delivery",
    grossManual: 999999,
    channels: { shopee: 5350, grab: 3210, lineman: 2140 },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: { ...DEFAULT_VAT_LOGIC_RATES, inputClaimFactor: 1, floorInput: false },
  });
  assert.equal(seg.grossSales, 10700);
  assert.equal(seg.outputVat, 700);
}

{
  const seg = computeVatSegment({
    kind: "storefront",
    grossManual: 0,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { transfer: 8000, cash: 2700 },
    gpVat: 200,
    useGpEstimate: false,
    ingredientVat: 0,
    rates: { ...DEFAULT_VAT_LOGIC_RATES, inputClaimFactor: 1, floorInput: true },
  });
  assert.equal(seg.grossSales, 10700);
  assert.equal(seg.outputVat, 700);
  assert.equal(seg.gpVatClaimed, 200);
  assert.equal(seg.netVat, 500);
}

{
  const delivery = recomputeSegment({
    kind: "delivery",
    grossManual: 10700,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  const storefront = recomputeSegment({
    kind: "storefront",
    grossManual: 10700,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
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

{
  assert.equal(formatThaiDateKey("2026-07-01"), "1/7/2569");
  const p = getVatPeriodBoundary("2026-07", 1);
  assert.equal(p.startDateKey, "2026-07-01");
  assert.equal(p.endExclusiveDateKey, "2026-08-01");
  assert.equal(p.endInclusiveDateKey, "2026-07-31");
  assert.equal(p.labelInclusive, "00:00 น. 1/7/2569 → 23:59 น. 31/7/2569");
}

console.log("test-vat-monthly: ok");
