/**
 * POS sell flow e2e — เปิดกะ → แตะเมนู → เงินสด → วัดความเร็ว
 * Run: npm run test:pos-sell-e2e
 */
import {
  PosE2eReport,
  cashCheckout,
  ensureSelling,
  finishReport,
  gotoPos,
  launchPosE2e,
  tapFirstItemToCart,
  waitPosBoot,
  waitSellGrid,
  POS_E2E_URL,
} from "./pos-e2e-harness.mjs";

const report = new PosE2eReport("pos-sell-e2e");
const { browser, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

await ensureSelling(page, report);
await waitSellGrid(page, report);
await tapFirstItemToCart(page, report);
await cashCheckout(page, report);

report.note("ขายเงินสดสำเร็จ — ตะกร้าควรว่างหลังยืนยัน");

await browser.close();
finishReport(report);
