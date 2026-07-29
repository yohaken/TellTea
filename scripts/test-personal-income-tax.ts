/**
 * Pure tests for personal income tax + income bridge + GP deduct modes.
 */
import assert from "node:assert/strict";
import {
  buildIncomeBridge,
  computePersonalIncomeTax,
  DEFAULT_GP_DEDUCT_PCT,
  DEFAULT_PERSONAL_ALLOWANCE,
  defaultGpByChannel,
  emptyGpChannelDeduct,
  gpVatFromFee,
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
  // โหมดก่อน VAT → ภาษีซื้อ GP = คชจ. × 7/100
  assert.equal(bridge.deliveryGpVat, gpVatFromFee(10_000, "exVat", 7));
  assert.equal(bridge.deliveryGpVat, 700);
  assert.equal(bridge.storefrontGpVat, 0);
  assert.equal(bridge.gpVatTotal, 700);
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
  // หัก GP แยกช่องทาง — Shopee 30% · Grab 25% · LM ยอด fix · หน้าร้าน 0
  const gp = defaultGpByChannel(30, "pct");
  gp.grab = { ...emptyGpChannelDeduct(25, "pct") };
  gp.lineman = { ...emptyGpChannelDeduct(0, "amount"), amount: 1_000 };
  gp.storefront = emptyGpChannelDeduct(0, "pct");
  const bridge = buildIncomeBridge({
    deliveryVatBase: 90_000,
    deliveryGrossSales: 96_300,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "exVat",
    deliveryChannels: { shopee: 32_100, grab: 32_100, lineman: 32_100 },
    outputPct: 7,
    gpByChannel: gp,
  });
  // แต่ละช่องทางก่อน VAT ≈ 30,000
  assert.equal(bridge.channelRows.length, 4);
  const shopee = bridge.channelRows.find((r) => r.key === "shopee");
  const grab = bridge.channelRows.find((r) => r.key === "grab");
  const lm = bridge.channelRows.find((r) => r.key === "lineman");
  const sf = bridge.channelRows.find((r) => r.key === "storefront");
  assert.ok(shopee && grab && lm && sf);
  assert.equal(shopee.deduct, 9_000); // 30k × 30%
  assert.equal(grab.deduct, 7_500); // 30k × 25%
  assert.equal(lm.deduct, 1_000); // fix
  assert.equal(sf.deduct, 0);
  assert.equal(bridge.gpDeduct, 17_500);
  assert.equal(bridge.storefrontGross, 40_000);
  assert.equal(bridge.pnlIncome, 90_000 + 40_000 - 17_500);
  // ภาษีซื้อ GP รายช่องทาง (ก่อน VAT → ×7/100)
  assert.equal(shopee.gpVat, 630); // 9000×7%
  assert.equal(grab.gpVat, 525);
  assert.equal(lm.gpVat, 70);
  assert.equal(sf.gpVat, 0);
  assert.equal(bridge.deliveryGpVat, 630 + 525 + 70);
  assert.equal(bridge.gpVatTotal, bridge.deliveryGpVat);
  assert.equal(bridge.weightedAvgPct, round2((17_500 / 90_000) * 100));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

{
  // ยอดโอนจริง → คชจ. = รายได้ − โอนหลัง
  const gp = defaultGpByChannel(0, "transfer");
  gp.shopee = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 21_000,
  };
  gp.grab = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 24_000,
  };
  gp.lineman = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 27_000,
  };
  const bridge = buildIncomeBridge({
    deliveryVatBase: 90_000,
    deliveryGrossSales: 96_300,
    storefrontVatBase: 10_000,
    storefrontGrossSales: 10_700,
    mode: "exVat",
    deliveryChannels: { shopee: 32_100, grab: 32_100, lineman: 32_100 },
    outputPct: 7,
    gpByChannel: gp,
  });
  const shopee = bridge.channelRows.find((r) => r.key === "shopee")!;
  const grab = bridge.channelRows.find((r) => r.key === "grab")!;
  const lm = bridge.channelRows.find((r) => r.key === "lineman")!;
  assert.equal(shopee.gross, 30_000);
  assert.equal(shopee.deduct, 9_000); // 30k − 21k
  assert.equal(grab.deduct, 6_000);
  assert.equal(lm.deduct, 3_000);
  assert.equal(bridge.gpDeduct, 18_000);
  assert.equal(bridge.deliveryGpVat, 630 + 420 + 210);
  assert.equal(bridge.weightedAvgPct, 20); // 18k / 90k
}

{
  // override ภาษีซื้อ GP จากใบกำกับ · โหมดรวม VAT → คชจ.×7/107
  const gp = defaultGpByChannel(0, "transfer");
  gp.shopee = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 80_000,
    gpVatOverride: 999,
  };
  gp.grab = emptyGpChannelDeduct(0, "pct");
  gp.lineman = emptyGpChannelDeduct(0, "pct");
  const bridge = buildIncomeBridge({
    deliveryVatBase: 100_000,
    deliveryGrossSales: 107_000,
    storefrontVatBase: 0,
    storefrontGrossSales: 0,
    mode: "incVat",
    deliveryChannels: { shopee: 107_000, grab: 0, lineman: 0 },
    outputPct: 7,
    gpByChannel: gp,
  });
  const shopee = bridge.channelRows.find((r) => r.key === "shopee")!;
  assert.equal(shopee.gross, 107_000);
  assert.equal(shopee.deduct, 27_000); // 107k − 80k
  assert.equal(shopee.gpVat, 999); // override
  assert.equal(
    gpVatFromFee(27_000, "incVat", 7),
    Math.round(((27_000 * 7) / 107) * 100) / 100,
  );
  assert.equal(bridge.deliveryGpVat, 999);
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
