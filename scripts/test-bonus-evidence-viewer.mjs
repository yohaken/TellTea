/**
 * Guard: staff caution/cut viewer must resolve evp: refs (not raw img src).
 * Also proves browsers cannot display evp: as <img src>.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = readFileSync(
  join(root, "src/components/BonusDeductionEvidencePanel.tsx"),
  "utf8",
);
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(panel, /resolveEvidencePhotoSrc/);
assert.match(panel, /pilePreview/);
assert.match(panel, /กำลังโหลดรูป/);
assert.match(panel, /replaceState\(null/);
assert.match(panel, /แตะไอคอนรูปเปิดดูได้เลย/);
assert.match(versionSrc, /APP_BUILD = \d+/);
const build = Number(versionSrc.match(/APP_BUILD = (\d+)/)?.[1] || 0);
assert.ok(build >= 562, `APP_BUILD must be >= 562 (got ${build})`);

// Tiny 1x1 PNG
const DATA_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><body>
<img id="evp" src="evp:fakeDocId" alt="evp" />
<img id="ok" src="${DATA_PNG}" alt="ok" />
</body></html>`);
await page.waitForTimeout(200);
const evpW = await page.$eval("#evp", (el) => el.naturalWidth);
const okW = await page.$eval("#ok", (el) => el.naturalWidth);
assert.equal(evpW, 0, "raw evp: must not decode as image");
assert.ok(okW > 0, "data URL must decode");
console.log("OK evp: blocked, data URL displays");

await browser.close();
console.log("test-bonus-evidence-viewer: ok");
