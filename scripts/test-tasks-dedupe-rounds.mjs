/**
 * Task weekly sync — Bangkok day math + one open pending per template.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  computeSyncOperations,
  dueDatesToEnsure,
  startOfLocalDay,
  periodKeyFromDue,
} = require("../functions/task-weekly-sync.js");

const logic = readFileSync(join(root, "src/lib/task-weekly-logic.ts"), "utf8");
const occ = readFileSync(join(root, "src/lib/task-occurrences.ts"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(version, /APP_BUILD = 357/);
assert.match(logic, /Asia\/Bangkok/);
assert.match(logic, /occurrenceDocId/);
assert.match(logic, /deleteDupes/);
assert.match(logic, /byTpl/);
assert.match(occ, /occurrenceDocId/);
assert.match(occ, /deleteDupes/);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mon 2026-07-27 06:00 Asia/Bangkok = Sun 23:00 UTC */
const bangkokMon6am = Date.parse("2026-07-26T23:00:00.000Z");

assert.equal(periodKeyFromDue(startOfLocalDay(bangkokMon6am)), "2026-07-27");

// Monday template at Bangkok Mon 06:00 — only this Monday (not last week)
const monDues = dueDatesToEnsure(bangkokMon6am, 1, 3);
assert.deepEqual(
  monDues.map((d) => periodKeyFromDue(d)),
  ["2026-07-27"],
);

const tpl = {
  id: "tpl1",
  active: true,
  weekday: 1,
  openDaysBefore: 3,
  title: "ล้างตู้",
  note: "",
  checklist: [],
  assigneeIds: ["a"],
  assigneeNames: ["เมย์"],
  dismissedPeriodKeys: [],
};

// Duplicate same periodKey → delete extra
const dupes = computeSyncOperations(
  [tpl],
  [
    {
      id: "rand1",
      templateId: "tpl1",
      periodKey: "2026-07-27",
      dueDate: startOfLocalDay(bangkokMon6am),
      openAt: startOfLocalDay(bangkokMon6am) - 3 * DAY_MS,
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "tpl1_2026-07-27",
      templateId: "tpl1",
      periodKey: "2026-07-27",
      dueDate: startOfLocalDay(bangkokMon6am),
      openAt: startOfLocalDay(bangkokMon6am) - 3 * DAY_MS,
      status: "pending",
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  bangkokMon6am,
);
assert.equal(dupes.deleteDupes.length, 1);
assert.equal(dupes.deleteDupes[0].occurrenceId, "rand1");
assert.equal(dupes.create.length, 0);

// Two open pendings different weeks → keep latest, miss the older
const twoOpen = computeSyncOperations(
  [tpl],
  [
    {
      id: "old",
      templateId: "tpl1",
      periodKey: "2026-07-20",
      dueDate: startOfLocalDay(bangkokMon6am) - 7 * DAY_MS,
      openAt: startOfLocalDay(bangkokMon6am) - 10 * DAY_MS,
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "cur",
      templateId: "tpl1",
      periodKey: "2026-07-27",
      dueDate: startOfLocalDay(bangkokMon6am),
      openAt: startOfLocalDay(bangkokMon6am) - 3 * DAY_MS,
      status: "pending",
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  bangkokMon6am,
);
assert.ok(twoOpen.markMissed.some((m) => m.occurrenceId === "old"));
assert.ok(!twoOpen.markMissed.some((m) => m.occurrenceId === "cur"));

console.log("OK test-tasks-dedupe-rounds");
