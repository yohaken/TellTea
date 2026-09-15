/**
 * OT work-day counts: distinct brew days / full calendar month.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function calendarDaysInMonth(ym) {
  const m = String(ym || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return 0;
  const [ys, ms] = m.split("-").map(Number);
  if (!ys || !ms || ms < 1 || ms > 12) return 0;
  return new Date(ys, ms, 0).getDate();
}

function bangkokDateKey(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function buildOtWorkDayRows(entries, ym, roster = []) {
  const daysInMonth = calendarDaysInMonth(ym);
  if (!daysInMonth) return [];
  const daysById = new Map();
  const nameById = new Map();
  for (const emp of roster) {
    const id = String(emp.id || "").trim();
    if (!id) continue;
    daysById.set(id, new Set());
    nameById.set(id, String(emp.name || "").trim() || id);
  }
  for (const row of entries) {
    const key = bangkokDateKey(row.date);
    if (!key || !key.startsWith(`${ym}-`)) continue;
    const ids = row.workerIds || [];
    const names = row.workerNames || [];
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || "").trim();
      if (!id) continue;
      let set = daysById.get(id);
      if (!set) {
        set = new Set();
        daysById.set(id, set);
      }
      set.add(key);
      const nm = String(names[i] || "").trim();
      if (nm) nameById.set(id, nameById.get(id) || nm);
    }
  }
  const rows = [];
  for (const [workerId, days] of daysById) {
    rows.push({
      workerId,
      workerName: nameById.get(workerId) || workerId,
      daysWorked: days.size,
      daysInMonth,
    });
  }
  rows.sort((a, b) => {
    if (a.daysWorked !== b.daysWorked) return a.daysWorked - b.daysWorked;
    return a.workerName.localeCompare(b.workerName, "th");
  });
  return rows;
}

assert.equal(calendarDaysInMonth("2026-09"), 30);
assert.equal(calendarDaysInMonth("2026-02"), 28);
assert.equal(calendarDaysInMonth("2024-02"), 29);
assert.equal(calendarDaysInMonth("bad"), 0);

// 2026-09-01 12:00 Bangkok ≈ use noon UTC+7
const d1 = Date.parse("2026-09-01T05:00:00.000Z"); // 12:00 Bangkok
const d1b = Date.parse("2026-09-01T15:00:00.000Z"); // same day evening
const d2 = Date.parse("2026-09-02T05:00:00.000Z");
const dOther = Date.parse("2026-08-31T05:00:00.000Z");

const rows = buildOtWorkDayRows(
  [
    { date: d1, workerIds: ["a", "b"], workerNames: ["Alice", "Bob"] },
    { date: d1b, workerIds: ["a"], workerNames: ["Alice"] }, // same day — still 1
    { date: d2, workerIds: ["a", "c"], workerNames: ["Alice", "Cara"] },
    { date: dOther, workerIds: ["a"], workerNames: ["Alice"] }, // other month
  ],
  "2026-09",
  [
    { id: "a", name: "Alice" },
    { id: "b", name: "Bob" },
    { id: "c", name: "Cara" },
    { id: "d", name: "Dana" }, // 0 days
  ],
);

assert.equal(rows.length, 4);
const byId = Object.fromEntries(rows.map((r) => [r.workerId, r]));
assert.equal(byId.a.daysWorked, 2);
assert.equal(byId.b.daysWorked, 1);
assert.equal(byId.c.daysWorked, 1);
assert.equal(byId.d.daysWorked, 0);
assert.equal(byId.a.daysInMonth, 30);
// fewest first
assert.equal(rows[0].workerId, "d");

const src = readFileSync(join(root, "src/lib/ot-work-days.ts"), "utf8");
assert.match(src, /buildOtWorkDayRows/);
assert.match(src, /calendarDaysInMonth/);
assert.match(src, /bangkokDateKey/);

const otPage = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
assert.match(otPage, /OtWorkDaysStrip/);
assert.match(otPage, /buildOtWorkDayRows/);

const bonusPage = readFileSync(join(root, "src/app/bonus/page.tsx"), "utf8");
assert.match(bonusPage, /OtWorkDaysStrip/);
assert.match(bonusPage, /OtWorkDaysPersonalLine/);

const strip = readFileSync(join(root, "src/components/OtWorkDaysStrip.tsx"), "utf8");
assert.match(strip, /ยังไม่หักหยุด/);

const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 952);

console.log("OK test-ot-work-days", {
  alice: byId.a.daysWorked,
  dana: byId.d.daysWorked,
  daysInMonth: byId.a.daysInMonth,
});
