/**
 * Owner mini timeline + waiting status + completionNote wiring.
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
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const cfSrc = readFileSync(join(root, "functions/task-weekly-sync.js"), "utf8");

assert.match(timelineSrc, /buildOwnerTaskTimeline/);
assert.match(timelineSrc, /statusTone: "pending" \| "waiting"/);
assert.match(typesSrc, /"waiting"/);
assert.match(occSrc, /reportTaskOccurrenceWaiting/);
assert.match(weeklySrc, /hasWaiting/);
assert.match(cfSrc, /hasWaiting/);
assert.match(tasksSrc, /ส่งแล้ว รอผล/);
assert.match(tasksSrc, /บันทึกว่ากำลังรอ/);
assert.match(nudgeSrc, /status === "pending"/);
assert.match(rulesSrc, /completionNote/);
assert.match(cssSrc, /tasks-timeline-status\.is-waiting/);
assert.match(versionSrc, /APP_BUILD = \d+/);
assert.ok(Number(versionSrc.match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 497);

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
    if (now < (o.openAt || 0)) continue;
    open.push({ id: o.id, statusLabel: "ค้าง", whenMs: o.dueDate, feedback: "", statusTone: "pending" });
  }
  open.sort((a, b) => {
    const rank = (t) => (t === "waiting" ? 0 : t === "missed" ? 1 : 2);
    return rank(a.statusTone) - rank(b.statusTone);
  });
  done.sort((a, b) => b.whenMs - a.whenMs);
  return [...open.slice(0, Math.min(open.length, 5)), ...done.slice(0, max)];
}

function actionableNudges(occurrences, now) {
  return occurrences.filter((o) => o.status === "pending" && now >= (o.openAt || 0));
}

const now = 1_000_000_000_000;
const rows = buildOwnerTaskTimeline(
  [
    {
      id: "w1",
      status: "waiting",
      updatedAt: now - 10,
      dueDate: now,
      completionNote: "ส่งซ่อมแล้ว กำลังรออะไหล่",
      openAt: now - 100,
    },
    {
      id: "p1",
      status: "pending",
      openAt: now - 1,
      dueDate: now + 10,
      completionNote: "",
    },
    {
      id: "c1",
      status: "completed",
      completedAt: now - 50,
      completionNote: "เสร็จแล้ว",
    },
  ],
  now,
);

assert.equal(rows[0].id, "w1");
assert.equal(rows[0].statusLabel, "รอ");
assert.equal(rows[0].feedback, "ส่งซ่อมแล้ว กำลังรออะไหล่");
assert.equal(actionableNudges([{ id: "w1", status: "waiting", openAt: 0 }], now).length, 0);
assert.equal(
  actionableNudges([{ id: "p1", status: "pending", openAt: now - 1 }], now).length,
  1,
);

console.log("OK test-task-owner-timeline");
