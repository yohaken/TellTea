import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const panel = readFileSync(join(root, "src/components/PosClockInPanel.tsx"), "utf8");
assert.match(panel, /เวลาปัจจุบัน/);
assert.match(panel, /formatLiveClock/);
assert.match(panel, /กะอ้างอิง/);
assert.match(panel, /ช่วงมาตรฐาน/);
assert.match(panel, /เริ่มรอบเมื่อ/);
assert.match(panel, /ปิดรอบเมื่อ/);
assert.match(panel, /getCurrentShiftId/);
assert.match(panel, /labelOtShift/);
assert.match(panel, /เข้างาน/);

const sellPage = readFileSync(join(root, "src/app/pos/sell/page.tsx"), "utf8");
assert.match(sellPage, /PosClockInPanel/);
assert.doesNotMatch(sellPage, /pos-sell-clock-hint/);

const ctx = readFileSync(join(root, "src/lib/pos-app-context.tsx"), "utf8");
assert.match(ctx, /startPosSessionLocal\(deviceId, getCurrentShiftId\(\)\)/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-clock-in-time/);
assert.match(css, /\.pos-clock-in-table/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 37/);

console.log("OK pos-clock-in");
