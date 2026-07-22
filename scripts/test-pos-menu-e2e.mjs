/**
 * POS menu e2e — counter nav must not expose menu admin;
 * deep-link /pos/menu/ shows cutover stub (manage on BOH).
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

await report.timed("menu_stub", "menu_cutover_stub", async () => {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("จัดการเมนูย้ายไปหลังร้านแล้ว") || t.includes("อื่นๆ → เมนู");
    },
    { timeout: 20_000 },
  );
  const menuText = await page.locator("body").innerText();
  assert.ok(
    menuText.includes("telltea-shop") || menuText.includes("เปิดจัดการเมนูหลังร้าน"),
    "ต้องมีลิงก์หลังร้าน",
  );
  assert.ok(!menuText.includes("กลุ่มตัวเลือก") || menuText.includes("ย้ายไปหลังร้าน"), "ไม่ใช่ CRUD เต็ม");
});

report.note("deep-link /pos/menu/ = stub cutover (ไม่ใช่ PosMenuAdmin)");

await browser.close();
finishReport(report);
