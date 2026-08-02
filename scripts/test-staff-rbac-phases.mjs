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
// assignTasks removed from picker groups (legacy)
assert.doesNotMatch(
  perms,
  /keys: \[[^\]]*assignTasks/,
  "assignTasks should not appear in PERMISSION_GROUPS keys",
);

const levels = read("src/lib/permission-levels.ts");
assert.match(levels, /SEED_PERMISSION_LEVELS/);
assert.match(levels, /shop_staff/);
assert.match(levels, /ensurePermissionLevelSeeds/);
assert.match(levels, /permissionsCustomized/);

const preview = read("src/lib/perm-preview.ts");
assert.match(preview, /PERM_PREVIEW_STORAGE_KEY/);
assert.match(preview, /PERM_PREVIEW_CHECKLIST/);
assert.match(preview, /buildPreviewStaff/);
assert.match(preview, /previewFromLevel/);

const auth = read("src/lib/auth.tsx");
assert.match(auth, /startPermPreview/);
assert.match(auth, /stopPermPreview/);
assert.match(auth, /isPermPreview/);
assert.match(auth, /realStaff/);

const shell = read("src/components/AppShell.tsx");
assert.match(shell, /PermPreviewBanner/);
assert.match(shell, /isPermPreview/);

const staffPage = read("src/app/staff/page.tsx");
assert.match(staffPage, /ลำดับสิทธิ์/);
assert.match(staffPage, /PermissionLevelsPanel/);
assert.match(staffPage, /permissionLevelId/);
assert.match(staffPage, /beginPreviewFromLevel/);
assert.match(staffPage, /ดูแบบเขา/);

const readiness = read("src/components/StaffReadinessTable.tsx");
assert.match(readiness, /staffLevelBadgeLabel/);
assert.match(readiness, /staff-ready-col-level/);

const ledger = read("src/app/ledger/page.tsx");
assert.match(ledger, /can\(staff, "ledger"\)/);
assert.match(ledger, /can\(staff, "transferIn"\)/);
assert.match(ledger, /staffHomeHref/);
assert.doesNotMatch(
  ledger,
  /transferInOpen && isOwner/,
  "transfer-in UI must follow transferIn permission, not owner-only",
);

const lowBal = read("src/components/LowBalanceAlert.tsx");
assert.match(lowBal, /canTransferIn/);

const rules = read("firestore.rules");
assert.match(rules, /match \/permissionLevels\/\{levelId\}/);
assert.match(rules, /match \/employeePay\/\{empId\}/);
assert.match(rules, /canReadEmployeePay/);
assert.match(rules, /payrollPay/);
assert.match(rules, /staffHubUpdateOk/);
assert.match(rules, /employeePayMigrateStrip/);
assert.match(rules, /resource\.data\.employeeId == staffEmployeeId\(\)/);
assert.match(rules, /match \/stockCosts\/\{itemId\}/);
assert.match(rules, /match \/bonusLivePool\/\{monthKey\}/);
assert.match(rules, /canReadBonusEntry/);
// get ต้องคู่ list (hasPerm) — ห้ามจำกัดแค่ workerIds ไม่งั้นลงยอดย้อนหลังพัง
assert.match(
  rules,
  /function canReadBonusEntry\(perm\) \{[\s\S]*?hasPerm\(perm\)/,
);
assert.doesNotMatch(
  rules,
  /function canReadBonusEntry\(perm\) \{[\s\S]*?workerIds/,
  "canReadBonusEntry must not require workerIds (breaks backdated OT save)",
);
assert.match(rules, /match \/assignTasks\/\{id\}[\s\S]*?allow write: if false/);

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
assert.match(bonus, /computePersonalBonusRow/);
assert.match(bonus, /saveBonusLivePool/);
assert.match(bonus, /workerId: selfId/);
assert.match(bonus, /subscribeBonusMonthStatus/);
assert.match(bonus, /subscribeBonusPersonalClose/);
assert.match(bonus, /workerRowFromPersonalClose/);
assert.match(bonus, /migrateAllBonusCloseSideDocs/);

assert.match(rules, /match \/bonusMonthStatus\/\{monthId\}/);
assert.match(rules, /match \/bonusPersonalCloses\/\{id\}/);
assert.match(
  rules,
  /match \/bonusMonthCloses\/\{monthId\}[\s\S]*?allow read: if isOwner\(\) \|\| isOwnerEmail\(\) \|\| hasPerm\('payrollPay'\)/,
);

const personalClose = read("src/lib/bonus-personal-close.ts");
assert.match(personalClose, /BONUS_PERSONAL_CLOSE_COL/);
assert.match(personalClose, /writeBonusCloseSideDocs/);
assert.match(personalClose, /employeeId/);

const closeMigrate = read("src/lib/bonus-close-migrate.ts");
assert.match(closeMigrate, /migrateAllBonusCloseSideDocs/);

const exportPage = read("src/app/export/page.tsx");
assert.match(exportPage, /canOwnerBooks/);
assert.match(exportPage, /canPnl/);

const employeePay = read("src/lib/employee-pay.ts");
assert.match(employeePay, /migrateAllLegacyEmployeePay/);

const stockCosts = read("src/lib/stock-costs.ts");
assert.match(stockCosts, /migrateAllLegacyStockCosts/);
assert.match(stockCosts, /stockCosts/);

const stockLib = read("src/lib/stock.ts");
assert.match(stockLib, /subscribeStockItemsWithCosts/);
assert.match(stockLib, /setStockUnitCost/);

const bonusLib = read("src/lib/bonus.ts");
assert.match(bonusLib, /computePersonalBonusRow/);

const assertRules = read("scripts/assert-firestore-rules.mjs");
assert.match(assertRules, /stockCosts/);
assert.match(assertRules, /bonusLivePool/);
assert.match(assertRules, /bonusMonthStatus/);
assert.match(assertRules, /bonusPersonalCloses/);

const indexes = read("firestore.indexes.json");
assert.match(indexes, /"workerIds"/);
assert.match(indexes, /"arrayConfig": "CONTAINS"/);

console.log("OK staff-rbac-phases guard (p0–p9)");
