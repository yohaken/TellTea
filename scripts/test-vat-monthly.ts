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

{
  const { outputVat, vatBase } = computeOutputVat(10700);
  assert.equal(outputVat, 700);
  assert.equal(vatBase, 10000);
}

assert.equal(floorMoney(10.999), 10.99);
assert.equal(resolveGrossSales(5000, 0), 5000);
assert.equal(resolveGrossSales(5000, 1200), 1200);
assert.equal(
  sumDeliveryChannels({ shopee: 100, grab: 200, lineman: 50 }),
  350,
);

// outputPct 7% ≡ 7/107
{
  const r = mapVatLogicRates({ outputPct: 7 });
  assert.equal(r.outputPct, 7);
  assert.equal(r.outputNum, 7);
  assert.equal(r.outputDen, 107);
}

{
  const seg = computeVatSegment({
    kind: "delivery",
    grossManual: 107000,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 100,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  assert.equal(seg.reportedGross, 107000);
  assert.equal(seg.remitAmount, 107000);
  assert.equal(seg.grossSales, 107000);
  assert.equal(seg.outputVat, 7000);
  assert.equal(seg.gpEstimate, 2333.33);
  assert.equal(seg.gpVatClaimed, 2286.66);
  assert.equal(seg.netVat, 4615.34);
}

// หน้าร้าน: รายได้ 10000 · นำส่ง 90% → คิด VAT จาก 9000
{
  const seg = computeVatSegment({
    kind: "storefront",
    grossManual: 10000,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    remitPct: 90,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: { ...DEFAULT_VAT_LOGIC_RATES, inputClaimFactor: 1, floorInput: false },
  });
  assert.equal(seg.reportedGross, 10000);
  assert.equal(seg.remitAmount, 9000);
  assert.equal(seg.grossSales, 9000);
  // 9000 * 7/107 → 588.785… → 588.79
  assert.equal(seg.outputVat, 588.79);
}

{
  const delivery = recomputeSegment({
    kind: "delivery",
    grossManual: 10700,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: DEFAULT_VAT_LOGIC_RATES,
  });
  const storefront = recomputeSegment({
    kind: "storefront",
    grossManual: 10700,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { transfer: 0, cash: 0 },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: mapVatLogicRates({
      outputPct: 7,
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
  assert.equal(proposePnlIncome(totals, "exVat"), totals.vatBase);
}

{
  assert.equal(formatThaiDateKey("2026-07-01"), "1/7/2569");
  const p = getVatPeriodBoundary("2026-07", 1);
  assert.equal(p.labelInclusive, "00:00 น. 1/7/2569 → 23:59 น. 31/7/2569");
}

console.log("test-vat-monthly: ok");
