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
  pnlIncomeFromCashBridge,
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
  // ตาราง GP = เงินเข้าร้านรวม VAT · ไม่หัก 7% ที่คอลัมน์รายได้
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "incVat",
    gpDeductMode: "amount",
    gpDeduct: 10_000,
  });
  assert.equal(bridge.deliveryGross, 53_500);
  assert.equal(bridge.storefrontGross, 42_800);
  assert.equal(bridge.grossTotal, 96_300);
  assert.equal(bridge.gpDeductMode, "amount");
  assert.equal(bridge.gpDeduct, 10_000);
  assert.equal(bridge.pnlIncome, 86_300);
  // คชจ.รวม VAT → ภาษีซื้อประมาณ ×7/107
  assert.equal(bridge.deliveryGpVat, gpVatFromFee(10_000, "incVat", 7));
  assert.equal(bridge.deliveryGpVat, Math.round(((10_000 * 7) / 107) * 100) / 100);
  assert.equal(bridge.storefrontGpVat, 0);
  assert.equal(bridge.gpVatTotal, bridge.deliveryGpVat);
}

{
  // โหมดเรท % คงที่ — หักจากเงินเข้าร้าน
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "incVat",
    gpDeductMode: "pct",
    gpDeductPct: 30,
  });
  assert.equal(bridge.gpDeductMode, "pct");
  assert.equal(bridge.gpDeductPct, 30);
  assert.equal(bridge.gpDeduct, Math.round(53_500 * 0.3 * 100) / 100);
  assert.equal(bridge.pnlIncome, round2(96_300 - bridge.gpDeduct));
}

{
  // default = pct 30% บนยอดรวม VAT
  const bridge = buildIncomeBridge({
    deliveryVatBase: 100_000,
    deliveryGrossSales: 107_000,
    storefrontVatBase: 0,
    storefrontGrossSales: 0,
    mode: "incVat",
  });
  assert.equal(bridge.gpDeductMode, "pct");
  assert.equal(bridge.gpDeductPct, DEFAULT_GP_DEDUCT_PCT);
  assert.equal(bridge.gpDeduct, Math.round(107_000 * 0.3 * 100) / 100);
  assert.equal(bridge.pnlIncome, round2(107_000 - bridge.gpDeduct));
}

{
  // โหมดก่อน VAT = แปลงยอดสุทธิหลังหักคชจ. ไม่หักที่คอลัมน์รายได้
  assert.equal(pnlIncomeFromCashBridge(107_000, 7_000, "incVat", 7), 100_000);
  assert.equal(
    pnlIncomeFromCashBridge(107_000, 7_000, "exVat", 7),
    Math.round((100_000 * 100) / 107 * 100) / 100,
  );
}

{
  // หัก GP แยกช่องทาง — รายได้ = รวม VAT · หน้าร้านไม่รวมใน deliveryGross
  const gp = defaultGpByChannel(30, "pct");
  gp.grab = { ...emptyGpChannelDeduct(25, "pct") };
  gp.lineman = { ...emptyGpChannelDeduct(0, "amount"), amount: 1_000 };
  gp.storefront = emptyGpChannelDeduct(0, "pct");
  const bridge = buildIncomeBridge({
    deliveryVatBase: 90_000,
    deliveryGrossSales: 96_300,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "incVat",
    deliveryChannels: { shopee: 32_100, grab: 32_100, lineman: 32_100 },
    outputPct: 7,
    gpByChannel: gp,
  });
  assert.equal(bridge.channelRows.length, 4);
  assert.equal(bridge.deliveryGross, 96_300);
  assert.ok(bridge.deliveryGross !== 96_300 + 42_800);
  const shopee = bridge.channelRows.find((r) => r.key === "shopee");
  const grab = bridge.channelRows.find((r) => r.key === "grab");
  const lm = bridge.channelRows.find((r) => r.key === "lineman");
  const sf = bridge.channelRows.find((r) => r.key === "storefront");
  assert.ok(shopee && grab && lm && sf);
  assert.equal(shopee.gross, 32_100);
  assert.equal(shopee.deduct, Math.round(32_100 * 0.3 * 100) / 100);
  assert.equal(grab.deduct, Math.round(32_100 * 0.25 * 100) / 100);
  assert.equal(lm.deduct, 1_000);
  assert.equal(sf.deduct, 0);
  assert.equal(sf.gross, 42_800);
  assert.equal(bridge.gpDeduct, round2(shopee.deduct + grab.deduct + lm.deduct));
  assert.equal(bridge.pnlIncome, round2(96_300 + 42_800 - bridge.gpDeduct));
  // ภาษีซื้อประมาณจากคชจ.×7/107
  assert.equal(shopee.gpVat, gpVatFromFee(shopee.deduct, "incVat", 7));
  assert.equal(grab.gpVat, gpVatFromFee(grab.deduct, "incVat", 7));
  assert.equal(lm.gpVat, gpVatFromFee(1_000, "incVat", 7));
  assert.equal(sf.gpVat, 0);
  assert.equal(bridge.deliveryGpVat, round2(shopee.gpVat + grab.gpVat + lm.gpVat));
  assert.equal(bridge.gpVatTotal, bridge.deliveryGpVat);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

{
  // ยอดโอนจริง → คชจ. = เงินเข้าร้าน − โอนหลัง (ฐานเดียวกัน รวม VAT)
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
    mode: "incVat",
    deliveryChannels: { shopee: 32_100, grab: 32_100, lineman: 32_100 },
    outputPct: 7,
    gpByChannel: gp,
  });
  const shopee = bridge.channelRows.find((r) => r.key === "shopee")!;
  const grab = bridge.channelRows.find((r) => r.key === "grab")!;
  const lm = bridge.channelRows.find((r) => r.key === "lineman")!;
  assert.equal(shopee.gross, 32_100);
  assert.equal(shopee.deduct, 11_100); // 32100 − 21000
  assert.equal(grab.deduct, 8_100);
  assert.equal(lm.deduct, 5_100);
  assert.equal(bridge.gpDeduct, 24_300);
  assert.equal(
    bridge.deliveryGpVat,
    round2(
      gpVatFromFee(11_100, "incVat", 7) +
        gpVatFromFee(8_100, "incVat", 7) +
        gpVatFromFee(5_100, "incVat", 7),
    ),
  );
  assert.equal(bridge.weightedAvgPct, round2((24_300 / 96_300) * 100));
}

{
  // override ภาษีซื้อ GP จากใบกำกับ
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
