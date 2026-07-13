/**
 * POS menu UX e2e — Playwright simulates real tablet taps.
 * Run: npm run test:pos-menu-e2e
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

function note(msg) {
  report.observations.push(msg);
  console.log(msg);
}

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
  await openMobileNav(page);
});

const menuLink = menuNavLink(page);
assert.ok((await menuLink.count()) >= 1, "ลิงก์เมนูใน sidebar ต้องมี");
note("ลิงก์เมนูใน sidebar OK");

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
  if (/Missing or insufficient permissions/i.test(menuText)) {
    throw new Error("permission denied บนหน้าเมนู");
  }
});
note("หน้าเมนูโหลด + auth OK");

await page.getByRole("button", { name: "กลุ่มตัวเลือก" }).click();
const plusBtn = page.locator("button.pos-menu-add-btn").first();
await plusBtn.click();

await page.waitForFunction(
  () => document.body.innerText.includes("แก้ไขกลุ่มตัวเลือก"),
  { timeout: 15_000 },
);
note("เพิ่มกลุ่มตัวเลือก → เปิด editor");

const nameInput = page.locator("form.pos-menu-editor-form input").first();
await nameInput.fill("ท็อปปิ้ง e2e");
await page.getByRole("button", { name: "บันทึก" }).click();

await page.waitForFunction(
  () => !document.body.innerText.includes("แก้ไขกลุ่มตัวเลือก"),
  { timeout: 15_000 },
);

const afterSave = await page.locator("body").innerText();
if (/Unsupported field value|permission/i.test(afterSave)) {
  throw new Error(`บันทึกกลุ่มล้มเหลว: ${afterSave.slice(0, 200)}`);
}
note("บันทึกกลุ่มตัวเลือก OK");

await browser.close();
finishReport(report);
