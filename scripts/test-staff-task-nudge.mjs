/**
 * Staff task nudge helpers + wiring checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const nudgeLib = readFileSync(join(root, "src/lib/staff-task-nudge.ts"), "utf8");
const typesSrc = readFileSync(join(root, "src/lib/task-types.ts"), "utf8");
const uiSrc = readFileSync(join(root, "src/components/StaffTaskNudge.tsx"), "utf8");
const shellSrc = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
const tasksSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(nudgeLib, /actionableStaffTaskNudges/);
assert.match(nudgeLib, /staffTaskNudgeFingerprint/);
assert.match(nudgeLib, /summarizeStaffTaskNudges/);
assert.match(typesSrc, /TaskNudgeKind/);
assert.match(typesSrc, /nudgeKind/);
assert.match(uiSrc, /staff-task-nudge-strip/);
assert.match(uiSrc, /งานค้าง/);
assert.match(shellSrc, /StaffTaskNudge/);
assert.match(tasksSrc, /แจ้งเบาๆ/);
assert.match(tasksSrc, /มีกำหนด/);
assert.match(rulesSrc, /nudgeKind/);
assert.match(versionSrc, /APP_BUILD = \d+/);

function nudgeSortRank(item) {
  if (item.status === "waiting") return 1;
  return item.nudgeKind === "deadline" ? 0 : 2;
}

function actionableStaffTaskNudges(occurrences, now = Date.now()) {
  return occurrences
    .filter(
      (o) =>
        (o.status === "pending" || o.status === "waiting") &&
        now >= (o.openAt || 0),
    )
    .map((o) => ({
      id: o.id,
      title: o.title,
      dueDate: o.dueDate,
      nudgeKind: o.nudgeKind === "soft" ? "soft" : "deadline",
      status: o.status === "waiting" ? "waiting" : "pending",
    }))
    .sort((a, b) => {
      const ua = nudgeSortRank(a);
      const ub = nudgeSortRank(b);
      if (ua !== ub) return ua - ub;
      return a.dueDate - b.dueDate;
    });
}

const now = Date.UTC(2026, 6, 30, 5);
const rows = actionableStaffTaskNudges(
  [
    {
      id: "a",
      status: "pending",
      openAt: now - 1000,
      title: "เบา",
      dueDate: now + 86400000,
      nudgeKind: "soft",
    },
    {
      id: "b",
      status: "pending",
      openAt: now - 1000,
      title: "ด่วน",
      dueDate: now + 3600000,
      nudgeKind: "deadline",
    },
    {
      id: "c",
      status: "pending",
      openAt: now + 999999,
      title: "ยังไม่เปิด",
      dueDate: now + 86400000,
      nudgeKind: "deadline",
    },
    {
      id: "d",
      status: "completed",
      openAt: now - 1000,
      title: "เสร็จ",
      dueDate: now,
      nudgeKind: "deadline",
    },
    {
      id: "e",
      status: "waiting",
      openAt: now - 1000,
      title: "รอร้าน",
      dueDate: now + 7200000,
      nudgeKind: "deadline",
    },
  ],
  now,
);

assert.equal(rows.length, 3);
assert.equal(rows[0].id, "b");
assert.equal(rows[1].id, "e");
assert.equal(rows[2].id, "a");
assert.match(uiSrc, /useMyTaskAssigneeId/);
assert.match(nudgeLib, /status === "waiting"/);

console.log("OK test-staff-task-nudge");
