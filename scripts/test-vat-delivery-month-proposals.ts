import assert from "node:assert/strict";
import {
  buildMonthProposalFromReports,
  dayKeyFromReport,
  fillProposalAmountsFromReports,
  monthKeyFromReport,
  proposalSummaryLine,
} from "../src/lib/vat-delivery-month-proposals";
import type { PlatformEmailReport } from "../src/lib/vat-sales-mail";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function stub(partial: Partial<PlatformEmailReport>): PlatformEmailReport {
  return {
    id: "x",
    channel: "grab",
    provider: "gmail",
    messageId: "",
    threadId: "",
    receivedAt: Date.parse("2026-07-15T12:00:00+07:00"),
    subject: "",
    from: "",
    snippet: "",
    rawText: "",
    rawHtml: "",
    reportDateGuess: "",
    reportKind: "daily",
    parseStatus: "pending",
    parseError: "",
    pdfFilenames: [],
    pdfStoragePaths: [],
    pdfError: "",
    syncedAt: 0,
    parserVersion: "",
    studyTags: [],
    parsed: null,
    ...partial,
  };
}

assert.equal(
  monthKeyFromReport(stub({ reportDateGuess: "2026-07-30" })),
  "2026-07",
);
assert.equal(
  dayKeyFromReport(stub({ reportDateGuess: "2026-07-30" })),
  "2026-07-30",
);

const reports = [
  stub({
    id: "g1",
    channel: "grab",
    reportDateGuess: "2026-07-01",
    studyTags: ["grab-รายวัน", "pdf"],
  }),
  stub({
    id: "g2",
    channel: "grab",
    reportDateGuess: "2026-07-02",
    studyTags: ["grab-รายวัน"],
  }),
  stub({
    id: "g-skip",
    channel: "grab",
    reportDateGuess: "2026-07-03",
    studyTags: ["ข้าม"],
  }),
  stub({
    id: "lm1",
    channel: "lineman",
    reportDateGuess: "2026-07-01",
    studyTags: ["lm-รายวัน-ขาย"],
  }),
  stub({
    id: "lm2",
    channel: "lineman",
    reportDateGuess: "2026-07-01",
    studyTags: ["lm-รายวัน-โอน"],
  }),
  stub({
    id: "sf1",
    channel: "shopee",
    reportDateGuess: "2026-08-01",
    studyTags: ["sf-โอนรายวัน"],
  }),
];

const july = buildMonthProposalFromReports("2026-07", reports, "test");
assert.equal(july.phase, "D3");
assert.equal(july.channels.grab.reportIds.length, 2);
assert.equal(july.channels.grab.skipIds.length, 1);
assert.equal(july.channels.grab.strategy, "daily-rollup");
assert.equal(july.channels.grab.dayCount, 2);
assert.equal(july.channels.grab.amounts.appSales, null);
assert.equal(july.channels.grab.amountsSource, "none");
assert.equal(july.channels.lineman.reportIds.length, 2);
assert.equal(july.channels.shopee.reportIds.length, 0);

const aug = buildMonthProposalFromReports("2026-08", reports, "test");
assert.equal(aug.channels.shopee.reportIds.length, 1);
assert.equal(aug.channels.shopee.strategy, "daily-rollup");

assert.match(proposalSummaryLine(july), /ยอดว่าง/);
assert.match(proposalSummaryLine(july), /grab:2ใช้/);

{
  const pdfBody = readFileSync(
    join("testdata/vat-mail/grab-daily-from-pdf.txt"),
    "utf8",
  );
  const filledReports = [
    stub({
      id: "g1",
      channel: "grab",
      reportDateGuess: "2026-07-01",
      subject: "สรุปยอดขายสำหรับคำสั่งซื้อ 01 กรกฎาคม 2026 GrabFood",
      studyTags: ["grab-รายวัน", "pdf"],
      rawText: pdfBody,
    }),
    stub({
      id: "g2",
      channel: "grab",
      reportDateGuess: "2026-07-02",
      subject: "สรุปยอดขายสำหรับคำสั่งซื้อ 02 กรกฎาคม 2026 GrabFood",
      studyTags: ["grab-รายวัน", "pdf"],
      rawText: pdfBody.replace(/26\/07\/2024/g, "02/07/2026").replace(
        /12840\.00/,
        "1000.00",
      ).replace(/2568\.00/, "200.00").replace(/10272\.00/, "800.00"),
    }),
  ];
  const base = buildMonthProposalFromReports("2026-07", filledReports, "test");
  const filled = fillProposalAmountsFromReports(base, filledReports, "test");
  assert.equal(filled.phase, "D4");
  assert.equal(filled.channels.grab.amountsSource, "adapter");
  assert.ok((filled.channels.grab.amounts.appSales || 0) > 0);
  assert.ok((filled.channels.grab.amounts.transfer || 0) > 0);
  assert.ok((filled.channels.grab.amounts.gpExVat || 0) > 0);
}

console.log("ok vat-delivery-month-proposals");
