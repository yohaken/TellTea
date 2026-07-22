/**
 * Stuck bill — บล็อก CF → ขาย → panel บิลค้าง → ส่งอีกครั้ง
 * Run: npm run test:pos-stuck-bill-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  blockPosCloudFunctions,
  cashCheckout,
  ensureSelling,
  finishReport,
  gotoPos,
  isWebPosRetired,
  launchPosE2e,
  openSyncPanel,
  tapFirstItemToCart,
  unblockPosCloudFunctions,
  waitForQueuePill,
  waitPosBoot,
  waitQueueCleared,
  waitSellGrid,
  POS_E2E_URL,
} from "./pos-chaos-harness.mjs";

const report = new PosE2eReport("pos-stuck-bill-e2e");
const { browser, context, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

if (await isWebPosRetired(page)) {
  report.note("เว็บ POS เลิกใช้แล้ว — stuck bill อยู่บน nPos เท่านั้น");
  await browser.close();
  finishReport(report);
  process.exit(0);
}

await blockPosCloudFunctions(context);
report.note("บล็อก Cloud Functions ก่อนเข้างาน");

await ensureSelling(page, report);
await waitSellGrid(page, report);
await tapFirstItemToCart(page, report);

await report.timed("stuck_sale", "cash_checkout", async () => {
  await cashCheckout(page, report);
  await waitForQueuePill(page, 15_000);
});

await report.timed("stuck_panel", "cash_checkout", async () => {
  await openSyncPanel(page);
  const rows = page.locator(".pos-sync-bill-row");
  const count = await rows.count();
  assert.ok(count > 0, "ต้องมีบิลใน panel บิลรอส่ง");
  report.note(`บิลค้าง ${count} รายการ`);

  const retryBtn = page.getByRole("button", { name: "ส่งอีกครั้ง" }).first();
  assert.ok(await retryBtn.isVisible(), "ปุ่มส่งอีกครั้งต้องแสดง");
});

await report.timed("retry_sync", "cash_checkout", async () => {
  await unblockPosCloudFunctions(context);
  report.note("ปล่อย Cloud Functions — รอ auto-sync");
  await page.locator(".pos-sync-panel-header button[aria-label='ปิด']").click().catch(() => {});
  try {
    await waitQueueCleared(page, 50_000);
    report.note("ส่งบิลสำเร็จ — ไม่มี pill รอส่ง");
  } catch {
    await openSyncPanel(page);
    const rows = await page.locator(".pos-sync-bill-row").count();
    if (rows === 0) {
      report.note("panel ว่าง — sync สำเร็จ");
      return;
    }
    const flushBtn = page.getByRole("button", { name: /ส่งทั้งหมด/ });
    await flushBtn.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("ส่งทั้งหมด"));
        return btn && !btn.disabled;
      },
      { timeout: 30_000 },
    );
    await flushBtn.click();
    await waitQueueCleared(page, 30_000);
    report.note("ส่งบิลผ่าน panel สำเร็จ");
  }
});

await browser.close();
finishReport(report);
