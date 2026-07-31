/**
 * Static + pure checks for record advance (date/slip/books) wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const payrollSrc = readFileSync(join(root, "src/lib/payroll.ts"), "utf8");
const panelSrc = readFileSync(join(root, "src/components/PayrollPayPanel.tsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/components/PayrollSettingsPanel.tsx"), "utf8");
const checklist = readFileSync(join(root, "docs/payroll-advance-checklist.md"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(payrollSrc, /recordEmployeeAdvance/);
assert.match(payrollSrc, /slipUrls/);
assert.match(payrollSrc, /receiptUrls: slipUrls/);
assert.match(payrollSrc, /pendingPayrollNeedingAdvanceRefresh/);
assert.match(payrollSrc, /payroll-advance/);
assert.match(payrollSrc, /updated/);
assert.match(payrollSrc, /skippedGroupNames/);
assert.match(payrollSrc, /forceIncludedNames/);
assert.match(payrollSrc, /issues/);
assert.match(payrollSrc, /inScope/);
assert.match(payrollSrc, /skipGroupPayroll: false/);

assert.match(panelSrc, /บันทึกเบิก/);
assert.match(panelSrc, /recordEmployeeAdvance/);
assert.match(panelSrc, /postToBooks:\s*true/);
assert.match(panelSrc, /voidPendingThenHint/);
assert.match(panelSrc, /openAdvanceForm/);

assert.match(settingsSrc, /บันทึกเบิก/);
assert.match(checklist, /แป๋ม/);
assert.match(checklist, /บันทึกเบิก/);
assert.match(checklist, /สร้างเงินเดือน/);

assert.match(versionSrc, /APP_BUILD = \d+/);

/** Mirror pendingPayrollNeedingAdvanceRefresh */
function pendingPayrollNeedingAdvanceRefresh(items, employeeId, periodMonth) {
  return items.filter(
    (i) =>
      i.employeeId === employeeId &&
      i.periodMonth === periodMonth &&
      i.status === "pending" &&
      ["salary_mid", "salary_month_end", "bonus", "salary_special"].includes(i.kind) &&
      !(i.advanceDeduct > 0),
  );
}

const sample = [
  {
    id: "1",
    employeeId: "paem",
    periodMonth: "2026-07",
    status: "pending",
    kind: "salary_month_end",
    advanceDeduct: 0,
  },
  {
    id: "2",
    employeeId: "paem",
    periodMonth: "2026-07",
    status: "pending",
    kind: "salary_mid",
    advanceDeduct: 5000,
  },
  {
    id: "3",
    employeeId: "other",
    periodMonth: "2026-07",
    status: "pending",
    kind: "salary_month_end",
    advanceDeduct: 0,
  },
  {
    id: "4",
    employeeId: "paem",
    periodMonth: "2026-07",
    status: "void",
    kind: "salary_month_end",
    advanceDeduct: 0,
  },
];

const need = pendingPayrollNeedingAdvanceRefresh(sample, "paem", "2026-07");
assert.equal(need.length, 1);
assert.equal(need[0].id, "1");

console.log("OK test-payroll-advance");
