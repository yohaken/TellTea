/**
 * Legacy owner timeline helpers still in lib · /tasks/ เป็นกระดานโนตแล้ว
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const timelineSrc = readFileSync(join(root, "src/lib/task-owner-timeline.ts"), "utf8");
const typesSrc = readFileSync(join(root, "src/lib/task-types.ts"), "utf8");
const occSrc = readFileSync(join(root, "src/lib/task-occurrences.ts"), "utf8");
const weeklySrc = readFileSync(join(root, "src/lib/task-weekly-logic.ts"), "utf8");
const tasksSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const nudgeSrc = readFileSync(join(root, "src/lib/staff-task-nudge.ts"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const cfSrc = readFileSync(join(root, "functions/task-weekly-sync.js"), "utf8");

assert.match(timelineSrc, /buildOwnerTaskTimeline/);
assert.match(timelineSrc, /statusTone: "pending" \| "waiting"/);
assert.match(typesSrc, /"waiting"/);
assert.match(occSrc, /reportTaskOccurrenceWaiting/);
assert.match(weeklySrc, /hasWaiting/);
assert.match(cfSrc, /cancelled: true/);
assert.match(tasksSrc, /TaskBoardNotesView/);
assert.doesNotMatch(tasksSrc, /ส่งแล้ว รอผล/);
assert.match(nudgeSrc, /status === "pending"/);
assert.match(cssSrc, /tasks-timeline-status\.is-waiting/);
assert.match(cssSrc, /\.task-board-page/);
assert.match(versionSrc, /APP_BUILD = \d+/);

function buildOwnerTaskTimeline(occurrences, now = Date.now(), max = 14) {
  const open = [];
  const done = [];
  for (const o of occurrences) {
    const feedback = (o.completionNote || "").trim();
    if (o.status === "completed") {
      done.push({ id: o.id, statusLabel: "ตรงเวลา", whenMs: o.completedAt, feedback });
      continue;
    }
    if (o.status === "waiting") {
      open.push({ id: o.id, statusLabel: "รอ", whenMs: o.updatedAt, feedback, statusTone: "waiting" });
      continue;
    }
    if (o.status === "missed") {
      open.push({ id: o.id, statusLabel: "พลาด", whenMs: o.dueDate, feedback: "", statusTone: "missed" });
      continue;
    }
    if (o.status === "pending" && now >= (o.openAt || 0)) {
      open.push({ id: o.id, statusLabel: "ค้าง", whenMs: o.dueDate, feedback: "", statusTone: "pending" });
    }
  }
  return [...open, ...done].slice(0, max);
}

const rows = buildOwnerTaskTimeline(
  [
    { id: "1", status: "waiting", updatedAt: 2, dueDate: 1, openAt: 0, completionNote: "รอของ" },
    { id: "2", status: "completed", completedAt: 3, dueDate: 1, openAt: 0, completionNote: "" },
  ],
  10,
);
assert.equal(rows[0].id, "1");
assert.equal(rows[0].statusTone, "waiting");
assert.equal(rows[0].feedback, "รอของ");

console.log("test-task-owner-timeline: ok (legacy helpers; UI retired)");
