/**
 * Owner mini timeline + completionNote wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const timelineSrc = readFileSync(join(root, "src/lib/task-owner-timeline.ts"), "utf8");
const typesSrc = readFileSync(join(root, "src/lib/task-types.ts"), "utf8");
const occSrc = readFileSync(join(root, "src/lib/task-occurrences.ts"), "utf8");
const tasksSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");

assert.match(timelineSrc, /buildOwnerTaskTimeline/);
assert.match(timelineSrc, /completionNote/);
assert.match(typesSrc, /completionNote\?:/);
assert.match(occSrc, /completionNote/);
assert.match(tasksSrc, /OwnerTaskTimeline/);
assert.match(tasksSrc, /ข้อความถึงเจ้าของ/);
assert.match(tasksSrc, /tasks-owner-timeline/);
assert.match(rulesSrc, /completionNote/);
assert.match(cssSrc, /tasks-owner-timeline/);
assert.match(versionSrc, /APP_BUILD = 496/);

function buildOwnerTaskTimeline(occurrences, now = Date.now(), max = 14) {
  const open = [];
  const done = [];
  for (const o of occurrences) {
    const nudgeKind = o.nudgeKind === "soft" ? "soft" : "deadline";
    const who = (o.assigneeNames || []).filter(Boolean).join(", ") || "—";
    const feedback = (o.completionNote || "").trim();
    if (o.status === "completed") {
      done.push({
        id: o.id,
        statusLabel: "ตรงเวลา",
        whenMs: Number(o.completedAt) || 0,
        feedback,
        nudgeKind,
      });
      continue;
    }
    if (o.status === "missed") {
      open.push({ id: o.id, statusLabel: "พลาด", whenMs: o.dueDate, feedback: "", nudgeKind });
      continue;
    }
    if (now < (o.openAt || 0)) continue;
    open.push({ id: o.id, statusLabel: "ค้าง", whenMs: o.dueDate, feedback: "", nudgeKind });
  }
  open.sort((a, b) => a.whenMs - b.whenMs);
  done.sort((a, b) => b.whenMs - a.whenMs);
  const openCap = Math.min(open.length, Math.max(4, Math.floor(max / 2)));
  return [...open.slice(0, openCap), ...done.slice(0, max - openCap)];
}

const now = 1_000_000_000_000;
const rows = buildOwnerTaskTimeline(
  [
    {
      id: "p1",
      status: "pending",
      openAt: now - 1,
      dueDate: now + 10,
      nudgeKind: "soft",
      assigneeNames: ["มาย"],
      completionNote: "",
    },
    {
      id: "c1",
      status: "completed",
      completedAt: now - 50,
      dueDate: now - 100,
      nudgeKind: "soft",
      assigneeNames: ["มาย"],
      completionNote: "โพสต์แล้ว",
    },
    {
      id: "future",
      status: "pending",
      openAt: now + 99,
      dueDate: now + 200,
      nudgeKind: "deadline",
      assigneeNames: ["บี"],
    },
  ],
  now,
);

assert.equal(rows.length, 2);
assert.equal(rows[0].id, "p1");
assert.equal(rows[0].statusLabel, "ค้าง");
assert.equal(rows[1].feedback, "โพสต์แล้ว");

console.log("OK test-task-owner-timeline");
