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
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-nav-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

function visibleSidebarLink(href) {
  return page.locator(`a.pos-sidebar-link[href="${href}"]`).filter({ visible: true });
}

async function clickVisibleNav(href) {
  await openMobileNav(page);
  const link = visibleSidebarLink(href);
  assert.ok((await link.count()) >= 1, `ต้องเห็นลิงก์ ${href} ในแถบ`);
  await Promise.all([
    page.waitForURL(new RegExp(href.replace(/\//g, "\\/").replace(/\/$/, "\\/?")), {
      timeout: 8_000,
      waitUntil: "domcontentloaded",
    }),
    link.first().click(),
  ]);
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
  await clickVisibleNav("/pos/shift/");
});

await report.timed("roundtrip", "nav_roundtrip", async () => {
  await openMobileNav(page);
  await assertCounterNavCut(page);
  await clickVisibleNav("/pos/sell/");
  await waitPosBoot(page);
  await openMobileNav(page);
  await assertCounterNavCut(page);
  await clickVisibleNav("/pos/settings/");
  await openMobileNav(page);
  await assertCounterNavCut(page);
  // Final return via hard navigation (avoids off-canvas flakiness on last hop)
  const sellUrl = POS_E2E_URL.replace(/\/pos\/.*$/, "/pos/sell/");
  await page.goto(sellUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await waitPosBoot(page);
  await openMobileNav(page);
  await assertCounterNavCut(page);
});

report.note("แถบเคาน์เตอร์ไม่มีเมนู/สต็อก/ops · ขาย↔กะ↔ตั้งค่า OK");

await browser.close();
finishReport(report);
