import assert from "node:assert/strict";
import {
  buildChannelDeliveryChecks,
  expectedDayKeys,
  summarizeChannelChecks,
} from "../src/lib/vat-delivery-checks";
import type { ChannelMonthProposal } from "../src/lib/vat-delivery-month-proposals";

{
  const days = expectedDayKeys("2026-07");
  assert.equal(days.length, 31);
  assert.equal(days[0], "2026-07-01");
  assert.equal(days[30], "2026-07-31");
}

{
  // กลุ่ม A · สรุปเดือน Shopee
  const prop: ChannelMonthProposal = {
    channel: "shopee",
    status: "ready",
    strategy: "monthly-summary",
    reportIds: ["r1"],
    skipIds: [],
    tagCounts: { "sf-สรุปเดือน": 1 },
    dayCount: 0,
    amounts: {
      appSales: 100000,
      transfer: 96330.59,
      // fee = 3669.41 · VAT 7/107 ≈ 240.05
      gpExVat: 3429.36,
      gpVat: 240.05,
    },
    amountsSource: "drive-ai",
    note: "สรุปเดือน",
    driveFileIds: ["f1"],
    days: {},
  };
  const items = buildChannelDeliveryChecks({
    monthKey: "2026-07",
    channel: "shopee",
    proposal: prop,
    fileCount: 2,
  });
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId["shopee-files"].ok, true);
  assert.equal(byId["shopee-amounts"].ok, true);
  assert.equal(byId["shopee-sales-ge-transfer"].ok, true);
  assert.equal(byId["shopee-spotcheck"].ok, true);
  const sum = summarizeChannelChecks(items);
  assert.ok(sum.ready >= 4);
}

{
  // กลุ่ม B · มี gap
  const prop: ChannelMonthProposal = {
    channel: "grab",
    status: "studying",
    strategy: "daily-rollup",
    reportIds: ["g1"],
    skipIds: [],
    tagCounts: { "grab-รายวัน": 1 },
    dayCount: 1,
    amounts: {
      appSales: 1000,
      transfer: 900,
      gpExVat: 93.46,
      gpVat: 6.54,
    },
    amountsSource: "drive-ai",
    note: "",
    driveFileIds: [],
    days: {
      "2026-07-01": {
        dateKey: "2026-07-01",
        appSales: 1000,
        transfer: 900,
        gpExVat: 93.46,
        gpVat: 6.54,
        reportId: "g1",
        status: "ซุ่มตรวจ",
      },
    },
  };
  const items = buildChannelDeliveryChecks({
    monthKey: "2026-07",
    channel: "grab",
    proposal: prop,
    fileCount: 1,
  });
  const cov = items.find((i) => i.id === "grab-daily-coverage");
  assert.ok(cov?.applicable);
  assert.equal(cov?.ok, false);
  assert.ok(String(cov?.detail || "").includes("หาย"));
}

console.log("ok vat-delivery-checks");
