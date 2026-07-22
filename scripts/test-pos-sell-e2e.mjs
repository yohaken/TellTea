/**
 * POS sell e2e — web sell retired; assert stub (non-blocking in CI suite).
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  finishReport,
  gotoPos,
  launchPosE2e,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-sell-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await page.waitForFunction(() => /เลิกใช้|nPos/i.test(document.body.innerText), {
    timeout: 20_000,
  });
});

const t = await page.locator("body").innerText();
assert.match(t, /เลิกใช้|nPos/);
assert.match(t, /install|ติดตั้ง/i);
report.note("หน้าขายเว็บเลิกใช้แล้ว — ขายบน nPos");

await browser.close();
finishReport(report);
