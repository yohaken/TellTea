/**
 * Unit: VAT เดือน กล่อง C งบกำไรขาดทุน + % — โชว์อย่างเดียว ไม่เปลี่ยนตัวเลขเดิม
 * Run: npx tsx scripts/test-vat-pnl-statement.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMonthPnlStatement,
  pctOfIncome,
} from "../src/lib/vat-storefront-send";
import {
  deriveMonthBooksView,
  emptyMonthBooksDraft,
} from "../src/lib/vat-month-books";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// pctOfIncome
assert.equal(pctOfIncome(50, 200), 25);
assert.equal(pctOfIncome(-13167, 7321), -179.85);
assert.equal(pctOfIncome(10, 0), null);
assert.equal(pctOfIncome(10, -5), null);
assert.equal(pctOfIncome(null, 100), null);
assert.equal(pctOfIncome(Number.NaN, 100), null);

// ตัวเลขจริง ต.ค. 69 จากหน้าจอ
{
  const s = buildMonthPnlStatement({
    incomeTotal: 7321,
    cogs: 20488,
    booksOpex: 35722,
    monthProfit: -28401,
    netVat: 512.47,
    profitAfterVat: -28913.47,
  });
  assert.deepEqual(s.income, { amount: 7321, pct: 100 });
  assert.deepEqual(s.cogs, { amount: 20488, pct: 279.85 });
  assert.deepEqual(s.grossProfit, { amount: -13167, pct: -179.85 });
  assert.deepEqual(s.otherOpex, { amount: 15234, pct: 208.09 });
  assert.deepEqual(s.operatingProfit, { amount: -28401, pct: -387.94 });
  assert.deepEqual(s.netVat, { amount: 512.47, pct: 7 });
  assert.deepEqual(s.netProfit, { amount: -28913.47, pct: -394.94 });
}

// ยังไม่โหลดบช. → แถวแตก = — · กำไรเดิมโชว์ตามเดิม
{
  const s = buildMonthPnlStatement({
    incomeTotal: 1000,
    cogs: undefined,
    booksOpex: null,
    monthProfit: 1000,
    netVat: 65.42,
    profitAfterVat: 934.58,
  });
  assert.equal(s.cogs.amount, null);
  assert.equal(s.grossProfit.amount, null);
  assert.equal(s.otherOpex.amount, null);
  assert.equal(s.operatingProfit.amount, 1000);
  assert.equal(s.netProfit.amount, 934.58);
}

// รายได้ 0 → % ทั้งหมด = null ไม่หาร 0
{
  const s = buildMonthPnlStatement({
    incomeTotal: 0,
    cogs: 500,
    booksOpex: 800,
    monthProfit: -800,
    netVat: 0,
    profitAfterVat: -800,
  });
  for (const k of Object.keys(s) as (keyof typeof s)[]) {
    assert.equal(s[k].pct, null, `${k} pct`);
  }
  assert.equal(s.grossProfit.amount, -500);
}

// ใช้ deriveMonthBooksView จริง → ขั้นต้น − คชจ.อื่น = กำไรประมาณการเดิม (ไม่คิดใหม่)
{
  const draft = emptyMonthBooksDraft("2026-09");
  draft.transfer.shopee = 12345.67;
  draft.transfer.grab = 2222.22;
  draft.transfer.lineman = 1111.11;
  draft.transfer.storefront = 40000;
  const books = {
    month: "2026-09",
    cogs: 18888.88,
    sga: 7777.77,
    other: 333.33,
    asset: 9999,
    vatCogs: 0,
    vatSga: 0,
    vatOther: 0,
    vatAsset: 0,
  };
  const before = deriveMonthBooksView(draft, books);
  const s = buildMonthPnlStatement({
    incomeTotal: before.incomeTotal,
    cogs: books.cogs,
    booksOpex: before.booksOpex,
    monthProfit: before.monthProfit,
    netVat: before.netVat,
    profitAfterVat: before.profitAfterVat,
  });
  const after = deriveMonthBooksView(draft, books);
  assert.deepEqual(after, before, "view ต้องไม่เปลี่ยน");
  assert.equal(s.operatingProfit.amount, before.monthProfit);
  assert.equal(s.netProfit.amount, before.profitAfterVat);
  assert.equal(
    Math.round(
      ((s.grossProfit.amount ?? 0) - (s.otherOpex.amount ?? 0)) * 100,
    ) / 100,
    before.monthProfit,
  );
  assert.equal(
    Math.round(((s.cogs.amount ?? 0) + (s.otherOpex.amount ?? 0)) * 100) / 100,
    before.booksOpex,
  );
  assert.equal(s.income.pct, 100);
}

// UI: ตาราง + คอลัมน์ % · ไม่มีโน้ตบรรยาย/ภ.ง.ด. เดิม
const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);
assert.match(ui, /buildMonthPnlStatement\(/);
assert.match(ui, /vat-pnl-table/);
assert.match(ui, /= กำไรขั้นต้น/);
assert.match(ui, /col-pct/);
assert.doesNotMatch(ui, /อัตรากำไรขั้นต้น/);
assert.doesNotMatch(ui, /ค่าลดหย่อนผู้มีเงินได้/);
assert.doesNotMatch(ui, /pullYearSummary/);
assert.doesNotMatch(ui, /saveMonthlyIncome\(month, pnl/);

console.log("OK test-vat-pnl-statement");
