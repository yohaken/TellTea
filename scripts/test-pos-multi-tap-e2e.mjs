/**
 * Multi-tap menu — แตะเร็วหลายครั้ง qty ต้องถูก
 * Run: npm run test:pos-multi-tap-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  ensureSelling,
  finishReport,
  findSimpleMenuItem,
  gotoPos,
  isWebPosRetired,
  launchPosE2e,
  waitPosBoot,
  waitSellGrid,
  POS_E2E_URL,
} from "./pos-chaos-harness.mjs";

const TAP_TIMES = 5;
const report = new PosE2eReport("pos-multi-tap-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

if (await isWebPosRetired(page)) {
  report.note("เว็บ POS เลิกใช้แล้ว — multi-tap อยู่บน nPos เท่านั้น");
  await browser.close();
  finishReport(report);
  process.exit(0);
}

await ensureSelling(page, report);
await waitSellGrid(page, report);

let qty = 0;
await report.timed("multi_tap", "tap_to_cart", async () => {
  const item = await findSimpleMenuItem(page);
  report.note("พบเมนูไม่มีตัวเลือก — แตะซ้ำจนครบ 5");
  for (let i = 1; i < TAP_TIMES; i++) {
    await item.click({ delay: 40 });
  }
  await page.waitForFunction(
    (n) => {
      const badge = document.querySelector(".pos-sell-item-qty");
      const m = badge?.textContent?.match(/×(\d+)/);
      return m && Number(m[1]) >= n;
    },
    TAP_TIMES,
    { timeout: 5_000 },
  );
  const badgeText = await page.locator(".pos-sell-item-qty").first().textContent();
  const m = badgeText?.match(/×(\d+)/);
  qty = m ? Number(m[1]) : 0;
  assert.ok(qty >= TAP_TIMES, `qty ควร ≥ ${TAP_TIMES} ได้ ${qty}`);
  report.note(`badge เมนู ×${qty}`);

  const cartHead = page.locator(".pos-cart-head-count");
  if (await cartHead.isVisible().catch(() => false)) {
    const cartText = await cartHead.innerText();
    report.note(`ตะกร้า: ${cartText}`);
  }
});

await browser.close();
finishReport(report);
