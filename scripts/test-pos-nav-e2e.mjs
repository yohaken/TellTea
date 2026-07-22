/**
 * POS navigation e2e — counter nav only (no BO/menu admin entry).
 * Run: npm run test:pos-nav-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  assertCounterNavCut,
  finishReport,
  gotoPos,
  launchPosE2e,
  openMobileNav,
  sellNavLink,
  settingsNavLink,
  shiftNavLink,
  waitPosBoot,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-nav-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
  await openMobileNav(page);
});

await assertCounterNavCut(page);
assert.equal(await sellNavLink(page).count(), 1);
assert.equal(await shiftNavLink(page).count(), 1);
assert.equal(await settingsNavLink(page).count(), 1);

await report.timed("to_shift", "menu_nav", async () => {
  await Promise.all([
    page.waitForURL(/\/pos\/shift\/?/, { timeout: 8_000, waitUntil: "domcontentloaded" }),
    shiftNavLink(page).click(),
  ]);
});

await report.timed("roundtrip", "nav_roundtrip", async () => {
  await openMobileNav(page);
  await sellNavLink(page).first().click();
  await page.waitForURL(/\/pos\/sell\/?/, { timeout: 8_000, waitUntil: "domcontentloaded" });
  await waitPosBoot(page);
  await openMobileNav(page);
  await assertCounterNavCut(page);
  await Promise.all([
    page.waitForURL(/\/pos\/settings\/?/, { timeout: 8_000, waitUntil: "domcontentloaded" }),
    settingsNavLink(page).click(),
  ]);
  await openMobileNav(page);
  await sellNavLink(page).first().click();
  await page.waitForURL(/\/pos\/sell\/?/, { timeout: 8_000, waitUntil: "domcontentloaded" });
});

report.note("แถบเคาน์เตอร์ไม่มีเมนู/สต็อก/ops · ขาย↔กะ↔ตั้งค่า OK");

await browser.close();
finishReport(report);
