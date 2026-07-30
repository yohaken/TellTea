/**
 * Static checks for salary_special / จ่ายแยก wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const payrollSrc = readFileSync(join(root, "src/lib/payroll.ts"), "utf8");
const empSrc = readFileSync(join(root, "src/lib/employees.ts"), "utf8");
const panelSrc = readFileSync(join(root, "src/components/PayrollPayPanel.tsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/components/PayrollSettingsPanel.tsx"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(payrollSrc, /salary_special/);
assert.match(payrollSrc, /createSpecialPayrollItem/);
assert.match(payrollSrc, /payrollSpecialItemDocId/);
assert.match(payrollSrc, /เงินเดือนจ่ายแยก/);
assert.match(payrollSrc, /!e\.skipGroupPayroll/);

assert.match(empSrc, /skipGroupPayroll/);

assert.match(panelSrc, /จ่ายแยก/);
assert.match(panelSrc, /createSpecialPayrollItem/);
assert.match(panelSrc, /markSkipGroupPayroll/);
assert.match(panelSrc, /ยอดกำหนดเอง/);

assert.match(settingsSrc, /skipGroupPayroll/);
assert.match(settingsSrc, /ข้ามตอนกด/);

assert.match(versionSrc, /APP_BUILD = 492/);

console.log("OK test-payroll-special");
