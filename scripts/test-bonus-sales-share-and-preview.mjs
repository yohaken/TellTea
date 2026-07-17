/**
 * Sales bakery share: only workers who recorded OT or production this month.
 * Roster-only names (e.g. X1) must not dilute the pool.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Source-level wiring checks (no TS transpile needed)
const bonusSrc = readFileSync(join(root, "src/lib/bonus.ts"), "utf8");
assert.match(bonusSrc, /workedThisMonth/);
assert.match(bonusSrc, /salesSharePeople/);
assert.doesNotMatch(bonusSrc, /Math\.max\(1,\s*active\.length\)/);

// Logic mirror — keep in sync with computeMonthBonus sales eligibility
function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeSalesShares({ activeNames, otWorkers, prodWorkers, totalSalesPool }) {
  const byName = new Map();
  for (const name of activeNames) {
    byName.set(name, { otMain: 0, prodBonus: 0, workedThisMonth: false });
  }
  for (const name of otWorkers) {
    const slot = byName.get(name) || { otMain: 0, prodBonus: 0, workedThisMonth: false };
    slot.otMain += 1;
    slot.workedThisMonth = true;
    byName.set(name, slot);
  }
  for (const name of prodWorkers) {
    const slot = byName.get(name) || { otMain: 0, prodBonus: 0, workedThisMonth: false };
    slot.prodBonus += 1;
    slot.workedThisMonth = true;
    byName.set(name, slot);
  }
  const salesSharePeople = [...byName.values()].filter((s) => s.workedThisMonth).length;
  const salesShareEach =
    salesSharePeople > 0 ? round2(totalSalesPool / salesSharePeople) : 0;
  const rows = [...byName.entries()].map(([workerName, slot]) => ({
    workerName,
    salesShare: slot.workedThisMonth ? salesShareEach : 0,
    workedThisMonth: slot.workedThisMonth,
  }));
  return { salesSharePeople, salesShareEach, rows };
}

const sample = computeSalesShares({
  activeNames: ["เมย์", "บี", "แก้ม", "นัท", "X1"],
  otWorkers: ["เมย์", "บี", "แก้ม", "นัท"],
  prodWorkers: ["เมย์", "บี", "นัท"],
  totalSalesPool: 370,
});

assert.equal(sample.salesSharePeople, 4);
assert.equal(sample.salesShareEach, 92.5);
assert.equal(sample.rows.find((r) => r.workerName === "X1").salesShare, 0);
assert.equal(sample.rows.find((r) => r.workerName === "เมย์").salesShare, 92.5);
assert.equal(sample.rows.find((r) => r.workerName === "แก้ม").workedThisMonth, true);

const preview = readFileSync(join(root, "src/components/EntryPhotoCell.tsx"), "utf8");
assert.match(preview, /photo-preview-spinner|photo-fs-loading/);
assert.match(preview, /onPointerDown|onTouchStart/);
assert.match(preview, /บันทึกลงเครื่อง/);
assert.match(preview, /saveImageToDevice/);
assert.match(preview, /photo-fs-root/);

const multi = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
assert.match(multi, /ImagePreviewModal/);
assert.match(multi, /localPreview/);

console.log("OK test-bonus-sales-share-and-preview", {
  salesShareEach: sample.salesShareEach,
  x1: 0,
  workers: sample.salesSharePeople,
});
