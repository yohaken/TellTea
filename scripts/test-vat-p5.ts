/**
 * P5 local checks: propose monthly income · confirmed-only totals.
 * Run: npx tsx scripts/test-vat-p5.ts
 */
import {
  emptyDailySales,
  proposeMonthlyIncomeAmount,
  recomputeDailyTotals,
  sumMonthSales,
  type ChannelAmount,
  type DailySalesDoc,
} from "../src/lib/vat-sales";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const amt = (gross: number): ChannelAmount => ({
  grossInclusive: gross,
  fee: 0,
  netTransfer: 0,
});

function day(dateKey: string, gross: number, status: "draft" | "confirmed"): DailySalesDoc {
  const doc = emptyDailySales(dateKey);
  doc.storefront = amt(gross);
  Object.assign(
    doc,
    recomputeDailyTotals({ storefront: doc.storefront, delivery: doc.delivery }),
  );
  doc.status = status;
  return doc;
}

const docs = [
  day("2026-07-01", 1070, "confirmed"), // base 1000
  day("2026-07-02", 214, "draft"), // ignored
  day("2026-07-03", 535, "confirmed"), // base 500
];

const ex = proposeMonthlyIncomeAmount(docs, "exVat");
assert(ex.confirmedDays === 2, `confirmedDays ${ex.confirmedDays}`);
assert(ex.amount === 1500, `exVat amount want 1500 got ${ex.amount}`);
assert(ex.totals.totalGross === 1605, `totalGross ${ex.totals.totalGross}`);

const inc = proposeMonthlyIncomeAmount(docs, "incVat");
assert(inc.amount === 1605, `incVat amount want 1605 got ${inc.amount}`);

const onlyDraft = proposeMonthlyIncomeAmount(
  [day("2026-07-10", 999, "draft")],
  "exVat",
);
assert(onlyDraft.confirmedDays === 0, "no confirmed");
assert(onlyDraft.amount === 0, "propose 0 when none confirmed");

const all = sumMonthSales(docs);
assert(all.confirmedDays === 2, "sum confirmed count");
assert(all.totalGross === 1605 + 214, "sum includes draft when not confirmedOnly");

const confirmedOnly = sumMonthSales(docs, { confirmedOnly: true });
assert(confirmedOnly.totalGross === 1605, "confirmedOnly skips draft");

console.log("OK vat-p5 · propose income · confirmed-only totals");
