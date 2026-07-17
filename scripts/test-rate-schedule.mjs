/**
 * Pure resolve helpers for rate schedule — past stamped rates must never change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveRateForDate(entries, kind, dateMs, opts = {}) {
  const day = Number(dateMs) || 0;
  const productId = (opts.productId || "").trim();
  let best = null;
  for (const row of entries) {
    if (row.kind !== kind) continue;
    if (kind === "bakeryProd") {
      if (!productId || row.productId !== productId) continue;
    }
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

function resolveBakeryProdRateForNewEntry(dateMs, schedule, productId, catalogProdRate) {
  const hit = resolveRateForDate(schedule, "bakeryProd", dateMs, { productId });
  if (hit) return hit.rate;
  return Number(catalogProdRate) || 0;
}

function resolveProdEntryRates(entry, productId, product, opts = {}) {
  const catalogSales = Number(product?.salesRate) || 0;
  const catalogProd = Number(product?.prodRate) || 0;
  const schedule = opts.bakerySalesSchedule || [];
  const dateMs = opts.dateMs ?? (entry?.date || Date.now());

  if (!entry || productId !== entry.productId) {
    return {
      salesRate: resolveBakerySalesRateForNewEntry(dateMs, schedule, catalogSales),
      prodRate: resolveBakeryProdRateForNewEntry(dateMs, schedule, productId, catalogProd),
    };
  }
  return {
    salesRate: Number.isFinite(Number(entry.salesRate)) ? Number(entry.salesRate) : catalogSales,
    prodRate: Number.isFinite(Number(entry.prodRate)) ? Number(entry.prodRate) : catalogProd,
  };
}

const day = (y, m, d) => new Date(y, m - 1, d).getTime();

function dayBeforeLocal(ms) {
  const d = new Date(Number(ms) || 0);
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

assert.equal(dayBeforeLocal(day(2026, 7, 17)), day(2026, 7, 16));
assert.equal(dayBeforeLocal(day(2026, 3, 1)), day(2026, 2, 28));

const schedule = [
  { id: "1", kind: "ot", effectiveFrom: day(2026, 1, 1), rate: 0.5, createdAt: 1 },
  { id: "2", kind: "ot", effectiveFrom: day(2026, 6, 1), rate: 0.7, createdAt: 2 },
  { id: "3", kind: "bakerySales", effectiveFrom: day(2026, 3, 1), rate: 1.2, createdAt: 3 },
  {
    id: "4",
    kind: "bakeryProd",
    productId: "p1",
    productName: "ครัวซองต์",
    effectiveFrom: day(2026, 4, 1),
    rate: 3.5,
    createdAt: 4,
  },
  {
    id: "5",
    kind: "bakeryProd",
    productId: "p2",
    productName: "คุ้กกี้",
    effectiveFrom: day(2026, 4, 1),
    rate: 2.0,
    createdAt: 5,
  },
  {
    id: "6",
    kind: "bakeryProd",
    productId: "p1",
    productName: "ครัวซองต์",
    effectiveFrom: day(2026, 7, 1),
    rate: 4.0,
    createdAt: 6,
  },
];

assert.equal(resolveOtBonusRateForNewEntry(day(2025, 12, 1), schedule, 0.6), 0.6);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 2, 15), schedule, 0.6), 0.5);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 6, 1), schedule, 0.6), 0.7);
// Backfill after rate change — must use rate for shift date, not "today" settings (0.99)
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 5, 20), schedule, 0.99), 0.5);
assert.equal(resolveOtBonusRateForNewEntry(day(2026, 7, 10), schedule, 0.99), 0.7);

assert.equal(resolveBakerySalesRateForNewEntry(day(2026, 2, 1), schedule, 0.9), 0.9);
assert.equal(resolveBakerySalesRateForNewEntry(day(2026, 3, 1), schedule, 0.9), 1.2);

assert.equal(resolveBakeryProdRateForNewEntry(day(2026, 3, 1), schedule, "p1", 1.25), 1.25);
assert.equal(resolveBakeryProdRateForNewEntry(day(2026, 4, 1), schedule, "p1", 1.25), 3.5);
assert.equal(resolveBakeryProdRateForNewEntry(day(2026, 7, 1), schedule, "p1", 1.25), 4.0);
assert.equal(resolveBakeryProdRateForNewEntry(day(2026, 7, 1), schedule, "p2", 1.0), 2.0);

// Existing row keeps stamped rates even if schedule would differ
const existing = {
  productId: "p1",
  date: day(2026, 2, 1),
  salesRate: 0.55,
  prodRate: 2.25,
};
const afterScheduleChange = resolveProdEntryRates(existing, "p1", { salesRate: 9, prodRate: 9 }, {
  bakerySalesSchedule: schedule,
  dateMs: day(2026, 7, 1),
});
assert.equal(afterScheduleChange.salesRate, 0.55);
assert.equal(afterScheduleChange.prodRate, 2.25);

// New row uses schedule for both sales + per-product prod
const fresh = resolveProdEntryRates(null, "p1", { salesRate: 0.9, prodRate: 1.25 }, {
  bakerySalesSchedule: schedule,
  dateMs: day(2026, 7, 1),
});
assert.equal(fresh.salesRate, 1.2);
assert.equal(fresh.prodRate, 4.0);

// Source guards
const otPage = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
assert.match(otPage, /rateLocked/);
assert.match(otPage, /resolveOtBonusRateForNewEntry\(dateMs/);
assert.match(otPage, /ตามวันในตาราง/);
assert.match(otPage, /isOtEntryClosed\(entry\)/);

const rateLib = readFileSync(join(root, "src/lib/rate-schedule.ts"), "utf8");
assert.match(rateLib, /bakeryProd/);
assert.match(rateLib, /resolveBakeryProdRateForNewEntry/);
assert.match(rateLib, /วันในตาราง/);
assert.match(rateLib, /rateScheduleDocForFirestore/);
assert.match(rateLib, /Firestore rejects/);
assert.match(rateLib, /กันบันทึกย้อนหลัง/);
assert.match(rateLib, /RATE_HISTORY_ANCHOR|2020-01-01/);

// Firestore payload must never include undefined optional keys
function rateScheduleDocForFirestore(doc) {
  return {
    updatedAt: Number(doc.updatedAt) || Date.now(),
    entries: (doc.entries || []).map((row) => {
      const out = {
        id: String(row.id || ""),
        kind: row.kind,
        effectiveFrom: Number(row.effectiveFrom) || 0,
        rate: Number(row.rate) || 0,
        createdAt: Number(row.createdAt) || 0,
        createdBy: String(row.createdBy || ""),
      };
      if (row.productId) out.productId = String(row.productId);
      if (row.productName) out.productName = String(row.productName);
      if (row.note) out.note = String(row.note);
      return out;
    }),
  };
}

const firestorePayload = rateScheduleDocForFirestore({
  updatedAt: 1,
  entries: [
    {
      id: "a",
      kind: "ot",
      effectiveFrom: day(2026, 7, 17),
      rate: 0.7,
      createdAt: 1,
      createdBy: "owner",
      productId: undefined,
      productName: undefined,
      note: undefined,
    },
    {
      id: "b",
      kind: "bakeryProd",
      productId: "p1",
      productName: "ครัวซองต์",
      effectiveFrom: day(2026, 7, 17),
      rate: 4,
      createdAt: 2,
      createdBy: "owner",
      note: "",
    },
  ],
});
assert.equal("productId" in firestorePayload.entries[0], false);
assert.equal("note" in firestorePayload.entries[0], false);
assert.equal(firestorePayload.entries[1].productId, "p1");
assert.equal("note" in firestorePayload.entries[1], false);
for (const row of firestorePayload.entries) {
  for (const [k, v] of Object.entries(row)) {
    assert.notEqual(v, undefined, `field ${k} must not be undefined`);
  }
}

const prodLib = readFileSync(join(root, "src/lib/production.ts"), "utf8");
assert.match(prodLib, /resolveBakeryProdRateForNewEntry/);
assert.match(prodLib, /ห้ามเปลี่ยนจากตารางเรท/);

const bonusPage = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
assert.match(bonusPage, /RateSchedulePanel/);

const panel = readFileSync(join(root, "src/components/RateSchedulePanel.tsx"), "utf8");
assert.match(panel, /isOwner \?/);
assert.match(panel, /bakeryProd/);
assert.match(panel, /เรทผลิต \(แยกสินค้า\)/);
assert.match(panel, /listProdProducts/);

console.log("OK test-rate-schedule");
