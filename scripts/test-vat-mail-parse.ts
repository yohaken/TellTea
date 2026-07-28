/**
 * Local fixture test for VAT mail parsers.
 * Run: npx tsx scripts/test-vat-mail-parse.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  extractReportDate,
  isTaxInvoiceMail,
  parsePlatformEmail,
} from "../src/lib/vat-sales-parse";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const root = process.cwd();
const grabA = readFileSync(join(root, "testdata/vat-mail/grab-daily-a.txt"), "utf8");
const grabB = readFileSync(join(root, "testdata/vat-mail/grab-daily-b.txt"), "utf8");
const lm = readFileSync(join(root, "testdata/vat-mail/lineman-daily-a.txt"), "utf8");
const lmWn = readFileSync(join(root, "testdata/vat-mail/lineman-daily-wongnai.txt"), "utf8");
const grabPdf = readFileSync(join(root, "testdata/vat-mail/grab-daily-pdf-notice.txt"), "utf8");
const grabFromPdf = readFileSync(join(root, "testdata/vat-mail/grab-daily-from-pdf.txt"), "utf8");
const grabTax = readFileSync(join(root, "testdata/vat-mail/grab-tax-invoice.txt"), "utf8");
const sh = readFileSync(join(root, "testdata/vat-mail/shopee-daily-a.html"), "utf8");

const a = parsePlatformEmail({
  channel: "grab",
  subject: "รายงานยอดขาย GrabFood ประจำวันที่ 2026-07-20",
  rawText: grabA,
});
assert(a.ok, (a as { error?: string }).error || "grabA");
if (a.ok) {
  assert(a.parsed.reportDate === "2026-07-20", "grabA date");
  assert(a.parsed.grossInclusive === 12840, `grabA gross ${a.parsed.grossInclusive}`);
  assert(a.parsed.fee === 2568, "grabA fee");
  assert(a.parsed.reportKind === "daily", "grabA kind");
}

const b = parsePlatformEmail({
  channel: "grab",
  subject: "GrabFood Daily Sales 2026/07/21",
  rawText: grabB,
});
assert(b.ok, "grabB");
if (b.ok) {
  assert(b.parsed.grossInclusive === 5350.5, `grabB gross ${b.parsed.grossInclusive}`);
  assert(b.parsed.reportDate === "2026-07-21", "grabB date");
}

const c = parsePlatformEmail({
  channel: "lineman",
  subject: "สรุปยอดขาย LINE MAN วันที่ 15/07/2026",
  rawText: lm,
});
assert(c.ok, "lineman");
if (c.ok) {
  assert(c.parsed.reportDate === "2026-07-15", `lineman date ${c.parsed.reportDate}`);
  assert(c.parsed.grossInclusive === 8909, "lineman gross");
}

const d = parsePlatformEmail({
  channel: "shopee",
  subject: "ShopeeFood",
  rawHtml: sh,
});
assert(d.ok, "shopee");
if (d.ok) {
  assert(d.parsed.grossInclusive === 3210, "shopee gross");
  assert(d.parsed.reportDate === "2026-07-22", "shopee date");
  assert(d.parsed.fee === 642, "shopee fee");
}

const weekly = parsePlatformEmail({
  channel: "grab",
  subject: "รายงานยอดขาย GrabFood ประจำสัปดาห์ 14–20 ก.ค. 2026",
  rawText: grabA,
  reportDateGuess: "2026-07-20",
});
assert(weekly.ok, "weekly");
if (weekly.ok) {
  assert(weekly.parsed.reportKind === "weekly", `weekly kind ${weekly.parsed.reportKind}`);
}

const monthly = parsePlatformEmail({
  channel: "grab",
  subject: "สรุปยอดขายรายเดือน กรกฎาคม 2026",
  rawText: grabA,
  reportDateGuess: "2026-07-31",
});
assert(monthly.ok, "monthly");
if (monthly.ok) {
  assert(monthly.parsed.reportKind === "monthly", `monthly kind ${monthly.parsed.reportKind}`);
}

const fail = parsePlatformEmail({
  channel: "grab",
  subject: "hello",
  rawText: "no amounts here",
});
assert(!fail.ok, "should fail without labels");

const lmReal = parsePlatformEmail({
  channel: "lineman",
  subject: "รายงานยอดขายรายวัน - LINE MAN Wongnai 27/07/67",
  rawText: lmWn,
});
assert(lmReal.ok, (lmReal as { error?: string }).error || "lineman wongnai");
if (lmReal.ok) {
  assert(lmReal.parsed.reportDate === "2024-07-27", `lmWn date ${lmReal.parsed.reportDate}`);
  assert(lmReal.parsed.grossInclusive === 956, `lmWn gross ${lmReal.parsed.grossInclusive}`);
}

const grabPdfRes = parsePlatformEmail({
  channel: "grab",
  subject: "สรุปยอดขายสำหรับคำสั่งซื้อ 26 กรกฎาคม 2024 ออนไลน์ประจำวันที่ GrabFood",
  rawText: grabPdf,
});
assert(!grabPdfRes.ok, "grab body-only (no PDF text) should fail");
assert(
  String((grabPdfRes as { error?: string }).error || "").includes("PDF"),
  "grab pdf error mentions PDF",
);

const grabFromPdfRes = parsePlatformEmail({
  channel: "grab",
  subject: "สรุปยอดขายสำหรับคำสั่งซื้อ 26 กรกฎาคม 2024 ออนไลน์ประจำวันที่ GrabFood",
  rawText: grabFromPdf,
});
assert(grabFromPdfRes.ok, (grabFromPdfRes as { error?: string }).error || "grab from pdf");
if (grabFromPdfRes.ok) {
  assert(
    grabFromPdfRes.parsed.reportDate === "2024-07-26",
    `grabFromPdf date ${grabFromPdfRes.parsed.reportDate}`,
  );
  assert(
    grabFromPdfRes.parsed.grossInclusive === 12840,
    `grabFromPdf gross ${grabFromPdfRes.parsed.grossInclusive}`,
  );
}
const grabPdfDate = extractReportDate(
  "สรุปยอดขายสำหรับคำสั่งซื้อ 26 กรกฎาคม 2024 ออนไลน์ประจำวันที่ GrabFood",
  grabPdf,
);
assert(grabPdfDate?.date === "2024-07-26", `grab thai date ${grabPdfDate?.date}`);

assert(
  isTaxInvoiceMail("Grab: Receipt/Tax Invoice No. IM20260726044071 Date 26/07/2026"),
  "tax invoice detect",
);
const taxRes = parsePlatformEmail({
  channel: "grab",
  subject: "Grab: Receipt/Tax Invoice No. IM20260726044071 Date 26/07/2026",
  rawText: grabTax,
});
assert(!taxRes.ok, "tax invoice must not parse as daily");
assert(
  String((taxRes as { error?: string }).error || "").includes("ใบกำกับ"),
  "tax invoice error",
);

console.log("all vat-mail parse fixtures ok");
