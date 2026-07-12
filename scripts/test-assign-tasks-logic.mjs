/**
 * Pure logic tests for assigned tasks (no Firestore).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function startOfLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function todayStartMs(now = Date.now()) {
  return startOfLocalDay(now);
}

function isAssignTaskFuture(task, now = Date.now()) {
  if (task.status === "completed") return false;
  return startOfLocalDay(task.dueDate) > todayStartMs(now);
}

function canStaffCompleteTask(task, now = Date.now()) {
  if (task.status !== "pending") return false;
  return startOfLocalDay(task.dueDate) <= todayStartMs(now);
}

function allChecklistDone(checklist, checkedIds) {
  if (!checklist.length) return true;
  const set = new Set(checkedIds);
  return checklist.every((item) => set.has(item.id));
}

function validateTaskCompleteInput(input) {
  if (!input.proofImg.trim()) return "แนบรูปหลักฐานก่อนส่งงาน";
  if (!allChecklistDone(input.checklist, input.checkedIds)) {
    return "ติ๊ก checklist ให้ครบทุกข้อก่อนส่ง";
  }
  return null;
}

function sortAssignTasks(rows) {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "pending") return -1;
      if (b.status === "pending") return 1;
    }
    if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
    return b.updatedAt - a.updatedAt;
  });
}

const today = todayStartMs();
const tomorrow = today + 24 * 60 * 60 * 1000;
const yesterday = today - 24 * 60 * 60 * 1000;

const pendingToday = { dueDate: today, status: "pending" };
const pendingTomorrow = { dueDate: tomorrow, status: "pending" };
const pendingYesterday = { dueDate: yesterday, status: "pending" };
const completed = { dueDate: yesterday, status: "completed" };

assert.equal(isAssignTaskFuture(pendingTomorrow, today + 1000), true);
assert.equal(isAssignTaskFuture(pendingToday, today + 1000), false);
assert.equal(isAssignTaskFuture(completed, today + 1000), false);

assert.equal(canStaffCompleteTask(pendingToday, today + 1000), true);
assert.equal(canStaffCompleteTask(pendingTomorrow, today + 1000), false);
assert.equal(canStaffCompleteTask(pendingYesterday, today + 1000), true);
assert.equal(canStaffCompleteTask(completed, today + 1000), false);

const checklist = [
  { id: "a", label: "step 1" },
  { id: "b", label: "step 2" },
];
assert.equal(validateTaskCompleteInput({ checklist, checkedIds: ["a", "b"], proofImg: "" }), "แนบรูปหลักฐานก่อนส่งงาน");
assert.equal(validateTaskCompleteInput({ checklist, checkedIds: ["a"], proofImg: "https://x" }), "ติ๊ก checklist ให้ครบทุกข้อก่อนส่ง");
assert.equal(validateTaskCompleteInput({ checklist, checkedIds: ["a", "b"], proofImg: "https://x" }), null);

const sorted = sortAssignTasks([
  { status: "completed", dueDate: tomorrow, updatedAt: 1 },
  { status: "pending", dueDate: tomorrow, updatedAt: 2 },
  { status: "pending", dueDate: yesterday, updatedAt: 3 },
]);
assert.equal(sorted[0].dueDate, yesterday);
assert.equal(sorted[1].dueDate, tomorrow);
assert.equal(sorted[2].status, "completed");

const pageSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(pageSrc, /isAppOwnerEmail/);
assert.match(pageSrc, /subscribeAllAssignTasks/);
assert.doesNotMatch(pageSrc, /subscribeAssignTasksForEmployee/);
assert.match(cssSrc, /\.tasks-card/);
assert.match(cssSrc, /\.tasks-check-btn/);
assert.match(rulesSrc, /match \/assignTasks\/\{id\}/);
assert.match(rulesSrc, /allow read, create, update, delete: if isOwnerEmail\(\)/);

const moreSrc = readFileSync(join(root, "src/app/more/page.tsx"), "utf8");
const shellSrc = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
assert.match(moreSrc, /isAppOwnerEmail/);
assert.match(moreSrc, /งานมอบหมาย/);
assert.doesNotMatch(shellSrc, /\/tasks\//);

console.log("OK assign-tasks logic + page wiring");
