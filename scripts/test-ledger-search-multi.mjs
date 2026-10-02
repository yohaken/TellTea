/**
 * Ledger search: every column (date /10/, amounts in/out/VAT, type, status) + multi box AND.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
const { filterLedgerRowsMulti } = await jiti.import(join(root, "src/lib/smart-search.ts"));

const day = (iso) => Date.parse(`${iso}T00:00:00+07:00`);
const rows = [
  { id: "a", date: day("2026-10-05"), description: "ค่าไฟ", amountIn: 0, amountOut: 1250, type: "sga", typeSource: "ai" },
  { id: "b", date: day("2026-09-10"), description: "นมสด", amountIn: 0, amountOut: 480.5, type: "cogs", typeSource: "heuristic", hasVat: true, vatInput: 31.43 },
  { id: "c", date: day("2026-10-15"), description: "โอนเข้า", amountIn: 5000, amountOut: 0, type: "โอนเข้า" },
  { id: "d", date: day("2026-03-01"), description: "แก้ว 1/2 ลัง", amountIn: 0, amountOut: 900, type: "cogs", typeSource: "owner" },
];
const status = (r) => ({ ai: "AI", owner: "จัดเอง", heuristic: "เดา" })[r.typeSource] || "ว่าง";
const ids = (queries) =>
  filterLedgerRowsMulti(rows, queries, (r) => (r.amountOut > 0 ? status(r) : ""))
    .map((r) => r.id)
    .join(",");

// Date: month / day / day+month / year (BE + CE)
assert.equal(ids(["/10/"]), "a,c", "/10/ = เดือน ต.ค.");
assert.equal(ids(["/9/"]), "b");
assert.equal(ids(["/09/"]), "b", "padded month");
assert.equal(ids(["5/"]), "a", "5/ = วันที่ 5 ไม่ใช่ 15");
assert.equal(ids(["15/10"]), "c");
assert.equal(ids(["/69"]), "a,b,c,d", "ปี พ.ศ. 2 หลัก");
assert.equal(ids(["/2569"]), "a,b,c,d");
assert.equal(ids(["/10/2026"]), "a,c", "เดือน+ปี ค.ศ.");
assert.equal(ids(["1/2"]), "d", "1/2 ในชื่อรายการ ยังค้นได้");

// Amounts: with/without comma, decimals, VAT, in vs out
assert.equal(ids(["1,250"]), "a");
assert.equal(ids(["1250"]), "a");
assert.equal(ids(["480.5"]), "b");
assert.equal(ids(["31.43"]), "b", "VAT");
assert.equal(ids(["5000"]), "c");
assert.equal(ids(["เข้า"]), "c");
assert.equal(ids(["ออก"]), "a,b,d");

// Type + status labels
assert.equal(ids(["ต้นทุน"]), "b,d");
assert.equal(ids(["เดา"]), "b");
assert.equal(ids(["จัดเอง"]), "d");

// Multi box = AND
assert.equal(ids(["/10/", "ออก"]), "a");
assert.equal(ids(["/10/", "ค่าไฟ"]), "a");
assert.equal(ids(["/10/", "นม"]), "");
assert.equal(ids(["", "  "]), "a,b,c,d", "ช่องว่าง = ไม่กรอง");

// Page wiring
const page = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
assert.match(page, /filterLedgerRowsMulti\(/);
assert.match(page, /table-search-add/);
assert.match(page, /setQueries\(\(prev\) => \[\.\.\.prev, ""\]\)/);
assert.doesNotMatch(page, /AI ไม่ตอบเลย|AI จัดเสร็จ/);

console.log("OK test-ledger-search-multi");
