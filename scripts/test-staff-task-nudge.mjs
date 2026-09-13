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
const occSrc = readFileSync(join(root, "src/lib/task-occurrences.ts"), "utf8");
const uiSrc = readFileSync(join(root, "src/components/StaffTaskNudge.tsx"), "utf8");
const shellSrc = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
const tasksSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(nudgeLib, /actionableStaffTaskNudges/);
assert.match(nudgeLib, /acknowledgeNotifyToday/);
assert.match(nudgeLib, /isNotifyAckedToday/);
assert.match(nudgeLib, /isEmployeeNotifyAckedToday/);
assert.match(nudgeLib, /summarizeOwnerNotifyAcks/);
assert.match(nudgeLib, /openOwnerNewsOccurrences/);
assert.match(nudgeLib, /STAFF_TASK_DAILY_ACK_KEY/);
assert.match(nudgeLib, /staffTaskBangkokDay/);
assert.doesNotMatch(nudgeLib, /completeTaskOccurrence/);
assert.match(typesSrc, /TaskNudgeKind/);
assert.match(typesSrc, /nudgeKind/);
assert.match(typesSrc, /isNotifyOnlyNudge/);
assert.match(typesSrc, /"task"/);
assert.match(typesSrc, /TaskNotifyAck/);
assert.match(typesSrc, /notifyAcks/);
assert.match(occSrc, /reportTaskNotifyAck/);
assert.match(occSrc, /mapNotifyAcks/);
assert.match(occSrc, /notifyAcks\.\$\{employeeId\}/);
assert.match(nudgeLib, /actionableStaffWorkItems/);
assert.match(nudgeLib, /STAFF_WORK_NUDGE_DISMISS_KEY/);
assert.match(nudgeLib, /summarizeStaffWorkNudges/);
assert.match(uiSrc, /has-staff-task-nudge/);
assert.match(uiSrc, /staff-work-modal/);
assert.match(uiSrc, /งานค้างส่ง/);
assert.match(uiSrc, /ไปส่งงาน/);
assert.match(uiSrc, /ปิดไว้ก่อน/);
assert.match(uiSrc, /staff-task-nudge-strip/);
assert.match(uiSrc, /แจ้งเตือน/);
assert.match(uiSrc, /รับทราบวันนี้/);
assert.match(uiSrc, /acknowledgeNotifyToday/);
assert.match(uiSrc, /reportTaskNotifyAck/);
assert.match(uiSrc, /isPermPreview/);
assert.doesNotMatch(uiSrc, /completeTaskOccurrence/);
assert.match(shellSrc, /StaffTaskNudge/);

const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(cssSrc, /body\.has-staff-task-nudge \.module-tab-dock\.is-single/);
assert.match(cssSrc, /z-index: 48/);
assert.match(tasksSrc, /OwnerHomeTasks/);
assert.match(tasksSrc, /StaffMyTasks/);
assert.match(tasksSrc, /tasks-news-person/);
assert.match(tasksSrc, /รับแล้ว/);
assert.match(tasksSrc, /งานส่ง/);
assert.match(tasksSrc, /แจ้งเบา/);
assert.match(tasksSrc, /มีกำหนด/);
assert.match(tasksSrc, /วันครบ/);
assert.match(tasksSrc, /ทำหมั่นโถว|มอบหมาย/);
assert.match(tasksSrc, /reportTaskNotifyAck/);
assert.match(tasksSrc, /isPermPreview/);
assert.doesNotMatch(tasksSrc, /สูงสุด 3/);
assert.doesNotMatch(tasksSrc, /มอบหมายงานประจำสัปดาห์/);
assert.match(rulesSrc, /match \/\{collection\}\/\{document=\*\*\}/);
assert.match(versionSrc, /APP_BUILD = \d+/);

