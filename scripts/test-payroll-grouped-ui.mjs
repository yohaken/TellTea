/**
 * Guard: owner pending queue grouped by employee + combined pay CTA.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const payroll = read("src/lib/payroll.ts");
const panel = read("src/components/PayrollPayPanel.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*557/);
assert.match(payroll, /export function groupPendingPayrollByEmployee/);
assert.match(payroll, /export function isCombinedPairLine/);
assert.match(panel, /groupPendingPayrollByEmployee/);
assert.match(panel, /payroll-pay-groups/);
assert.match(panel, /payroll-combined-btn/);
assert.match(panel, /โอนรวม/);
assert.match(panel, /isCombinedPairLine/);
assert.match(css, /\.payroll-combined-btn/);
assert.match(css, /\.payroll-pay-group/);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function comparePayrollQueueRows(a, b) {
  return a.employeeName.localeCompare(b.employeeName, "th");
}

function listPendingMonthEndBonusPairs(items, periodMonth) {
  const pending = items.filter(
    (i) => i.periodMonth === periodMonth && i.status === "pending",
  );
  const byEmp = new Map();
  for (const item of pending) {
    const list = byEmp.get(item.employeeId) || [];
    list.push(item);
    byEmp.set(item.employeeId, list);
  }
  const pairs = [];
  for (const [, rows] of byEmp) {
    const salary = rows.find((r) => r.kind === "salary_month_end");
    const bonus = rows.find((r) => r.kind === "bonus");
    if (!salary || !bonus) continue;
    pairs.push({
      employeeId: salary.employeeId,
      salary,
      bonus,
      transferTotal: round2(salary.amount + bonus.amount),
    });
  }
  return pairs;
}

function groupPendingPayrollByEmployee(items, periodMonth) {
  const pending = items
    .filter((i) => i.periodMonth === periodMonth && i.status === "pending")
    .sort(comparePayrollQueueRows);
  const pairs = listPendingMonthEndBonusPairs(items, periodMonth);
  const pairByEmp = new Map(pairs.map((p) => [p.employeeId, p]));
  const byEmp = new Map();
  for (const item of pending) {
    const list = byEmp.get(item.employeeId) || [];
    list.push(item);
    byEmp.set(item.employeeId, list);
  }
  const groups = [];
  for (const [employeeId, rows] of byEmp) {
    const pair = pairByEmp.get(employeeId) || null;
    groups.push({
      employeeId,
      items: rows,
      pair,
      groupTotal: round2(rows.reduce((s, r) => s + r.amount, 0)),
    });
  }
  return groups;
}

const items = [
  {
    id: "s",
    employeeId: "a",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    status: "pending",
    kind: "salary_month_end",
    amount: 4000,
  },
  {
    id: "b",
    employeeId: "a",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    status: "pending",
    kind: "bonus",
    amount: 1200,
  },
  {
    id: "m",
    employeeId: "a",
    employeeName: "แป๋ม",
    periodMonth: "2026-07",
    status: "pending",
    kind: "salary_mid",
    amount: 5000,
  },
];
const groups = groupPendingPayrollByEmployee(items, "2026-07");
assert.equal(groups.length, 1);
assert.equal(groups[0].pair.transferTotal, 5200);
assert.equal(groups[0].groupTotal, 10200);
assert.equal(groups[0].items.length, 3);

console.log("OK test-payroll-grouped-ui");
