/**
 * Mirrors resolveLinkedEmployee matching order (employees.ts).
 */
import assert from "node:assert/strict";

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

function resolveLinkedEmployee(employees, staff) {
  if (!staff || !employees.length) return null;
  if (staff.employeeId) {
    const byId = employees.find((e) => e.id === staff.employeeId);
    if (byId) return byId;
  }
  const linked = employees.find((e) => isLinkedToStaff(e, staff));
  if (linked) return linked;
  const name = (staff.displayName || "").trim().toLowerCase();
  if (!name) return null;
  return employees.find((e) => e.active && e.name.trim().toLowerCase() === name) || null;
}

const roster = [
  { id: "a", name: "แอน", active: true, linkedStaffId: "s1" },
  { id: "b", name: "บี", active: true, linkedEmail: "b@x.com" },
  { id: "c", name: "ซี", active: true },
];

assert.equal(resolveLinkedEmployee(roster, { id: "s1", employeeId: "c" })?.id, "c");
assert.equal(resolveLinkedEmployee(roster, { id: "s1" })?.id, "a");
assert.equal(
  resolveLinkedEmployee(roster, { id: "sx", email: "b@x.com" })?.id,
  "b",
);
assert.equal(
  resolveLinkedEmployee(roster, { id: "sy", displayName: "ซี" })?.id,
  "c",
);
assert.equal(resolveLinkedEmployee(roster, { id: "sz", displayName: "ไม่มี" }), null);

console.log("test-resolve-linked-employee: ok");
