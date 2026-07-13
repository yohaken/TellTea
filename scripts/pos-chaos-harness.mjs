/**
 * Chaos / resilience helpers for TellTea POS Playwright tests.
 * ตัดเน็ต · บล็อก Cloud Functions · panel บิลค้าง · หาเมนูไม่มีตัวเลือก
 */
export {
  PosE2eReport,
  POS_E2E_BUDGETS,
  POS_E2E_URL,
  cashCheckout,
  ensureSelling,
  finishReport,
  gotoPos,
  installE2eMenuCache,
  isSelling,
  launchPosE2e,
  tapFirstItemToCart,
  waitPosBoot,
  waitSellGrid,
} from "./pos-e2e-harness.mjs";

/** ตัด/เปิดเน็ตของ browser context */
export async function setNetworkOffline(context, offline) {
  await context.setOffline(offline);
}

/** บล็อก posCompleteSale — บังคับให้บิลค้างใน outbox */
export async function blockPosCloudFunctions(context) {
  await context.route(/cloudfunctions\.net/i, (route) => route.abort("failed"));
}

export async function unblockPosCloudFunctions(context) {
  await context.unroute(/cloudfunctions\.net/i);
}

/** รอ pill รอส่ง/เน็ตออฟ บน status bar */
export async function waitForQueuePill(page, timeout = 20_000) {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return /รอส่ง|ค้างส่ง|กำลังส่ง|เน็ตออฟ/.test(t);
    },
    { timeout },
  );
}

/** เปิด panel บิลรอส่งจาก pill บน status bar */
export async function openSyncPanel(page) {
  const pill = page.locator(".pos-lite-pill-btn").filter({ hasText: /รอส่ง|ค้างส่ง|กำลังส่ง/ });
  await pill.first().waitFor({ state: "visible", timeout: 15_000 });
  await pill.first().click();
  await page.locator("#pos-sync-panel-title").waitFor({ state: "visible", timeout: 5_000 });
}

/** ปิด panel บิลรอส่ง */
export async function closeSyncPanel(page) {
  await page.locator(".pos-sync-panel-header button[aria-label='ปิด']").click();
  await page.locator("#pos-sync-panel-title").waitFor({ state: "hidden", timeout: 5_000 });
}

/**
 * หาเมนูที่แตะแล้วเข้าตะกร้าทันที (ไม่มี popup ตัวเลือก)
 * คืน locator ของปุ่มเมนู
 */
export async function findSimpleMenuItem(page) {
  const items = page.locator(".pos-sell-item:not(.pos-sell-item--soldout)");
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    await item.click();
    const picker = page.locator(".pos-option-picker");
    if (await picker.isVisible().catch(() => false)) {
      const cancel = page.locator(".pos-option-cancel-btn");
      if (await cancel.isVisible().catch(() => false)) await cancel.click();
      else await page.keyboard.press("Escape");
      await picker.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
      continue;
    }
    const qty = page.locator(".pos-sell-item-qty");
    if (await qty.first().isVisible().catch(() => false)) {
      return item;
    }
  }
  throw new Error("ไม่พบเมนูที่ไม่มีตัวเลือก — seed เมนูหรือปิด option groups");
}

/** แตะเมนูง่ายๆ หลายครั้งติด — คืน qty บน badge */
export async function rapidTapMenuItem(page, item, times = 5) {
  for (let i = 0; i < times; i++) {
    await item.click({ delay: 30 });
  }
  await page.waitForFunction(
    (n) => {
      const badge = document.querySelector(".pos-sell-item-qty");
      if (!badge) return false;
      const m = badge.textContent?.match(/×(\d+)/);
      return m && Number(m[1]) >= n;
    },
    times,
    { timeout: 5_000 },
  );
  const text = await page.locator(".pos-sell-item-qty").first().textContent();
  const m = text?.match(/×(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** รอจน pill รอส่งหาย (sync สำเร็จ) */
export async function waitQueueCleared(page, timeout = 45_000) {
  await page.waitForFunction(
    () => {
      const pills = [...document.querySelectorAll(".pos-lite-pill-btn")];
      return !pills.some((p) => /รอส่ง|ค้างส่ง|กำลังส่ง/.test(p.textContent || ""));
    },
    { timeout },
  );
}
