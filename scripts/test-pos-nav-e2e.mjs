/**
 * POS navigation e2e — counter nav only (no BO/menu admin entry).
 * Uses hard navigation + sidebar assertions (stable on mobile viewport).
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
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-nav-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

const base = POS_E2E_URL.replace(/\/pos\/.*$/, "");

async function gotoAndAssert(path, boot = false) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForURL(new RegExp(path.replace(/\//g, "\\/").replace(/\/$/, "\\/?")), {
    timeout: 8_000,
  });
  if (boot) await waitPosBoot(page);
  await openMobileNav(page);
  await assertCounterNavCut(page);
}

await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
  await openMobileNav(page);
});

await assertCounterNavCut(page);
assert.ok((await sellNavLink(page).count()) >= 1);
assert.ok((await shiftNavLink(page).count()) >= 1);
assert.ok((await settingsNavLink(page).count()) >= 1);

await report.timed("to_shift", "menu_nav", async () => {
  await gotoAndAssert("/pos/shift/");
});

await report.timed("roundtrip", "nav_roundtrip", async () => {
  await gotoAndAssert("/pos/sell/", true);
  await gotoAndAssert("/pos/settings/");
  await gotoAndAssert("/pos/sell/", true);
  assert.ok((await sellNavLink(page).filter({ visible: true }).count()) >= 1);
});

report.note("แถบเคาน์เตอร์ไม่มีเมนู/สต็อก/ops · ขาย/กะ/ตั้งค่า OK");

await browser.close();
finishReport(report);
