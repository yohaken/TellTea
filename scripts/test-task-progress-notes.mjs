/**
 * Guard: /tasks/ งานมอบหมายคงอยู่ · เช็คลิสย่อย -> โนตความคืบ
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const page = read("src/app/tasks/page.tsx");
const types = read("src/lib/task-types.ts");
const occ = read("src/lib/task-occurrences.ts");
const tpl = read("src/lib/task-templates.ts");
const logic = read("src/lib/task-weekly-logic.ts");
const rules = read("firestore.rules");
const version = read("src/lib/version.ts");
const css = read("src/app/globals.css");

assert.match(page, /งานมอบหมาย/);
assert.match(page, /subscribeTaskTemplates/);
assert.match(page, /addTaskProgressNote/);
assert.match(page, /โนตความคืบ/);
assert.doesNotMatch(page, /ต้องมี checklist อย่างน้อย 1 ข้อ/);
assert.doesNotMatch(page, /ติ๊ก checklist ให้ครบ/);
assert.doesNotMatch(page, /TaskBoardNotesView/);

assert.match(types, /TaskProgressNote/);
assert.match(types, /progressNotes: TaskProgressNote/);
assert.match(occ, /addTaskProgressNote/);
assert.match(occ, /progressNotes: \[\]/);
assert.match(tpl, /เลิกบังคับเช็คลิสย่อย/);
assert.doesNotMatch(tpl, /ต้องมี checklist อย่างน้อย 1 ข้อ/);
assert.match(page, /checklist: \[\]/);
assert.match(logic, /เลิกบังคับติ๊กเช็คลิสย่อย/);
assert.match(rules, /'progressNotes'/);
assert.match(css, /\.tasks-progress-notes/);
assert.match(version, /APP_BUILD = \d+/);
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 657);

console.log("test-task-progress-notes: ok");
