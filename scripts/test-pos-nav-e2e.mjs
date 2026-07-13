/**
 * POS navigation e2e — เฟืองเมนู ↔ กลับขาย + วัดความเร็ว
 * Run: npm run test:pos-nav-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  finishReport,
  gotoPos,
  launchPosE2e,
  waitPosBoot,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-nav-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

const menuLink = page.locator('a[title="จัดการเมนู"]');
assert.equal(await menuLink.count(), 1);

await report.timed("to_menu", "menu_nav", async () => {
  await Promise.all([
    page.waitForURL(/\/pos\/menu\/?/, { timeout: 8_000, waitUntil: "domcontentloaded" }),
    menuLink.click(),
  ]);
});

await report.timed("menu_ready", "menu_auth", async () => {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("หมวดหมู่รายการ") && !t.includes("กำลังเชื่อมต่อเมนู...");
    },
    { timeout: 20_000 },
  );
  const text = await page.locator("body").innerText();
  if (/permission/i.test(text)) throw new Error("permission denied บนหน้าเมนู");
});

await report.timed("roundtrip", "nav_roundtrip", async () => {
  await page.locator('a[href="/pos/"]').first().click();
  await page.waitForURL(/\/pos\/?$/, { timeout: 8_000, waitUntil: "domcontentloaded" });
  await waitPosBoot(page);
  const href = await menuLink.getAttribute("href");
  assert.equal(href, "/pos/menu/");
  await Promise.all([
    page.waitForURL(/\/pos\/menu/, { timeout: 8_000, waitUntil: "domcontentloaded" }),
    menuLink.click(),
  ]);
});

report.note("นำทางเฟือง ↔ ขาย สองทาง OK");

await browser.close();
finishReport(report);
