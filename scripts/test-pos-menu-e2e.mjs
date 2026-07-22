/**
 * POS menu e2e — /pos/menu/ is retired stub (manage on BOH / nPos).
 */
import assert from "node:assert/strict";
import {
  finishReport,
  gotoPos,
  launchPosE2e,
  PosE2eReport,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-menu-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await page.waitForFunction(() => /เลิกใช้|nPos/i.test(document.body.innerText), {
    timeout: 15_000,
  });
});

const menuUrl = POS_E2E_URL.replace(/\/pos\/.*$/, "/pos/menu/");

await report.timed("to_menu", "menu_nav", async () => {
  await page.goto(menuUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForURL(/\/pos\/menu\/?/, { timeout: 8_000 });
});

await report.timed("menu_stub", "menu_auth", async () => {
  await page.waitForFunction(
    () => /เลิกใช้|จัดการเมนู|nPos|หลังร้าน/i.test(document.body.innerText),
    { timeout: 10_000 },
  );
  const t = await page.locator("body").innerText();
  assert.match(t, /เมนู|nPos|หลังร้าน/);
  assert.doesNotMatch(t, /PosMenuAdmin|กลุ่มตัวเลือก/);
});

report.note("เมนูเว็บเป็น stub — จัดการที่หลังร้าน / ขายบน nPos");

await browser.close();
finishReport(report);
