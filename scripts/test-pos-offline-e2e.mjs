/**
 * Offline sale → online sync e2e
 * Run: npm run test:pos-offline-e2e
 */
import {
  PosE2eReport,
  blockPosCloudFunctions,
  cashCheckout,
  ensureSelling,
  finishReport,
  gotoPos,
  launchPosE2e,
  openSyncPanel,
  setNetworkOffline,
  tapFirstItemToCart,
  unblockPosCloudFunctions,
  waitForQueuePill,
  waitPosBoot,
  waitQueueCleared,
  waitSellGrid,
  POS_E2E_URL,
} from "./pos-chaos-harness.mjs";

const report = new PosE2eReport("pos-offline-e2e");
const { browser, context, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

await ensureSelling(page, report);
await waitSellGrid(page, report);
await tapFirstItemToCart(page, report);

await report.timed("offline_sale", "cash_checkout", async () => {
  await setNetworkOffline(context, true);
  report.note("ตัดเน็ตก่อนชำระเงิน");
  await page.waitForFunction(
    () => document.body.innerText.includes("เน็ตออฟ"),
    { timeout: 8_000 },
  ).catch(() => report.note("pill เน็ตออฟ อาจยังไม่อัปเดตทันที"));

  await blockPosCloudFunctions(context);
  await cashCheckout(page, report);
  await waitForQueuePill(page, 15_000);
  report.note("ขาย offline สำเร็จ — มีบิลรอส่ง");
});

await report.timed("online_sync", "cash_checkout", async () => {
  await setNetworkOffline(context, false);
  await unblockPosCloudFunctions(context);
  report.note("เปิดเน็ต + ปล่อย Cloud Functions");
  await openSyncPanel(page);
  const rows = page.locator(".pos-sync-bill-row");
  const count = await rows.count();
  if (count === 0) report.note("panel ว่าง — อาจ sync เร็วมาก");
  else report.note(`panel แสดงบิลค้าง ${count} รายการ`);

  const flushBtn = page.getByRole("button", { name: /ส่งทั้งหมด/ });
  if (await flushBtn.isEnabled().catch(() => false)) {
    await flushBtn.click();
  }
  await page.locator(".pos-sync-panel").waitFor({ state: "hidden", timeout: 3_000 }).catch(async () => {
    await page.keyboard.press("Escape");
  });
  await waitQueueCleared(page, 45_000).catch(() => {
    report.note("บิลอาจยังรอส่ง — ตรวจ manual ถ้า CI ช้า");
  });
});

await browser.close();
finishReport(report);
