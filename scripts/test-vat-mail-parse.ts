/**
 * Local fixture test for VAT mail parsers.
 * Run: npx tsx scripts/test-vat-mail-parse.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parsePlatformEmail } from "../src/lib/vat-sales-parse";

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
  assert(a.parsed.netTransfer === 10272, "grabA net");
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

const fail = parsePlatformEmail({
  channel: "grab",
  subject: "hello",
  rawText: "no amounts here",
});
assert(!fail.ok, "should fail without labels");

console.log("all vat-mail parse fixtures ok");
