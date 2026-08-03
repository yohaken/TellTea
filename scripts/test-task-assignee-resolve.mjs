/**
 * Guard: งานมอบหมายต้อง resolve จากลิงก์ canonical ก่อน staff.employeeId ที่อาจค้าง
 * + หน้า tasks / nudge / utility ต้องใช้ hook นี้ ไม่ใช่ staff.employeeId ล้วน
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

function normalizeEmail(e) {
  return String(e || "")
    .trim()
    .toLowerCase();
}

function isLinkedToStaff(emp, staff) {
  if (emp.linkedStaffId) return emp.linkedStaffId === staff.id;
  if (staff.email && emp.linkedEmail) {
    return normalizeEmail(emp.linkedEmail) === normalizeEmail(staff.email);
  }
  return false;
}

function resolveMyWorkerId(employees, staff) {
  if (!staff || !employees.length) return "";
  if (staff.employeeId) {
    const byId = employees.find((e) => e.id === staff.employeeId);
    if (byId) return byId.id;
  }
  const linked = employees.find((e) => isLinkedToStaff(e, staff));
  if (linked) return linked.id;
  return "";
}

/** Mirrors employees.resolveTaskAssigneeId — link wins over stale employeeId */
function resolveTaskAssigneeId(employees, staff) {
  if (!staff || !employees.length) return "";
  const byLink = employees.find((e) => isLinkedToStaff(e, staff));
  if (byLink) return byLink.id;
  return resolveMyWorkerId(employees, staff);
}

const roster = [
  { id: "a", name: "แอน", active: true, linkedStaffId: "s1" },
  { id: "b", name: "บี", active: true, linkedEmail: "b@x.com" },
  { id: "c", name: "ซี", active: true },
];

// stale employeeId "c" but canonical link is "a"
assert.equal(
  resolveTaskAssigneeId(roster, { id: "s1", employeeId: "c" }),
  "a",
  "canonical link must win so staff still sees assigned tasks",
);
assert.equal(
  resolveMyWorkerId(roster, { id: "s1", employeeId: "c" }),
  "c",
  "production/OT keep employeeId-first via resolveMyWorkerId",
);
assert.equal(
  resolveTaskAssigneeId(roster, { id: "sx", email: "b@x.com" }),
  "b",
);
assert.equal(resolveTaskAssigneeId(roster, { id: "sz" }), "");

const employeesSrc = read("src/lib/employees.ts");
assert.match(employeesSrc, /export function resolveTaskAssigneeId/);
assert.match(employeesSrc, /byLink/);

const healSrc = read("src/lib/task-assignee.ts");
assert.match(healSrc, /resolveAndHealTaskAssignee/);
assert.match(healSrc, /updateStaffProfile/);

const hookSrc = read("src/hooks/use-my-task-assignee-id.ts");
assert.match(hookSrc, /resolveAndHealTaskAssignee/);
assert.match(hookSrc, /refreshStaff/);

for (const path of [
  "src/app/tasks/page.tsx",
  "src/components/StaffTaskNudge.tsx",
  "src/components/StaffUtilityDock.tsx",
  "src/components/StaffUtilityPanel.tsx",
]) {
  const src = read(path);
  assert.match(src, /useMyTaskAssigneeId/, `${path} must use assignee hook`);
  assert.doesNotMatch(
    src,
    /const myEmployeeId = staff\?\.employeeId/,
    `${path} must not use staff.employeeId alone for tasks`,
  );
}

const rules = read("firestore.rules");
assert.match(rules, /employeeLinkedToMe/);
assert.match(rules, /assigneeListHasLinkedEmployee/);
assert.match(rules, /isTaskOccurrenceAssignee/);

const nudge = read("src/lib/staff-task-nudge.ts");
assert.match(nudge, /status === "waiting"/);
assert.match(nudge, /waiting:/);

const version = read("src/lib/version.ts");
assert.match(version, /APP_BUILD = 677/);

console.log("OK test-task-assignee-resolve");
