/**
 * After rename x1 → jay, bonus must stay one person (by employeeId + previousNames).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const bonus = read("src/lib/bonus.ts");
const emp = read("src/lib/employees.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 528/);
assert.match(bonus, /employeeMatchesName/);
assert.match(bonus, /คีย์ด้วย employeeId/);
assert.match(bonus, /ensureByEmployee/);
assert.match(bonus, /previousNames/);
assert.match(emp, /mergePreviousNames/);
assert.match(emp, /previousNames/);

function namesMatch(a, b) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function employeeMatchesName(employee, rawName) {
  if (!rawName.trim()) return false;
  if (namesMatch(employee.name, rawName)) return true;
  if (employee.nickname && namesMatch(employee.nickname, rawName)) return true;
  return (employee.previousNames || []).some((n) => namesMatch(n, rawName));
}

function mergePreviousNames(current, next) {
  const aliases = new Set((current.previousNames || []).map((n) => n.trim()).filter(Boolean));
  const curName = current.name.trim();
  const curNick = (current.nickname || "").trim();
  if (next.name != null) {
    const n = next.name.trim();
    if (curName && n && curName !== n) aliases.add(curName);
  }
  if (next.nickname !== undefined) {
    const n = next.nickname.trim();
    if (curNick && n !== curNick) aliases.add(curNick);
    if (curName && n && curName !== n && curName === curNick) aliases.add(curName);
  }
  const live = new Set();
  if (next.name != null && next.name.trim()) live.add(next.name.trim());
  else if (curName) live.add(curName);
  if (next.nickname !== undefined) {
    if (next.nickname.trim()) live.add(next.nickname.trim());
  } else if (curNick) live.add(curNick);
  return [...aliases].filter((a) => !live.has(a));
}

/** Mirror credit logic: one person after rename */
function creditMonth(employees, entries) {
  const active = employees.filter((e) => e.active);
  const byId = new Map();
  for (const e of active) {
    byId.set(e.id, { workerId: e.id, workerName: e.name, otMain: 0, worked: false });
  }
  for (const row of entries) {
    const credited = new Set();
    const ids = row.workerIds || [];
    for (const id of ids) {
      const emp = active.find((e) => e.id === id);
      if (!emp) continue;
      const slot = byId.get(emp.id);
      slot.otMain += row.amount;
      slot.worked = true;
      slot.workerName = emp.name;
      credited.add(emp.id);
    }
    for (const rawName of row.workerNames || []) {
      const matched = active.find((e) => employeeMatchesName(e, rawName));
      if (matched) {
        if (credited.has(matched.id)) continue;
        const slot = byId.get(matched.id);
        slot.otMain += row.amount;
        slot.worked = true;
        credited.add(matched.id);
        continue;
      }
      if (ids.length > 0) continue;
      const key = `name:${rawName.toLowerCase()}`;
      if (!byId.has(key)) {
        byId.set(key, { workerId: key, workerName: rawName, otMain: 0, worked: false });
      }
      byId.get(key).otMain += row.amount;
      byId.get(key).worked = true;
    }
  }
  return [...byId.values()].filter((s) => s.worked);
}

const aliases = mergePreviousNames(
  { name: "x1", nickname: "x1", previousNames: [] },
  { name: "jay", nickname: "jay" },
);
assert.deepEqual(aliases, ["x1"]);

const jay = {
  id: "emp1",
  name: "jay",
  nickname: "jay",
  previousNames: ["x1"],
  active: true,
};

// Case A: entry has workerId + old name → one row under jay
let rows = creditMonth(
  [jay],
  [{ workerIds: ["emp1"], workerNames: ["x1"], amount: 50 }],
);
assert.equal(rows.length, 1);
assert.equal(rows[0].workerName, "jay");
assert.equal(rows[0].otMain, 50);

// Case B: name-only old entries + previousNames → still jay
rows = creditMonth(
  [jay],
  [{ workerIds: [], workerNames: ["x1"], amount: 30 }],
);
assert.equal(rows.length, 1);
assert.equal(rows[0].workerId, "emp1");
assert.equal(rows[0].otMain, 30);

// Case C: two shifts mixed old/new names → still one person
rows = creditMonth(
  [jay],
  [
    { workerIds: ["emp1"], workerNames: ["x1"], amount: 10 },
    { workerIds: ["emp1"], workerNames: ["jay"], amount: 20 },
  ],
);
assert.equal(rows.length, 1);
assert.equal(rows[0].otMain, 30);

console.log("test-bonus-same-person-rename: ok");
