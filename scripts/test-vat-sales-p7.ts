/**
 * P7 unit checks: parser health + zero-day ready status.
 * Run: npx tsx scripts/test-vat-sales-p7.ts
 */
import { summarizeParserHealth } from "../src/lib/vat-sales-parser-health";
import { deriveDayOpsStatus } from "../src/lib/vat-sales-status";
import { emptyDailySales, type VatSalesSettings } from "../src/lib/vat-sales";
import type { PlatformEmailReport } from "../src/lib/vat-sales-mail";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const settings: VatSalesSettings = {
  vatRegistered: true,
  vatRate: 0.07,
  pnlIncomeMode: "exVat",
  reportEmails: [],
  channelsEnabled: { shopee: true, grab: true, lineman: true, storefront: false },
  mailRules: {
    shopee: { enabled: true, fromIncludes: [], subjectIncludes: [] },
    grab: { enabled: true, fromIncludes: [], subjectIncludes: [] },
    lineman: { enabled: true, fromIncludes: [], subjectIncludes: [] },
  },
  alertsEnabled: false,
  alertAfterHourBangkok: 10,
  updatedAt: 0,
  updatedBy: "",
};

const baseReport = (over: Partial<PlatformEmailReport>): PlatformEmailReport => ({
  id: "r1",
  channel: "grab",
  provider: "gmail",
  messageId: "m1",
  threadId: "",
  receivedAt: Date.now(),
  subject: "x",
  from: "a@b.c",
  snippet: "",
  rawText: "",
  rawHtml: "",
  reportDateGuess: "2026-07-10",
  reportKind: "daily",
  parseStatus: "ok",
  parseError: "",
  syncedAt: Date.now(),
  parserVersion: "grab-v1",
  parsed: {
    reportDate: "2026-07-10",
    reportKind: "daily",
    periodStart: "2026-07-10",
    periodEnd: "2026-07-10",
    grossInclusive: 100,
    fee: 0,
    netTransfer: 0,
    orderCount: null,
    confidence: "med",
    warnings: [],
  },
  ...over,
});

const health = summarizeParserHealth([
  baseReport({ id: "1", parseStatus: "confirmed", parserVersion: "grab-v1" }),
  baseReport({ id: "2", parseStatus: "fail", parseError: "no labels", parserVersion: "grab-v1" }),
  baseReport({ id: "3", parseStatus: "fail", parseError: "no labels", parserVersion: "grab-v1" }),
  baseReport({ id: "4", parseStatus: "fail", parseError: "no labels", parserVersion: "grab-v1" }),
]);
assert(health.fail === 3, "fail count");
assert(health.driftChannels.includes("grab"), "drift suspected after success then 3 fails");

const zeroDoc = emptyDailySales("2026-07-01");
zeroDoc.emailRefs = { shopee: "a", grab: "b", lineman: "c" };
zeroDoc.delivery = {
  shopee: { grossInclusive: 0, fee: 0, netTransfer: 0 },
  grab: { grossInclusive: 0, fee: 0, netTransfer: 0 },
  lineman: { grossInclusive: 0, fee: 0, netTransfer: 0 },
};
const st = deriveDayOpsStatus("2026-07-01", zeroDoc, [], settings, "2026-07-20");
assert(st === "ready", `zero mail day should be ready, got ${st}`);

const missing = deriveDayOpsStatus(
  "2026-07-02",
  emptyDailySales("2026-07-02"),
  [],
  settings,
  "2026-07-20",
);
assert(missing === "missing_mail", `expected missing_mail got ${missing}`);

const weeklyOnly = deriveDayOpsStatus(
  "2026-07-03",
  emptyDailySales("2026-07-03"),
  [
    baseReport({
      id: "w",
      reportKind: "weekly",
      parseStatus: "ok",
      parsed: {
        reportDate: "2026-07-03",
        reportKind: "weekly",
        periodStart: "2026-06-27",
        periodEnd: "2026-07-03",
        grossInclusive: 999,
        fee: 0,
        netTransfer: 0,
        orderCount: null,
        confidence: "low",
        warnings: [],
      },
    }),
  ],
  settings,
  "2026-07-20",
);
assert(weeklyOnly === "missing_mail", `weekly should not count as day mail, got ${weeklyOnly}`);

console.log("vat-sales P7 checks ok");
