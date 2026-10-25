/**
 * VAT เดือน — popup ที่มาของตัวเลข: ทุกแถวต้องมีคำอธิบาย และตัวเลขประกอบรวมแล้วเท่ายอดในตาราง
 * npx tsx scripts/test-vat-month-explain.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveMonthBooksView,
  emptyMonthBooksDraft,
  MONTH_CHANNELS,
} from "../src/lib/vat-month-books";
import { emptyMonthCategoryRow } from "../src/lib/pnl";
import { buildMonthPnlStatement } from "../src/lib/vat-storefront-send";
import {
  explainVatMonthRow,
  subtotalsConsistent,
  termsSum,
  type ExplainCtx,
  type ExplainId,
} from "../src/lib/vat-month-explain";

const draft = emptyMonthBooksDraft("2026-10");
draft.sales = { ...draft.sales, shopee: 30000, grab: 20000, lineman: 10000, storefrontTransfer: 8000, storefrontCash: 12000 };
draft.transfer = { shopee: 22000, grab: 14500, lineman: 7600, storefront: 20000 };
draft.gpFee = { shopee: 7000, grab: 5000, lineman: 2200 };
draft.gpVatOverride = { shopee: 490, grab: 0, lineman: 0 };
draft.ingredientVat = 350;

const staff = { ...emptyMonthCategoryRow("2026-10"), cogs: 12000.5, sga: 3000, other: 250, asset: 1500, vatCogs: 200 };
const owner = { ...emptyMonthCategoryRow("2026-10"), cogs: 8000, sga: 4500.25, other: 0, asset: 0, vatCogs: 150 };
const booksCombo = {
  cogs: staff.cogs + owner.cogs,
  sga: staff.sga + owner.sga,
  other: staff.other + owner.other,
  asset: staff.asset + owner.asset,
};
const view = deriveMonthBooksView(draft, booksCombo);
const pnl = buildMonthPnlStatement({
  incomeTotal: view.incomeTotal,
  cogs: booksCombo.cogs,
  booksOpex: view.booksOpex,
  monthProfit: view.monthProfit,
  netVat: view.netVat,
  profitAfterVat: view.profitAfterVat,
});

const ctx: ExplainCtx = {
  monthLabel: "ตุลาคม 2569",
  view,
  draft,
  staff,
  owner,
  periodLabel: "1 ต.ค. – 31 ต.ค. 2569",
  periodStartDay: 1,
  sf: { posConnected: true, pct: 100, posCash: 12000, posTransfer: 8000 },
  claimedBooksCount: 3,
  claimedBooksVat: 350,
  booksLineCount: 5,
};

const ids: ExplainId[] = [
  "col.appSales",
  "col.transfer",
  "col.gpFee",
  "col.otherFee",
  "col.purchaseVat",
  "a.delivery",
  ...MONTH_CHANNELS.map((k) => `a.ch.${k}` as ExplainId),
  "a.storefront",
  "a.income",
  "b.gp",
  ...MONTH_CHANNELS.map((k) => `b.gp.${k}` as ExplainId),
  "b.books",
  "b.books.staff",
  "b.books.owner",
  "b.asset",
  "b.layer.claimed",
  "b.layer.vat",
  "b.layer.unclaimed",
  "b.costTotal",
  "c.income",
  "c.cogs",
  "c.grossProfit",
  "c.otherOpex",
  "c.operatingProfit",
  "c.netVat",
  "c.netProfit",
  "d.salesDelivery",
  "d.salesStorefront",
  "d.salesTotal",
  "d.gpVat",
  ...MONTH_CHANNELS.map((k) => `d.gpVat.${k}` as ExplainId),
  "d.booksVat",
  "d.booksVatApplied",
  "d.inputTotal",
];

for (const id of ids) {
  const e = explainVatMonthRow(id, ctx);
  assert.ok(e, `missing explain ${id}`);
  assert.ok(e.title && e.formula, `${id} needs title + formula`);
  assert.ok(e.sources.length > 0, `${id} needs a source`);
  const sum = termsSum(e.terms);
  if (sum != null && e.result != null && e.terms.length > 0) {
    assert.equal(sum, Math.round(e.result * 100) / 100, `${id} terms ${sum} ≠ result ${e.result}`);
  }
  assert.ok(subtotalsConsistent(e.terms), `${id} subtotal ≠ lines above`);
  for (const t of e.terms) {
    if (t.op === "×") assert.ok(!t.label.trim().startsWith("×"), `${id} duplicates × in "${t.label}"`);
  }
  const blob = JSON.stringify(e);
  assert.doesNotMatch(blob, /NaN|undefined|Infinity/, `${id} has bad text`);
}

// ยังโหลดสองบช.ไม่เสร็จ → ไม่โชว์ 0.00 หลอก
const loadingCtx = { ...ctx, staff: null, owner: null, view: deriveMonthBooksView(draft, null) };
for (const id of ["c.cogs", "c.otherOpex", "b.books", "b.books.staff", "b.asset", "b.layer.claimed"] as ExplainId[]) {
  const e = explainVatMonthRow(id, loadingCtx)!;
  assert.equal(e.result, null, `${id} loading result should be null`);
  assert.ok(e.terms.every((t) => t.amount == null), `${id} loading terms should be —`);
}
assert.ok(
  explainVatMonthRow("c.operatingProfit", loadingCtx)!.notes.some((n) => n.includes("ยังโหลดสองบช.")),
);

// ช่องภาษีซื้อสองบช. ถูกแก้มือ ≠ ผลรวมที่ติ๊ก → เตือน
const editedVat = explainVatMonthRow("d.booksVat", { ...ctx, claimedBooksVat: 120 })!;
assert.ok(editedVat.notes.some((n) => n.startsWith("⚠")));
assert.ok(!explainVatMonthRow("d.booksVat", ctx)!.notes.some((n) => n.startsWith("⚠")));

// ช่อง 8,604.80 → ระบบ VAT ปัดลงเป็น 8,604.79 (float) — popup ต้องตรงกับแต่ละแถวในตาราง
const sepDraft = { ...draft, ingredientVat: 8604.8 };
const sepView = deriveMonthBooksView(sepDraft, booksCombo);
const sepCtx = { ...ctx, draft: sepDraft, view: sepView, claimedBooksVat: 8604.8 };
const box = explainVatMonthRow("d.booksVat", sepCtx)!;
assert.equal(box.result, 8604.8, "row «ภาษีซื้อสองบช.» shows the input box");
const appliedVat = explainVatMonthRow("d.booksVatApplied", sepCtx)!;
assert.equal(appliedVat.result, sepView.inputBooksVat, "row «→ หักจากภาษีขาย» shows deducted amount");
assert.equal(termsSum(appliedVat.terms), sepView.inputBooksVat);
if (sepView.inputBooksVat !== 8604.8) {
  assert.ok(appliedVat.notes.some((n) => n.includes("ปัดลง")), "explain the rounding gap");
}

// มียอดโอนแต่ไม่มียอดขายแอพ → ไม่แตกส่วนหักที่รวมไม่ลง
const noSales = { ...draft, sales: { ...draft.sales, grab: 0 } };
const grabOnly = explainVatMonthRow("a.ch.grab", {
  ...ctx,
  draft: noSales,
  view: deriveMonthBooksView(noSales, booksCombo),
})!;
assert.equal(grabOnly.terms.length, 1);
assert.equal(termsSum(grabOnly.terms), 14500);

// ติ๊ก nPOS แต่ยังไม่มียอด → ไม่อ้างว่ามาจาก nPOS
const sfManual = explainVatMonthRow("a.storefront", { ...ctx, sf: { ...ctx.sf, posCash: 0, posTransfer: 0 } })!;
assert.doesNotMatch(sfManual.formula, /nPOS/);
assert.ok(sfManual.notes.some((n) => n.includes("ยังไม่มียอดจาก nPOS")));

// C) แถวในตาราง = ผลลัพธ์ใน popup (popup ไม่คิดตัวเลขใหม่ต่างจากตาราง)
const cMap: Array<[ExplainId, number | null]> = [
  ["c.income", pnl.income.amount],
  ["c.cogs", pnl.cogs.amount],
  ["c.grossProfit", pnl.grossProfit.amount],
  ["c.otherOpex", pnl.otherOpex.amount],
  ["c.operatingProfit", pnl.operatingProfit.amount],
  ["c.netVat", pnl.netVat.amount],
  ["c.netProfit", pnl.netProfit.amount],
];
for (const [id, amount] of cMap) {
  assert.equal(explainVatMonthRow(id, ctx)!.result, amount, `${id} popup ≠ table`);
}

const cogs = explainVatMonthRow("c.cogs", ctx)!;
assert.equal(cogs.terms[0].amount, 12000.5);
assert.equal(cogs.terms[1].amount, 8000);
assert.ok(cogs.notes.some((n) => n.includes("350.00")), "COGS note shows VAT moved to D");
assert.ok(cogs.links.some((l) => l.href === "/ledger/"));
assert.ok(cogs.links.some((l) => l.href === "/owner-books/"));
assert.ok(!cogs.notes.some((n) => n.includes("เดือนปฏิทิน")), "no period warning when start day = 1");

const shifted = explainVatMonthRow("c.cogs", { ...ctx, periodStartDay: 26, periodLabel: "26 ก.ย. – 25 ต.ค. 2569" })!;
assert.ok(shifted.notes.some((n) => n.includes("เดือนปฏิทิน")), "warn when VAT period ≠ calendar month");

const loading = explainVatMonthRow("c.cogs", { ...ctx, staff: null, owner: null })!;
assert.equal(loading.result, null);

const noInput = deriveMonthBooksView({ ...draft, includeInputVat: false }, booksCombo);
const netOff = explainVatMonthRow("c.netVat", { ...ctx, view: noInput })!;
assert.equal(termsSum(netOff.terms), noInput.netVat);

const ui = readFileSync(join(process.cwd(), "src/components/vat-sales/VatMonthBooks.tsx"), "utf8");
for (const id of ids.filter((x) => !/\.(shopee|grab|lineman)$/.test(x))) {
  assert.ok(ui.includes(`"${id}"`), `UI does not wire ${id}`);
}
assert.match(ui, /a\.ch\.\$\{k\}/);
assert.match(ui, /b\.gp\.\$\{k\}/);
assert.match(ui, /d\.gpVat\.\$\{k\}/);
assert.match(ui, /VatCalcInfoSheet/);

console.log(`OK test-vat-month-explain · ${ids.length} rows`);
