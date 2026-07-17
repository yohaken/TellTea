/**
 * Pure resolve helpers for rate schedule — past stamped rates must never change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveRateForDate(entries, kind, dateMs) {
  const day = Number(dateMs) || 0;
  let best = null;
  for (const row of entries) {
    if (row.kind !== kind) continue;
    if (row.effectiveFrom > day) continue;
    if (
      !best ||
      row.effectiveFrom > best.effectiveFrom ||
      (row.effectiveFrom === best.effectiveFrom && row.createdAt > best.createdAt)
    ) {
      best = row;
    }
  }
  return best;
}

function resolveOtBonusRateForNewEntry(dateMs, schedule, settingsFallback) {
  const hit = resolveRateForDate(schedule, "ot", dateMs);
  if (hit) return hit.rate;
  const fb = Number(settingsFallback);
  return Number.isFinite(fb) && fb >= 0 ? fb : 0.6;
}

function resolveBakerySalesRateForNewEntry(dateMs, schedule, productSalesRate) {
  const hit = resolveRateForDate(schedule, "bakerySales", dateMs);
  if (hit) return hit.rate;
  return Number(productSalesRate) || 0;
}

function resolveProdEntryRates(entry, productId, product, opts = {}) {
  const catalogSales = Number(product?.salesRate) || 0;
  const catalogProd = Number(product?.prodRate) || 0;
  const schedule = opts.bakerySalesSchedule || [];
  const dateMs = opts.dateMs ?? (entry?.date || Date.now());

  if (!entry) {
    return {
      salesRate: resolveBakerySalesRateForNewEntry(dateMs, schedule, catalogSales),
      prodRate: catalogProd,
    };
  }
  if (productId !== entry.productId) {
    return {
      salesRate: resolveBakerySalesRateForNewEntry(dateMs, schedule, catalogSales),
      prodRate: catalogProd,
    };
  }
  return {
    salesRate: Number.isFinite(Number(entry.salesRate)) ? Number(entry.salesRate) : catalogSales,
    prodRate: Number.isFinite(Number(entry.prodRate)) ? Number(entry.prodRate) : catalogProd,
  };
}

const day = (y, m, d) => new Date(y, m - 1, d).getTime();

const schedule = [
  { id: "1", kind: "ot", effectiveFrom: day(2026, 1, 1), rate: 0.5, createdAt: 1 },
  { id: "2", kind: "ot", effectiveFrom: day(2026, 6, 1), rate: 0.7, createdAt: 2 },
  { id: "3", kind: "bakerySales", effectiveFrom: day(2026, 3, 1), rate: 1.2, createdAt: 3 },
];

assert.equal(resolveOtBonusRateForNewEntry(day(2025, 12, 1), schedule, 0.6), 0.6);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 2, 15), schedule, 0.6), 0.5);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 6, 1), schedule, 0.6), 0.7);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 7, 1), schedule, 0.6), 0.7);

assert.equal(resolveBakerySalesRateForNewEntry(day(2026, 2, 1), schedule, 0.9), 0.9);
assert.equal(resolveBakerySalesRateForNewEntry(day(2026, 3, 1), schedule, 0.9), 1.2);

// Existing row keeps stamped rate even if schedule would differ
const existing = {
  productId: "p1",
  date: day(2026, 2, 1),
  salesRate: 0.55,
  prodRate: 2,
};
const afterScheduleChange = resolveProdEntryRates(existing, "p1", { salesRate: 9, prodRate: 9 }, {
  bakerySalesSchedule: schedule,
  dateMs: day(2026, 7, 1),
});
assert.equal(afterScheduleChange.salesRate, 0.55);
assert.equal(afterScheduleChange.prodRate, 2);

// New row uses schedule
const fresh = resolveProdEntryRates(null, "p1", { salesRate: 0.9, prodRate: 2 }, {
  bakerySalesSchedule: schedule,
  dateMs: day(2026, 4, 1),
});
assert.equal(fresh.salesRate, 1.2);
assert.equal(fresh.prodRate, 2);

// Source guards — OT form must not re-resolve for existing entries
const otPage = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
assert.match(otPage, /entry != null/);
assert.match(otPage, /resolveOtBonusRateForNewEntry/);
assert.match(otPage, /แถวเดิมใช้ bonusRate/);

const rateLib = readFileSync(join(root, "src/lib/rate-schedule.ts"), "utf8");
assert.match(rateLib, /รายการเก่าต้องใช้ entry\.bonusRate/);
assert.match(rateLib, /"rateSchedule"/);

const prodLib = readFileSync(join(root, "src/lib/production.ts"), "utf8");
assert.match(prodLib, /ห้ามเปลี่ยนจากตารางเรท/);

const bonusPage = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
assert.match(bonusPage, /RateSchedulePanel/);

const panel = readFileSync(join(root, "src/components/RateSchedulePanel.tsx"), "utf8");
assert.match(panel, /isOwner \?/);
assert.match(panel, /bonus-rate-current-table/);
assert.match(panel, /ดูประวัติเรท/);
assert.match(panel, /RateScheduleEditModal/);
assert.doesNotMatch(panel, /bonus-rate-add-form/);

console.log("OK test-rate-schedule");