function actionableStaffTaskNudges(occurrences, employeeId, ackMap, today, now = Date.now()) {
  return occurrences
    .filter((o) => o.status === "pending" && now >= (o.openAt || 0))
    .filter((o) => o.nudgeKind === "soft")
    .filter((o) => {
      if (ackMap[o.id] === today) return false;
      if (employeeId && o.notifyAcks?.[employeeId]?.dayKey === today) return false;
      return true;
    })
    .map((o) => ({
      id: o.id,
      title: o.title,
      dueDate: o.dueDate,
      nudgeKind: "soft",
    }))
    .sort((a, b) => a.dueDate - b.dueDate);
}

function summarizeOwnerNotifyAcks(occ, today) {
  const ids = occ.assigneeIds || [];
  const names = occ.assigneeNames || [];
  const ackedTodayNames = [];
  const pendingTodayNames = [];
  let lastAck = null;
  for (let i = 0; i < ids.length; i++) {
    const employeeId = ids[i];
    const ack = occ.notifyAcks?.[employeeId];
    const displayName = ack?.name || names[i] || "ไม่ระบุชื่อ";
    if (ack?.dayKey === today) ackedTodayNames.push(displayName);
    else pendingTodayNames.push(names[i] || "ไม่ระบุชื่อ");
    if (ack?.at && (!lastAck || ack.at > lastAck.at)) {
      lastAck = { employeeId, name: displayName, at: ack.at, dayKey: ack.dayKey };
    }
  }
  return {
    assigneeCount: ids.length,
    ackedTodayCount: ackedTodayNames.length,
    pendingTodayCount: pendingTodayNames.length,
    ackedTodayNames,
    pendingTodayNames,
    lastAck,
  };
}

const now = Date.UTC(2026, 6, 30, 5);
const today = "2026-07-30";
const rows = actionableStaffTaskNudges(
  [
    {
      id: "a",
      status: "pending",
      openAt: now - 1000,
      title: "เบา",
      dueDate: now + 86400000,
      nudgeKind: "soft",
      notifyAcks: {},
    },
    {
      id: "b",
      status: "pending",
      openAt: now - 1000,
      title: "ด่วน",
      dueDate: now + 3600000,
      nudgeKind: "deadline",
      notifyAcks: {},
    },
    {
      id: "c",
      status: "pending",
      openAt: now + 999999,
      title: "ยังไม่เปิด",
      dueDate: now + 86400000,
      nudgeKind: "deadline",
      notifyAcks: {},
    },
    {
      id: "d",
      status: "completed",
      openAt: now - 1000,
      title: "เสร็จ",
      dueDate: now,
      nudgeKind: "deadline",
      notifyAcks: {},
    },
    {
      id: "e",
      status: "pending",
      openAt: now - 1000,
      title: "รับทราบแล้ววันนี้",
      dueDate: now + 1000,
      nudgeKind: "soft",
      notifyAcks: {},
    },
    {
      id: "f",
      status: "pending",
      openAt: now - 1000,
      title: "cloud ack",
      dueDate: now + 2000,
      nudgeKind: "soft",
      notifyAcks: { emp1: { dayKey: today, at: now - 10, name: "แป๋ม" } },
    },
  ],
  "emp1",
  { e: today },
  today,
  now,
);

assert.equal(rows.length, 1);
assert.equal(rows[0].id, "a");

const summary = summarizeOwnerNotifyAcks(
  {
    assigneeIds: ["emp1", "emp2"],
    assigneeNames: ["แป๋ม", "ทัพ"],
    notifyAcks: {
      emp1: { dayKey: today, at: now - 1000, name: "แป๋ม" },
      emp2: { dayKey: "2026-07-29", at: now - 86400000, name: "ทัพ" },
    },
  },
  today,
);
assert.equal(summary.ackedTodayCount, 1);
assert.equal(summary.pendingTodayCount, 1);
assert.equal(summary.lastAck.name, "แป๋ม");
assert.deepEqual(summary.pendingTodayNames, ["ทัพ"]);

console.log("OK test-staff-task-nudge");
