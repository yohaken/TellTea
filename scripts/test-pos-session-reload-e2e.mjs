/**
 * Session reload — เข้างานแล้ว reload ต้องไม่ดีดออก + session คงใน localStorage ขณะ offline
 * Run: npm run test:pos-session-reload-e2e
 */
import assert from "node:assert/strict";
import {
  PosE2eReport,
  ensureSelling,
  finishReport,
  gotoPos,
  isSelling,
  launchPosE2e,
  setNetworkOffline,
  waitPosBoot,
  POS_E2E_URL,
} from "./pos-chaos-harness.mjs";

async function readOpenSessionFromPage(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("telltea-pos-local-open-session:"));
    if (!key) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed?.status === "open" ? parsed.id : null;
    } catch {
      return null;
    }
  });
}

const report = new PosE2eReport("pos-session-reload-e2e");
const { browser, context, page } = await launchPosE2e();
report.attachPage(page);

console.log(`โหลด ${POS_E2E_URL}`);
await report.timed("boot", "boot_ready", async () => {
  await gotoPos(page);
  await waitPosBoot(page);
});

await ensureSelling(page, report);
const sessionBefore = await readOpenSessionFromPage(page);
assert.ok(sessionBefore, "ต้องมี open session ใน localStorage หลังเข้างาน");

await report.timed("offline_storage", "open_shift", async () => {
  await setNetworkOffline(context, true);
  report.note("ตัดเน็ต — ตรวจ session บนเครื่อง (ไม่ reload เพราะ Playwright offline บล็อก navigation)");
  const sessionOffline = await readOpenSessionFromPage(page);
  assert.equal(sessionOffline, sessionBefore, "session ต้องคงอยู่ใน localStorage ขณะ offline");
  assert.ok(await isSelling(page), "UI ต้องยังอยู่ในรอบขาย");
});

await setNetworkOffline(context, false);

await report.timed("online_reload", "boot_ready", async () => {
  report.note("เปิดเน็ตแล้ว reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitPosBoot(page);
  assert.ok(await isSelling(page), "หลัง reload ต้องไม่กลับหน้าเข้างาน");
  const sessionAfter = await readOpenSessionFromPage(page);
  assert.ok(sessionAfter, "session ต้องยังอยู่หลัง reload");
  report.note("session คงอยู่หลัง reload online");
});

await browser.close();
finishReport(report);
