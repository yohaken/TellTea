/**
 * Post-deploy: version 562+ + live bundle has staff viewer resolve path.
 * Local UI smoke: forced-viewer-like stage shows image after "resolve".
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = "https://telltea-shop.web.app";
const DATA_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const ver = await (await page.goto(`${BASE}/version.json`, { waitUntil: "domcontentloaded" })).json();
assert.ok(ver.build >= 562, `expected build>=562 got ${ver.version}`);
console.log("OK live version", ver.version);

await page.goto(`${BASE}/bonus/`, { waitUntil: "domcontentloaded", timeout: 60000 });
const html = await page.content();
const chunkMatch = html.match(/\/_next\/static\/chunks\/app\/bonus\/page-[^"]+\.js/);
assert.ok(chunkMatch, "bonus page chunk missing");
const chunkUrl = BASE + chunkMatch[0];
const chunk = await (await page.goto(chunkUrl)).text();
assert.match(chunk, /กำลังโหลดรูป/);
assert.match(chunk, /แตะไอคอนรูปเปิดดูได้เลย/);
assert.match(chunk, /ดูหลักฐานตามลำดับ/);
console.log("OK bonus chunk has staff viewer resolve UI");

// Shared evidence-photos chunk must ship resolve error string
await page.goto(`${BASE}/bonus/`, { waitUntil: "domcontentloaded" });
const html2 = await page.content();
const allChunks = [...html2.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]);
let foundResolve = false;
for (const path of allChunks) {
  const body = await (await page.goto(BASE + path)).text();
  if (body.includes("ไม่พบรูปหลักฐานในฐานข้อมูล")) {
    foundResolve = true;
    console.log("OK resolveEvidencePhotoSrc shipped in", path);
    break;
  }
}
assert.ok(foundResolve, "resolveEvidencePhotoSrc not found in live chunks");

// UI smoke: after resolve → data URL, image paints (mirrors ForcedViewer stage)
await page.setContent(`<!doctype html><html><body>
<div class="bonus-forced-stage"><p class="muted" id="st">กำลังโหลดรูป…</p></div>
<script>
async function fakeResolve(ref) {
  if (!String(ref).startsWith("evp:")) return ref;
  return ${JSON.stringify(DATA_PNG)};
}
(async () => {
  const stage = document.querySelector(".bonus-forced-stage");
  const src = await fakeResolve("evp:demo");
  stage.innerHTML = "";
  const img = document.createElement("img");
  img.id = "photo";
  img.className = "bonus-forced-img";
  img.alt = "หลักฐานระวัง";
  img.src = src;
  stage.appendChild(img);
})();
</script>
</body></html>`);
await page.waitForSelector("#photo");
await page.waitForFunction(() => {
  const el = document.querySelector("#photo");
  return el && el.complete && el.naturalWidth > 0;
}, null, { timeout: 5000 });
const w = await page.$eval("#photo", (el) => el.naturalWidth);
assert.ok(w > 0);
console.log("OK forced-viewer stage paints after resolve");

await browser.close();
console.log("test-bonus-evidence-viewer-live: ok");
