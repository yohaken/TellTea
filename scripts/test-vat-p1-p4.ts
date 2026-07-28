/**
 * P1–P4 local checks: VAT math · day status · mail parse fixtures.
 * Run: npx tsx scripts/test-vat-p1-p4.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  computeVatFromGross,
  emptyDailySales,
  recomputeDailyTotals,
  DEFAULT_VAT_SALES_SETTINGS,
  mapVatSalesSettings,
  type ChannelAmount,
} from "../src/lib/vat-sales";
import {
  deriveDayOpsStatus,
  countDayStatuses,
  isActionNeeded,
} from "../src/lib/vat-sales-status";
import { parsePlatformEmail } from "../src/lib/vat-sales-parse";
import type { PlatformEmailReport } from "../src/lib/vat-sales-mail";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const amt = (gross: number, fee = 0, net = 0): ChannelAmount => ({
  grossInclusive: gross,
  fee,
  netTransfer: net,
});

// —— P1 VAT math ——
const v107 = computeVatFromGross(107);
assert(v107.vatBase === 100, `107→base want 100 got ${v107.vatBase}`);
assert(v107.vatOutput === 7, `107→vat want 7 got ${v107.vatOutput}`);

const v0 = computeVatFromGross(0);
assert(v0.vatBase === 0 && v0.vatOutput === 0, "0 gross");

const day = recomputeDailyTotals({
  storefront: amt(1070),
  delivery: { shopee: amt(214), grab: amt(321), lineman: amt(107) },
});
assert(day.storefrontGross === 1070, "storefront");
assert(day.deliveryGross === 642, `delivery ${day.deliveryGross}`);
assert(day.totalGross === 1712, `total ${day.totalGross}`);
const expectVat = computeVatFromGross(1712);
assert(day.vatBase === expectVat.vatBase, "vatBase from total");
assert(day.vatOutput === expectVat.vatOutput, "vatOutput from total");

// —— P4 day status ——
const settings = mapVatSalesSettings({
  ...DEFAULT_VAT_SALES_SETTINGS,
  channelsEnabled: {
    shopee: true,
    grab: true,
    lineman: true,
    storefront: true,
  },
});
const today = "2026-07-28";
const past = "2026-07-20";

const empty = emptyDailySales(past);
assert(
  deriveDayOpsStatus(past, empty, [], settings, today) === "missing_mail",
  "past empty → missing_mail",
);

const confirmed = { ...emptyDailySales(past), status: "confirmed" as const, totalGross: 100 };
assert(
  deriveDayOpsStatus(past, confirmed, [], settings, today) === "confirmed",
  "confirmed wins",
);

const pendingMail: PlatformEmailReport = {
  id: "m1",
  channel: "grab",
  provider: "gmail",
  messageId: "x",
  threadId: "t",
  receivedAt: 1,
  subject: "t",
  from: "grab",
  snippet: "",
  rawText: "",
  rawHtml: "",
  reportDateGuess: past,
  reportKind: "daily",
  parseStatus: "ok",
  parseError: "",
  parserVersion: "1",
  parsed: {
    reportDate: past,
    reportKind: "daily",
    periodStart: null,
    periodEnd: null,
    grossInclusive: 100,
    fee: 10,
    netTransfer: 90,
    orderCount: null,
    confidence: "0.8",
    warnings: [],
  },
  syncedAt: 1,
};
assert(
  deriveDayOpsStatus(past, empty, [pendingMail], settings, today) === "pending_review",
  "ok mail → pending_review",
);

const failMail: PlatformEmailReport = {
  ...pendingMail,
  id: "m2",
  parseStatus: "fail",
  parsed: undefined,
};
assert(
  deriveDayOpsStatus(past, empty, [failMail], settings, today) === "parse_error",
  "fail mail → parse_error",
);

const readyDoc = emptyDailySales(past);
readyDoc.delivery.shopee = amt(100);
readyDoc.delivery.grab = amt(100);
readyDoc.delivery.lineman = amt(100);
readyDoc.storefront = amt(100);
Object.assign(
  readyDoc,
  recomputeDailyTotals({
    storefront: readyDoc.storefront,
    delivery: readyDoc.delivery,
  }),
);
assert(
  deriveDayOpsStatus(past, readyDoc, [], settings, today) === "ready",
  "all channels filled → ready",
);

const incomplete = emptyDailySales(past);
incomplete.delivery.grab = amt(50);
Object.assign(
  incomplete,
  recomputeDailyTotals({
    storefront: incomplete.storefront,
    delivery: incomplete.delivery,
  }),
);
assert(
  deriveDayOpsStatus(past, incomplete, [], settings, today) === "incomplete",
  "partial → incomplete",
);

assert(isActionNeeded("missing_mail"), "action missing");
assert(isActionNeeded("pending_review"), "action pending");
assert(!isActionNeeded("ready"), "ready not action");
assert(!isActionNeeded("confirmed"), "confirmed not action");

const counts = countDayStatuses(["ready", "ready", "missing_mail", "confirmed"]);
assert(counts.ready === 2 && counts.missing_mail === 1 && counts.confirmed === 1, "counts");

// —— P3 parse fixtures ——
const root = process.cwd();
const grabA = readFileSync(join(root, "testdata/vat-mail/grab-daily-a.txt"), "utf8");
const a = parsePlatformEmail({
  channel: "grab",
  subject: "รายงานยอดขาย GrabFood ประจำวันที่ 2026-07-20",
  rawText: grabA,
});
assert(a.ok, "parse grabA");
if (a.ok) {
  assert(a.parsed.grossInclusive === 12840, "grab gross");
  assert(a.parsed.reportKind === "daily", "grab daily");
}

const lm = readFileSync(join(root, "testdata/vat-mail/lineman-daily-a.txt"), "utf8");
const lmP = parsePlatformEmail({
  channel: "lineman",
  subject: "สรุปยอดขาย LINE MAN วันที่ 15/07/2026",
  rawText: lm,
});
assert(lmP.ok, "parse lineman");

const sh = readFileSync(join(root, "testdata/vat-mail/shopee-daily-a.html"), "utf8");
const shP = parsePlatformEmail({
  channel: "shopee",
  subject: "ShopeeFood",
  rawHtml: sh,
});
assert(shP.ok, "parse shopee");

console.log("OK vat-p1-p4 · VAT math · day status · parse fixtures");
