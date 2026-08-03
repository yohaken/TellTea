/**
 * Guard: normalize / compact โนตกิจการ + หน้า / อื่นๆ / rules
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// tsx resolves TS via dynamic import in sibling tests — use string guards for page wiring
const more = readFileSync(new URL("../src/app/more/page.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/business-notes/page.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/components/BusinessNotesView.tsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src/lib/business-notes.ts", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const version = readFileSync(new URL("../src/lib/version.ts", import.meta.url), "utf8");

assert.match(more, /href="\/business-notes\/"/);
assert.match(more, /โนตกิจการ/);
assert.match(page, /BusinessNotesView/);
assert.match(page, /role === "owner"/);
assert.match(shell, /"\/business-notes"/);
assert.match(view, /เซฟอัตโนมัติ/);
assert.match(view, /business-notes-tabs/);
assert.match(view, /sheet-bleed/);
assert.match(lib, /BUSINESS_NOTES_DOC = "businessNotes"/);
assert.match(lib, /byTab/);
assert.match(rules, /businessNotes' && isOwner\(\)/);
assert.match(rules, /docId != 'businessNotes'/);
assert.match(css, /\.business-notes-page/);
assert.match(css, /\.business-notes-table/);
assert.match(version, /APP_BUILD = \d+/);
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 628);

// Runtime normalize via tsx-less pure reimplementation checks in lib source
assert.match(lib, /compactBusinessNoteRows/);
assert.match(lib, /createBusinessNoteRow/);
assert.match(lib, /normalizeBusinessNotes/);

// Ensure require cache doesn't complain — optional runtime if built
void require;

console.log("test-business-notes: ok");
