/**
 * POS menu UX e2e — โหลดหน้าเมนู + auth (ขั้น editor แยกทดสอบมือ)
 */
import assert from "node:assert/strict";
import {
  finishReport,
  gotoPos,
  launchPosE2e,
  menuNavLink,
  openMobileNav,
  PosE2eReport,
  waitPosBoot,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-menu-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
  await openMobileNav(page);
});

const menuLink = menuNavLink(page);
assert.ok((await menuLink.count()) >= 1, "ลิงก์เมนูใน sidebar ต้องมี");

await report.timed("to_menu", "menu_nav", async () => {
  await Promise.all([
    page.waitForURL(/\/pos\/menu\/?/, { timeout: 20_000, waitUntil: "domcontentloaded" }),
    menuLink.first().click(),
  ]);
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

report.note("หน้าเมนูโหลด + auth OK");

await browser.close();
finishReport(report);
