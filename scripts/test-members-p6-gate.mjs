/**
 * Guard: members P6 — gate docs + BOH enable/emergency UX.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/members-staff-guide.md")));
assert.ok(existsSync(join(root, "docs/members-p6-gate.md")));

const guide = read("docs/members-staff-guide.md");
assert.match(guide, /ถามเบอร์/);
assert.match(guide, /ใช้แต้ม/);
assert.match(guide, /ปิดธง/);

const gate = read("docs/members-p6-gate.md");
assert.match(gate, /แมทริกซ์เทส/);
assert.match(gate, /ปิดธงฉุกเฉิน/);
assert.match(gate, /33/);
assert.match(gate, /receiptClaimEnabled|QR สลิป/);

const page = read("src/app/members/page.tsx");
assert.match(page, /members-gate/);
assert.match(page, /เกตเปิดใช้หน้าร้าน/);
assert.match(page, /เตรียมปิดฉุกเฉิน/);
assert.match(page, /ใช้เรทแนะนำ 33/);

const css = read("src/app/globals.css");
assert.match(css, /\.members-gate\b/);

const phases = read("docs/members-round-phases.md");
assert.match(phases, /P6/);
assert.match(phases, /members-staff-guide/);

const appBuild = Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]);
assert.ok(appBuild >= 742, "APP_BUILD >= 742");

console.log("OK test-members-p6-gate");
