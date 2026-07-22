/**
 * POS navigation e2e — counter nav must not expose BO/admin entry.
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

async function visit(path, { boot = false } = {}) {
  const res = await page.goto(`${base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  assert.ok(res && res.status() < 400, `HTTP ${res?.status()} for ${path}`);
  assert.match(page.url(), new RegExp(`${path.replace(/\//g, "\\/").replace(/\\\/$/, "")}\\/?`));
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
assert.ok((await sellNavLink(page).filter({ visible: true }).count()) >= 1);

await report.timed("to_shift", "menu_nav", async () => {
  await visit("/pos/shift/");
});

await report.timed("roundtrip", "nav_roundtrip", async () => {
  await visit("/pos/settings/");
  await visit("/pos/sell/", { boot: true });
});

report.note("แถบเคาน์เตอร์ไม่มีเมนู/สต็อก/ops · ขาย/กะ/ตั้งค่า OK");

await browser.close();
finishReport(report);
