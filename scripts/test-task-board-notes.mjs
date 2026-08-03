/**
 * Guard: /tasks/ เป็นกระดานโนต (พนักงาน+เจ้าของ) · ยกเลิก checklist
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const page = read("src/app/tasks/page.tsx");
const view = read("src/components/TaskBoardNotesView.tsx");
const lib = read("src/lib/task-board-notes.ts");
const rules = read("firestore.rules");
const css = read("src/app/globals.css");
const shell = read("src/components/AppShell.tsx");
const nav = read("src/lib/nav-menu.ts");
const version = read("src/lib/version.ts");
const cf = read("functions/task-weekly-sync.js");
const utility = read("src/lib/staff-utility.ts");
const panel = read("src/components/StaffUtilityPanel.tsx");
const dock = read("src/components/StaffUtilityDock.tsx");

assert.match(page, /TaskBoardNotesView/);
assert.match(page, /กระดานโนต/);
assert.match(page, /isPermPreview/);
assert.doesNotMatch(page, /subscribeTaskTemplates/);
assert.doesNotMatch(page, /checklistDone/);
assert.doesNotMatch(page, /createTaskTemplate/);

assert.match(view, /createTaskBoardNote/);
assert.match(view, /subscribeTaskBoardNotes/);
assert.match(view, /sheet-bleed/);
assert.match(view, /task-board-table/);

assert.match(lib, /TASK_BOARD_NOTES_COL = "taskBoardNotes"/);
assert.match(lib, /normalizeTaskBoardNoteText/);
assert.match(lib, /canDeleteTaskBoardNote/);

assert.match(rules, /match \/taskBoardNotes\/\{id\}/);
assert.match(rules, /taskBoardNoteCreate/);
assert.match(rules, /match \/taskTemplates\/\{id\}/);
assert.match(rules, /allow create, update: if false/);

assert.match(css, /\.task-board-page/);
assert.match(css, /\.task-board-table/);
assert.match(css, /\.task-board-input/);

assert.doesNotMatch(shell, /StaffTaskNudge/);
assert.match(nav, /กระดานโนตความคืบ/);
assert.match(version, /APP_BUILD = \d+/);
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 656);

assert.match(cf, /cancelled: true/);
assert.match(utility, /label: "โนต"/);
assert.match(panel, /เปิดกระดานโนต/);
assert.doesNotMatch(dock, /subscribeTaskOccurrencesForAssignee/);
assert.doesNotMatch(panel, /subscribeTaskOccurrencesForAssignee/);

// pure helpers
function normalize(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 500);
}
assert.equal(normalize("  hello  "), "hello");
assert.equal(normalize("a".repeat(600)).length, 500);

function canDelete(note, opts) {
  if (opts.isOwner) return true;
  return !!opts.actorId && note.createdBy === opts.actorId;
}
assert.equal(canDelete({ createdBy: "a" }, { actorId: "a", isOwner: false }), true);
assert.equal(canDelete({ createdBy: "a" }, { actorId: "b", isOwner: false }), false);
assert.equal(canDelete({ createdBy: "a" }, { actorId: "b", isOwner: true }), true);

console.log("test-task-board-notes: ok");
