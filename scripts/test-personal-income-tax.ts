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
  impliedGpPctFromTransfer,
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
assert.equal(
  resolveGpDeductAmount({
    mode: "transfer",
    pct: 0,
    amount: 1_400,
    deliveryGross: 21_400,
    netTransfer: 20_000,
  }),
  1_400,
);

assert.equal(impliedGpPctFromTransfer(700, 9300), 7);
assert.equal(impliedGpPctFromTransfer(0, 1000), 0);

{
  // มรดก amount: โอนจริง ≈ ขาย−คชจ. · P&L = ถึงร้าน (ไม่หักคชจ.ซ้ำ)
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 40_000,
    storefrontGrossSales: 42_800,
    mode: "incVat",
    gpDeductMode: "amount",
    gpDeduct: 10_000,
  });
  assert.equal(bridge.deliveryGross, 43_500); // 53500−10000 โอนจริง
  assert.equal(bridge.storefrontGross, 42_800);
  assert.equal(bridge.grossTotal, 86_300);
  assert.equal(bridge.gpDeduct, 10_000);
  assert.equal(bridge.pnlIncome, 86_300); // ถึงร้าน ไม่หักซ้ำ
  assert.equal(bridge.deliveryGpVat, gpVatFromFee(10_000, "incVat", 7));
}

{
  // โหมด% มรดก
  const bridge = buildIncomeBridge({
    deliveryVatBase: 50_000,
    deliveryGrossSales: 53_500,
    storefrontVatBase: 0,
    storefrontGrossSales: 0,
    mode: "incVat",
    gpDeductMode: "pct",
    gpDeductPct: 30,
  });
  assert.equal(bridge.gpDeduct, Math.round(53_500 * 0.3 * 100) / 100);
  assert.equal(bridge.deliveryGross, round2(53_500 - bridge.gpDeduct));
  assert.equal(bridge.pnlIncome, bridge.deliveryGross);
}

{
  // P&L จากยอดถึงร้าน · ไม่รับ gpDeduct เป็นตัวหัก
  assert.equal(pnlIncomeFromCashBridge(100_000, "incVat", 7), 100_000);
  assert.equal(
    pnlIncomeFromCashBridge(107_000, "exVat", 7),
    Math.round((107_000 * 100) / 107 * 100) / 100,
  );
  // arg เก่า gpDeduct ถูกละเลย
  assert.equal(pnlIncomeFromCashBridge(100_000, "incVat", 7, 9999), 100_000);
}

{
  // แยกช่องทาง: ยอดโอนจริง + คชจ.แยก · deliveryGross = รวมโอน (ไม่รวมหน้าร้าน)
  const gp = defaultGpByChannel(0, "transfer");
  gp.shopee = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 30_000,
    amount: 2_100,
  };
  gp.grab = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 28_000,
    amount: 4_100,
  };
  gp.lineman = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 27_000,
    amount: 5_100,
  };
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
  assert.equal(bridge.deliveryGross, 85_000); // 30+28+27k
  assert.ok(bridge.deliveryGross !== 85_000 + 42_800);
  const shopee = bridge.channelRows.find((r) => r.key === "shopee")!;
  const grab = bridge.channelRows.find((r) => r.key === "grab")!;
  const lm = bridge.channelRows.find((r) => r.key === "lineman")!;
  const sf = bridge.channelRows.find((r) => r.key === "storefront")!;
  assert.equal(shopee.netTransfer, 30_000);
  assert.equal(shopee.deduct, 2_100);
  assert.equal(grab.deduct, 4_100);
  assert.equal(lm.deduct, 5_100);
  assert.equal(sf.netTransfer, 42_800);
  assert.equal(sf.deduct, 0);
  assert.equal(bridge.gpDeduct, 11_300);
  assert.equal(bridge.pnlIncome, 85_000 + 42_800); // ไม่หักคชจ.ซ้ำ
  assert.equal(shopee.gpVat, gpVatFromFee(2_100, "incVat", 7));
  assert.equal(bridge.deliveryGpVat, round2(shopee.gpVat + grab.gpVat + lm.gpVat));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

{
  // override ภาษีซื้อจากใบกำกับ
  const gp = defaultGpByChannel(0, "transfer");
  gp.shopee = {
    ...emptyGpChannelDeduct(0, "transfer"),
    netTransfer: 80_000,
    amount: 27_000,
    gpVatOverride: 999,
  };
  gp.grab = emptyGpChannelDeduct(0, "transfer");
  gp.lineman = emptyGpChannelDeduct(0, "transfer");
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
  assert.equal(shopee.netTransfer, 80_000);
  assert.equal(shopee.deduct, 27_000);
  assert.equal(shopee.gpVat, 999);
  assert.equal(bridge.deliveryGross, 80_000);
  assert.equal(bridge.pnlIncome, 80_000);
  assert.equal(bridge.deliveryGpVat, 999);
}

{
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
  assert.equal(r.taxable, 340_000);
  assert.equal(r.tax, 11_500);
}

assert.equal(formatVatMoney(1234.5), "1,234.50");
assert.equal(formatVatMoney(0), "0.00");
assert.equal(formatVatPct(7), "7.00%");
assert.equal(formatVatInt(31.4), "31");

console.log("test-personal-income-tax: ok");
