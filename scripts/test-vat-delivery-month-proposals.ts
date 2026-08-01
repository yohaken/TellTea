import assert from "node:assert/strict";
import {
  buildMonthProposalFromReports,
  dayKeyFromReport,
  monthKeyFromReport,
  proposalSummaryLine,
} from "../src/lib/vat-delivery-month-proposals";
import type { PlatformEmailReport } from "../src/lib/vat-sales-mail";

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

assert.match(proposalSummaryLine(july), /ยอด=ยังว่าง/);
assert.match(proposalSummaryLine(july), /grab:2ใช้/);

console.log("ok vat-delivery-month-proposals");
