/**
 * POS navigation e2e — web counter retired; stubs point to nPos.
 * Run: npm run test:pos-nav-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  finishReport,
  gotoPos,
  launchPosE2e,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-nav-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

const base = POS_E2E_URL.replace(/\/pos\/.*$/, "");

async function assertRetired(path) {
  const res = await page.goto(`${base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  assert.ok(res && res.status() < 400, `HTTP ${res?.status()} for ${path}`);
  await page.waitForFunction(
    () => /เลิกใช้|nPos/i.test(document.body.innerText),
    { timeout: 10_000 },
  );
  const t = await page.locator("body").innerText();
  assert.match(t, /nPos|ติดตั้ง/);
  assert.match(t, /pos-sales|รายงาน|หลังร้าน/i);
}

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await page.waitForFunction(() => /เลิกใช้|nPos/i.test(document.body.innerText), {
    timeout: 15_000,
  });
});

report.note("เว็บ /pos/sell เป็น stub แล้ว");

for (const path of [
  "/pos/",
  "/pos/sell/",
  "/pos/open-bills/",
  "/pos/receipts/",
  "/pos/shift/",
  "/pos/settings/",
  "/pos/menu/",
]) {
  await report.timed(`visit_${path}`, "menu_nav", async () => {
    await assertRetired(path);
  });
}

await browser.close();
finishReport(report);
