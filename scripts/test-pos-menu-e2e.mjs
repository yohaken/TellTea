/**
 * POS menu e2e — counter nav must not expose menu admin;
 * deep-link /pos/menu/ still loads for owner/ops who know the URL.
 */
import assert from "node:assert/strict";
import {
  assertCounterNavCut,
  finishReport,
  gotoPos,
  launchPosE2e,
  openMobileNav,
  PosE2eReport,
  waitPosBoot,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-menu-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
  await openMobileNav(page);
});

await assertCounterNavCut(page);
report.note("เมนูแอดมินไม่อยู่ในแถบเคาน์เตอร์");

const menuUrl = POS_E2E_URL.replace(/\/pos\/.*$/, "/pos/menu/");

await report.timed("to_menu", "menu_nav", async () => {
  await page.goto(menuUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForURL(/\/pos\/menu\/?/, { timeout: 8_000 });
});

await report.timed("menu_auth", "menu_auth", async () => {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (t.includes("เมนูอาหาร") || t.includes("หมวดหมู่รายการ")) && !t.includes("กำลังเชื่อมต่อเมนู...");
    },
    { timeout: 30_000 },
  );
  const menuText = await page.locator("body").innerText();
  assert.ok(menuText.includes("กลุ่มตัวเลือก"), "ต้องเห็นแท็บกลุ่มตัวเลือก");
  if (/Missing or insufficient permissions/i.test(menuText)) {
    throw new Error("permission denied บนหน้าเมนู");
  }
});

report.note("deep-link /pos/menu/ โหลด + auth OK (ไม่ผ่านแถบเคาน์เตอร์)");

await browser.close();
finishReport(report);
