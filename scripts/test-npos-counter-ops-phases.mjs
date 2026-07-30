/**
 * Gate: counter-ops phase plan + checklist bank exist and cross-link.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const docs = [
  "docs/npos-counter-ops-phases.md",
  "docs/npos-shift-opener-checklist.md",
  "docs/npos-session-cash-detail-checklist.md",
  "docs/npos-menu-version-sync-checklist.md",
  "docs/npos-payment-voice-checklist.md",
];
for (const rel of docs) {
  assert.ok(existsSync(join(root, rel)), rel);
}

const phases = read("docs/npos-counter-ops-phases.md");
assert.match(phases, /## O0 |## O1 |## O2 |## O3 |## O4 /);
assert.match(phases, /npos-shift-opener-checklist/);
assert.match(phases, /npos-session-cash-detail-checklist/);
assert.match(phases, /npos-menu-version-sync-checklist/);
assert.match(phases, /npos-payment-voice-checklist/);
assert.match(phases, /ใครเข้ากะ|menuVersion|TextToSpeech|cashDropNotes/);
assert.match(phases, /นอกเฟส/);

const opener = read("docs/npos-shift-opener-checklist.md");
assert.match(opener, /OpenShiftFlow|openedBy|ผู้เปิดกะ/);
assert.match(opener, /O1\./);

const cash = read("docs/npos-session-cash-detail-checklist.md");
assert.match(cash, /cashDropNotes|nposSessionClose|ยอดนำส่ง|O2\./);

const menu = read("docs/npos-menu-version-sync-checklist.md");
assert.match(menu, /menuVersion|reloadMenu|O3\./);
assert.match(menu, /นอกสcope|delta/);

const voice = read("docs/npos-payment-voice-checklist.md");
assert.match(voice, /TextToSpeech|รับมา|ทอน|O4\./);
assert.match(voice, /Locale|th_TH|"th"/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-counter-ops-phases/);
assert.match(read("scripts/check-npos-shop.mjs"), /counter-ops-phases/);
assert.match(read("scripts/check-npos-shop.mjs"), /shift-opener/);
assert.match(read("scripts/check-npos-shop.mjs"), /session-cash-detail/);
assert.ok(existsSync(join(root, "scripts/test-npos-shift-opener.mjs")));
assert.ok(existsSync(join(root, "scripts/test-npos-session-cash-detail.mjs")));

console.log("OK test-npos-counter-ops-phases");
