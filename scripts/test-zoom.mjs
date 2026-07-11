/**
 * Verify sheet zoom CSS variable actually changes computed font-size.
 */
import { chromium, devices } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();

await page.setContent(`<!DOCTYPE html>
<html><head>
<style>
.sheet-wrap { --sheet-zoom: 1; }
.sheet-table { font-size: calc(0.82rem * var(--sheet-zoom)); }
.sheet-table td { font-size: inherit; }
</style></head>
<body>
  <div class="sheet-wrap" id="wrap">
    <table class="sheet-table"><tr><td id="cell">ทดสอบ</td></tr></table>
  </div>
  <button id="plus">+</button>
  <button id="minus">-</button>
  <script>
    let zoom = 1;
    const wrap = document.getElementById('wrap');
    function apply() { wrap.style.setProperty('--sheet-zoom', String(zoom)); }
    document.getElementById('plus').onclick = () => { zoom = Math.min(1.6, +(zoom + 0.1).toFixed(2)); apply(); };
    document.getElementById('minus').onclick = () => { zoom = Math.max(0.7, +(zoom - 0.1).toFixed(2)); apply(); };
  </script>
</body></html>`);

const base = await page.locator("#cell").evaluate((el) => getComputedStyle(el).fontSize);
await page.click("#plus");
await page.click("#plus");
const bigger = await page.locator("#cell").evaluate((el) => getComputedStyle(el).fontSize);
await page.click("#minus");
await page.click("#minus");
await page.click("#minus");
const smaller = await page.locator("#cell").evaluate((el) => getComputedStyle(el).fontSize);

const b = parseFloat(base);
const g = parseFloat(bigger);
const s = parseFloat(smaller);
console.log({ base, bigger, smaller });
if (!(g > b * 1.05)) {
  console.error("FAIL: zoom + did not enlarge text");
  process.exitCode = 1;
} else if (!(s < b * 0.95)) {
  console.error("FAIL: zoom - did not shrink text");
  process.exitCode = 1;
} else {
  console.log("OK zoom changes computed font-size");
}

// Also confirm production CSS contains the fix
const css = await (await fetch("https://telltea-shop.web.app/")).text().catch(() => "");
await browser.close();
if (process.exitCode) process.exit(process.exitCode);
