/**
 * เทสแหล่งยอด VAT สรุปรายเดือน (ไม่ใช่รายวัน)
 */
import assert from "node:assert/strict";
import {
  applyChannelSourceToDraft,
  applyMonthSourcesToDraft,
  DELIVERY_COL_INFO,
  DELIVERY_SOURCE_GUIDE,
  draftToMonthSources,
  emptyChannelSource,
  grabCsvToMonthSource,
  linemanMonthlyToMonthSource,
  mergeGrabMonthSources,
  shopeeMonthlySource,
  sumMonthSources,
} from "../src/lib/vat-month-sources";
import { emptyMonthBooksDraft } from "../src/lib/vat-month-books";
import type { GrabCsvParseResult } from "../src/lib/vat-import-grab-csv";
import type { LinemanMonthlyParseResult } from "../src/lib/vat-import-lineman-monthly";

function testDraftRoundTrip() {
  let draft = emptyMonthBooksDraft("2026-07");
  draft = applyChannelSourceToDraft(draft, {
    channel: "shopee",
    sales: 10000,
    transfer: 8500,
    fee: 1500,
    gpVat: 98.13,
    kind: "shopee-monthly",
    dayCount: 0,
    note: "test",
  });
  draft = applyChannelSourceToDraft(draft, {
    channel: "grab",
    sales: 20000,
    transfer: 17000,
    fee: 3000,
    gpVat: 196.26,
    kind: "grab-rollup",
    dayCount: 12,
    note: "rollup",
  });
  const view = draftToMonthSources(draft);
  assert.equal(view.byChannel.shopee.sales, 10000);
  assert.equal(view.byChannel.grab.transfer, 17000);
  assert.equal(view.totals.sales, 30000);
  assert.equal(view.totals.fee, 4500);
  console.log("ok draft round-trip");
}

function testGrabRollup() {
  const parsed: GrabCsvParseResult = {
    adapterId: "grab-transaction-csv",
    adapterVersion: "1",
    monthKey: "2026-07",
    headers: [],
    warnings: [],
    days: [
      {
        dateKey: "2026-07-01",
        grossInclusive: 1000,
        fee: 150,
        netTransfer: 850,
        gpVat: 9.81,
        lineCount: 3,
      },
      {
        dateKey: "2026-07-02",
        grossInclusive: 2000,
        fee: 300,
        netTransfer: 1700,
        gpVat: 19.63,
        lineCount: 5,
      },
    ],
  };
  const src = grabCsvToMonthSource(parsed);
  assert.equal(src.channel, "grab");
  assert.equal(src.kind, "grab-rollup");
  assert.equal(src.dayCount, 2);
  assert.equal(src.sales, 3000);
  assert.equal(src.transfer, 2550);
  assert.equal(src.fee, 450);
  assert.ok(src.gpVat > 0);

  const merged = mergeGrabMonthSources([
    src,
    grabCsvToMonthSource({
      ...parsed,
      days: [
        {
          dateKey: "2026-07-03",
          grossInclusive: 500,
          fee: 50,
          netTransfer: 450,
          gpVat: 3.27,
          lineCount: 1,
        },
      ],
    }),
  ]);
  assert.equal(merged.sales, 3500);
  assert.equal(merged.dayCount, 3);
  console.log("ok grab rollup");
}

function testLinemanMonthly() {
  const parsed: LinemanMonthlyParseResult = {
    adapterId: "lineman-monthly-pdf",
    adapterVersion: "1",
    monthKey: "2026-07",
    storeLabel: "TellTea",
    monthGross: 42504,
    monthFeeInclVat: 13643.97,
    monthTransferOut: 20000,
    days: [],
    warnings: [],
  };
  const src = linemanMonthlyToMonthSource(parsed);
  assert.equal(src.channel, "lineman");
  assert.equal(src.kind, "lineman-monthly");
  assert.equal(src.dayCount, 0);
  assert.equal(src.sales, 42504);
  assert.equal(src.fee, 13643.97);
  assert.equal(src.transfer, 28860.03); // 42504 - 13643.97
  assert.ok(src.gpVat > 0);
  console.log("ok lineman monthly totals");
}

function testShopeeHelper() {
  const src = shopeeMonthlySource({
    sales: 50000,
    transfer: 42000,
    fee: 8000,
  });
  assert.equal(src.kind, "shopee-monthly");
  assert.equal(src.sales, 50000);
  assert.ok(src.gpVat > 0);
  console.log("ok shopee monthly helper");
}

function testApplyAll() {
  const draft0 = emptyMonthBooksDraft("2026-07");
  const sources = draftToMonthSources(draft0);
  sources.byChannel.shopee = shopeeMonthlySource({
    sales: 1,
    transfer: 2,
    fee: 3,
    gpVat: 0.2,
  });
  sources.byChannel.lineman = {
    ...emptyChannelSource("lineman"),
    sales: 4,
    transfer: 5,
    fee: 6,
    gpVat: 0.4,
  };
  sources.totals = sumMonthSources(sources.byChannel);
  const next = applyMonthSourcesToDraft(draft0, sources);
  assert.equal(next.sales.shopee, 1);
  assert.equal(next.transfer.lineman, 5);
  assert.equal(next.gpFee.shopee, 3);
  console.log("ok apply all channels");
}

function testColInfoForHumansAndAi() {
  assert.match(DELIVERY_COL_INFO.appSales, /ยอดขายแอพ/);
  assert.match(DELIVERY_COL_INFO.transfer, /บัญชีธนาคาร|เงินเข้า/);
  assert.match(DELIVERY_COL_INFO.gpFee, /ไม่หักซ้ำ|อ้างอิง/);
  assert.match(DELIVERY_COL_INFO.purchaseVat, /ภาษีซื้อ|VAT-ซื้อ/);
  assert.match(DELIVERY_SOURCE_GUIDE.overview, /พรีวิว|ยังไม่ผสาน/);
  assert.ok(DELIVERY_SOURCE_GUIDE.overview.length > 0);
  console.log("ok delivery col info copy");
}

testDraftRoundTrip();
testGrabRollup();
testLinemanMonthly();
testShopeeHelper();
testApplyAll();
testColInfoForHumansAndAi();
console.log("all vat-month-sources tests passed");
