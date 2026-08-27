/**
 * OT grid slot keys — Bangkok timezone must match shift-session / incomplete popup
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const otGrid = read("src/lib/ot-grid.ts");
const otView = read("src/lib/ot-view-window.ts");

assert.doesNotMatch(otGrid, /d\.getFullYear\(\)/, "ot-grid must not use host-local date parts");
assert.doesNotMatch(otView, /d\.getFullYear\(\)/, "ot-view-window must not use host-local date parts");
assert.match(otGrid, /shiftSlotKey/);
assert.match(otGrid, /startOfLocalDay/);
assert.match(otView, /T00:00:00\+07:00/);

function bangkokDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
function startOfLocalDay(ms) {
  const key = bangkokDateKey(ms);
  return Date.parse(`${key}T00:00:00+07:00`);
}
function shiftSlotKey(dateMs, shift) {
  return `${startOfLocalDay(dateMs)}|${shift}`;
}

const aug25 = Date.parse("2025-08-25T00:00:00+07:00");
const gridDay = startOfLocalDay(aug25);
const bkkKey = shiftSlotKey(aug25, "morning");

assert.equal(shiftSlotKey(gridDay, "morning"), bkkKey);

// Under UTC host TZ, old host-local indexing would bucket Aug 25 +07 on Aug 24
process.env.TZ = "UTC";
const d = new Date(aug25);
const hostKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|morning`;
assert.notEqual(hostKey, bkkKey);
assert.equal(shiftSlotKey(startOfLocalDay(aug25), "morning"), bkkKey);

console.log("OK test-ot-grid-timezone");
