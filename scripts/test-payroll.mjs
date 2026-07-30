/**
 * Pure payroll schedule / amount helpers (mirrors src/lib/payroll.ts).
 */
import assert from "node:assert/strict";

function round2(n) {
  return Math.round(n * 100) / 100;
}

function clampDay(n) {
  const d = Math.round(Number(n) || 1);
  return Math.min(28, Math.max(1, d));
}

function periodMonthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function parsePeriodMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}

function shiftPeriodMonth(key, deltaMonths) {
  const { year, monthIndex } = parsePeriodMonth(key);
  const d = new Date(Date.UTC(year, monthIndex + deltaMonths, 1));
  return periodMonthKey(d.getUTCFullYear(), d.getUTCMonth());
}

function bangkokNoonMs(year, monthIndex, day) {
  const d = clampDay(day);
  return Date.UTC(year, monthIndex, d, 5, 0, 0, 0);
}

function salaryAmountForSplit(monthlySalary, percent) {
  return round2((Math.max(0, monthlySalary) * Math.max(0, percent)) / 100);
}

function payrollItemDocId(employeeId, periodMonth, kind) {
  const safeEmp = employeeId.replace(/[^\w-]/g, "_").slice(0, 80);
  return `${safeEmp}_${periodMonth}_${kind}`;
}

function resolvePeriodAndDue(periodMonth, dayOfMonth, forPreviousMonth) {
  const { year, monthIndex } = parsePeriodMonth(periodMonth);
  if (forPreviousMonth) {
    const next = new Date(Date.UTC(year, monthIndex + 1, 1));
    return {
      periodMonth,
      dueDate: bangkokNoonMs(next.getUTCFullYear(), next.getUTCMonth(), dayOfMonth),
    };
  }
  return {
    periodMonth,
    dueDate: bangkokNoonMs(year, monthIndex, dayOfMonth),
  };
}

// --- tests ---

assert.equal(salaryAmountForSplit(10000, 50), 5000);
assert.equal(salaryAmountForSplit(15000, 50), 7500);
assert.equal(salaryAmountForSplit(10000, 33), 3300);

assert.equal(shiftPeriodMonth("2026-06", 1), "2026-07");
assert.equal(shiftPeriodMonth("2026-01", -1), "2025-12");

const mid = resolvePeriodAndDue("2026-06", 15, false);
assert.equal(mid.dueDate, bangkokNoonMs(2026, 5, 15));

const end = resolvePeriodAndDue("2026-06", 1, true);
assert.equal(end.dueDate, bangkokNoonMs(2026, 6, 1)); // 1 Jul 2026

const bonus = resolvePeriodAndDue("2026-06", 1, true);
assert.equal(bonus.dueDate, end.dueDate);

assert.equal(
  payrollItemDocId("emp1", "2026-06", "salary_mid"),
  "emp1_2026-06_salary_mid",
);

function payrollSpecialItemDocId(employeeId, periodMonth, suffix) {
  const safeEmp = employeeId.replace(/[^\w-]/g, "_").slice(0, 80);
  const safeSuffix = String(suffix || Date.now())
    .replace(/[^\w-]/g, "_")
    .slice(0, 40);
  return `${safeEmp}_${periodMonth}_salary_special_${safeSuffix}`;
}

assert.equal(
  payrollSpecialItemDocId("emp1", "2026-07", "abc123"),
  "emp1_2026-07_salary_special_abc123",
);

// หลายรายการจ่ายแยกต่อเดือนได้ — suffix ต่างกัน
assert.notEqual(
  payrollSpecialItemDocId("emp1", "2026-07", "a"),
  payrollSpecialItemDocId("emp1", "2026-07", "b"),
);

assert.equal(clampDay(0), 1);
assert.equal(clampDay(31), 28);

function periodMonthEndMs(periodMonth) {
  const { year, monthIndex } = parsePeriodMonth(periodMonth);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return bangkokNoonMs(year, monthIndex, lastDay);
}

// มิ.ย. 2026 สิ้นเดือน = 30
assert.equal(periodMonthEndMs("2026-06"), bangkokNoonMs(2026, 5, 30));
assert.equal(periodMonthEndMs("2026-02"), bangkokNoonMs(2026, 1, 28));

console.log("test-payroll: ok");
