/**
 * Guard: staff RBAC phases wiring (permissions, rules, storage, client).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
assert.match(perms, /payrollPay/);
assert.match(perms, /ELEVATED_PERMISSION_KEYS/);
assert.match(perms, /clampPermissionsForNonOwner/);

const rules = read("firestore.rules");
assert.match(rules, /match \/employeePay\/\{empId\}/);
assert.match(rules, /canReadEmployeePay/);
assert.match(rules, /payrollPay/);
assert.match(rules, /staffHubUpdateOk/);
assert.match(rules, /employeePayMigrateStrip/);
assert.match(rules, /resource\.data\.employeeId == staffEmployeeId\(\)/);

const storage = read("storage.rules");
assert.match(storage, /canOwnerBooksStorage/);
assert.match(storage, /match \/vat-imports\//);
assert.match(storage, /isOwner\(\) \|\| isOwnerEmail\(\)/);

const evidence = read("functions/evidence-upload.js");
assert.match(evidence, /assertOwnerBooksFolder/);

const bonus = read("src/app/bonus/page.tsx");
assert.match(bonus, /payrollPay/);
assert.match(bonus, /listActiveEmployeesWithPay/);
assert.match(bonus, /employeeId: selfId/);

const exportPage = read("src/app/export/page.tsx");
assert.match(exportPage, /canOwnerBooks/);
assert.match(exportPage, /canPnl/);

const employeePay = read("src/lib/employee-pay.ts");
assert.match(employeePay, /migrateAllLegacyEmployeePay/);

console.log("OK staff-rbac-phases guard");
