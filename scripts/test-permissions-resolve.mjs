/**
 * Guard: permission resolve architecture (deny-by-default + level source of truth).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
assert.match(perms, /EMPTY_STAFF_PERMISSIONS/);
assert.match(perms, /materializePermissions/);
assert.match(perms, /resolveEffectivePermissions/);
assert.match(perms, /withResolvedPermissions/);
assert.match(perms, /SHIFT_LEAD_PERMISSIONS/);
assert.match(perms, /ledger:\s*false/);
assert.match(perms, /stock:\s*false/);
assert.match(
  perms,
  /Missing keys = false|missing = false|missing keys = false|คีย์ที่ไม่มีใน input = ปิด/i,
);

// Pure mirror of materialize + resolve (keep in sync with src/lib/permissions.ts)
const KEYS = [
  "ledger",
  "stock",
  "production",
  "otBonus",
  "checklist",
  "assignTasks",
  "bonus",
  "ownerBooks",
  "pnl",
  "transferIn",
  "exportData",
  "staffManage",
  "payrollPay",
  "membersView",
  "membersManage",
  "membersAdjustPoints",
];

function empty() {
  return Object.fromEntries(KEYS.map((k) => [k, false]));
}

function materialize(input) {
  const out = empty();
  if (!input) return out;
  for (const k of KEYS) {
    if (typeof input[k] === "boolean") out[k] = input[k];
  }
  return out;
}

const DEFAULT = {
  ...empty(),
  production: true,
  otBonus: true,
  checklist: true,
  bonus: true,
};

function resolve(member, levels) {
  if (!member) return empty();
  if (member.role === "owner") {
    const o = empty();
    for (const k of KEYS) o[k] = k !== "assignTasks";
    return o;
  }
  const levelId = (member.permissionLevelId || "").trim();
  const customized = member.permissionsCustomized === true;
  if (!customized && levelId && levels?.length) {
    const level = levels.find((l) => l.id === levelId);
    if (level && level.active !== false) return materialize(level.permissions);
  }
  if (member.permissions && typeof member.permissions === "object") {
    return materialize(member.permissions);
  }
  if (!customized && levelId && levels?.length) {
    return empty();
  }
  return { ...DEFAULT };
}

const shopStaff = {
  id: "shop_staff",
  active: true,
  permissions: { ...DEFAULT },
};

// พนักงานร้านจาก level → ไม่มี ledger/stock
const toey = resolve(
  {
    role: "staff",
    permissionLevelId: "shop_staff",
    permissionsCustomized: false,
    permissions: { ledger: true, stock: true, bonus: true }, // แผนที่เก่าค้าง — ต้องแพ้ level
  },
  [shopStaff],
);
assert.equal(toey.ledger, false);
assert.equal(toey.stock, false);
assert.equal(toey.bonus, true);
assert.equal(toey.production, true);

// customize → ใช้แผนที่บน staff (deny missing)
const custom = resolve(
  {
    role: "staff",
    permissionLevelId: "shop_staff",
    permissionsCustomized: true,
    permissions: { bonus: true, ledger: true },
  },
  [shopStaff],
);
assert.equal(custom.ledger, true);
assert.equal(custom.bonus, true);
assert.equal(custom.production, false); // missing = false

// partial map ไม่เติม DEFAULT
assert.equal(materialize({ bonus: true }).ledger, false);
assert.equal(materialize({ bonus: true }).bonus, true);

const levels = read("src/lib/permission-levels.ts");
assert.match(levels, /syncLevelPermissionsToLinkedStaff/);
assert.match(levels, /ensurePermissionLevelSeeds/);
assert.match(levels, /seed\.isSystem/);

const auth = read("src/lib/auth.tsx");
assert.match(auth, /permissionLevels/);
assert.match(auth, /withResolvedPermissions/);
assert.match(auth, /ensurePermissionLevelSeeds/);

const preview = read("src/lib/perm-preview.ts");
assert.match(preview, /resolveEffectivePermissions/);
assert.match(preview, /levels\?/);

const rules = read("firestore.rules");
assert.match(rules, /hasPermFromLevel/);
assert.match(rules, /staffUsesLinkedLevel/);
assert.match(rules, /linkedLevelActive/);
assert.match(rules, /staffHasBrokenLevelLink/);
assert.match(rules, /allow read: if isStaff\(\) \|\| isOwnerEmail\(\)/);
assert.match(
  rules,
  /p == 'production' \|\| p == 'otBonus' \|\| p == 'checklist' \|\| p == 'bonus'/,
);
assert.doesNotMatch(
  rules,
  /!get\(staffPath\(\)\)\.data\.keys\(\)\.hasAny\(\['permissions'\]\)[\s\S]*?p == 'ledger'/,
  "legacy hasPerm fallback must not grant ledger",
);

// inactive level → deny (mirror client)
const inactive = resolve(
  { role: "staff", permissionLevelId: "shop_staff", permissionsCustomized: false },
  [{ id: "shop_staff", active: false, permissions: { bonus: true, production: true } }],
);
assert.equal(inactive.bonus, false);
assert.equal(inactive.production, false);

console.log("OK test-permissions-resolve");
