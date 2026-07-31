/**
 * Gate: staff setup checklist + install page post-claim steps.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 530/);

assert.ok(existsSync(join(root, "docs/npos-staff-setup-checklist.md")));
const doc = read("docs/npos-staff-setup-checklist.md");
assert.match(doc, /heartbeat|รหัสลับ|พิมพ์ทดสอบ|ลิ้นชัก/);
assert.match(doc, /pos-sales\/\?tab=manage/);
assert.match(doc, /ปิดกั้นเครื่องจำลอง/);

const install = read("public/install/index.html");
assert.match(install, /หลังใส่รหัสลับ|เคลมเครื่อง/);
assert.match(install, /พิมพ์ทดสอบ/);
assert.match(install, /npos-staff-setup-checklist/);
assert.match(install, /heartbeat/);

console.log("OK test-npos-staff-setup-checklist");
