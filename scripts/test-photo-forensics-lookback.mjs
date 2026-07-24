/**
 * Photo forensics: 10-day lookback window (unit + wiring).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// --- Pure lookback logic (inline mirror of src — also import via dynamic if built) ---
function lookbackWindowStartMs(days, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const n = Math.max(1, Math.floor(days));
  d.setDate(d.getDate() - (n - 1));
  return d.getTime();
}

function filterRowsByLookback(rows, days, now) {
  const start = lookbackWindowStartMs(days, now);
  return rows.filter((r) => Number(r.entryDate) >= start);
}

const now = new Date(2026, 6, 24, 15, 30, 0).getTime(); // 24 Jul 2026 local
const start = lookbackWindowStartMs(10, now);
const startDay = new Date(start);
assert.equal(startDay.getFullYear(), 2026);
assert.equal(startDay.getMonth(), 6);
assert.equal(startDay.getDate(), 15); // 24 - 9 = 15 → 10 inclusive days
assert.equal(startDay.getHours(), 0);

const dayMs = 24 * 60 * 60 * 1000;
const rows = [];
for (let i = 0; i < 20; i++) {
  const entryDate = lookbackWindowStartMs(1, now) - i * dayMs;
  rows.push({
    entryId: `e${i}`,
    entryDate,
    label: `d${i}`,
    imageUrls: i % 3 === 0 ? [`evp:p${i}`] : [],
  });
}

const scoped = filterRowsByLookback(rows, 10, now);
assert.equal(scoped.length, 10, `expected 10 lookback rows, got ${scoped.length}`);
assert.ok(scoped.every((r) => r.entryDate >= start));
assert.ok(scoped.some((r) => r.entryId === "e0"));
assert.ok(!scoped.some((r) => r.entryId === "e15"));

// Wiring
const scanSrc = read("src/lib/photo-forensics-scan.ts");
const panelSrc = read("src/components/PhotoForensicsPanel.tsx");
const prodSrc = read("src/app/production/page.tsx");
const otSrc = read("src/app/ot/page.tsx");
const version = read("src/lib/version.ts");
const checklist = read("docs/photo-forensics-checklist.md");

assert.match(scanSrc, /PHOTO_FORENSICS_LOOKBACK_DAYS\s*=\s*10/);
assert.match(scanSrc, /filterRowsByLookback/);
assert.match(scanSrc, /lookbackDays/);
assert.match(panelSrc, /ตรวจ \$\{lookbackDays\} วัน/);
assert.match(panelSrc, /ย้อน \{lookbackDays\} วัน/);
assert.match(prodSrc, /entries\.map\(\(row\)/);
assert.match(otSrc, /entries\.map\(\(row\)/);
assert.doesNotMatch(
  prodSrc.slice(prodSrc.indexOf("forensicsRows"), prodSrc.indexOf("forensicsRows") + 280),
  /filtered\.map/,
);
assert.match(checklist, /10 วัน/);
assert.match(version, /APP_BUILD\s*=\s*272/);

console.log("OK test-photo-forensics-lookback", {
  windowStart: startDay.toISOString().slice(0, 10),
  scoped: scoped.length,
  withPhotos: scoped.filter((r) => r.imageUrls.length).length,
});
