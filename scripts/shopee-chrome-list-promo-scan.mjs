#!/usr/bin/env node
/**
 * Scan Shopee menu list for list price + ShopeeFood promo price (two ฿ lines per row).
 *
 *   node scripts/shopee-chrome-list-promo-scan.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findShopeeTab,
  chromeJsOnTab,
  goList,
  parseMenuListText,
  sleep,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "data/menu-price-baseline/shopee-list-promo-scan.json");

async function setPageSize(tabIndex, windowIndex, size) {
  chromeJsOnTab(
    tabIndex,
    `(() => {
      for (const el of document.querySelectorAll('span, li, div, button')) {
        const t = (el.innerText||'').trim();
        if (t === '${size}') { el.click(); return 'ok'; }
      }
      return 'no';
    })()`,
    { windowIndex },
  );
  await sleep(1500);
}

async function readPage(tabIndex, windowIndex) {
  return chromeJsOnTab(tabIndex, "document.body.innerText", { windowIndex }) || "";
}

async function clickNext(tabIndex, windowIndex) {
  return chromeJsOnTab(
    tabIndex,
    `(() => {
      for (const el of document.querySelectorAll('li, button, a, span')) {
        const t = (el.innerText||'').trim();
        if (t === '>' || t === '›' || t === 'Next') { el.click(); return true; }
      }
      const active = document.querySelector('.shopee-pos-pagination-item-active, [class*="active"][class*="page"]');
      const next = active?.nextElementSibling;
      if (next) { next.click(); return true; }
      return false;
    })()`,
    { windowIndex },
  );
}

async function main() {
  const { windowIndex, tabIndex } = findShopeeTab();
  goList(tabIndex, windowIndex);
  await sleep(2500);
  await setPageSize(tabIndex, windowIndex, 50);

  const byName = new Map();
  let page = 1;
  while (page <= 12) {
    const text = await readPage(tabIndex, windowIndex);
    const items = parseMenuListText(text);
    for (const it of items) {
      if (!byName.has(it.name)) byName.set(it.name, it);
    }
    console.log(`page ${page}: +${items.length} (total ${byName.size})`);
    if (!text.includes("มีทั้งหมด") || page >= 9) break;
    const hasNext = await clickNext(tabIndex, windowIndex);
    if (!hasNext) break;
    await sleep(1800);
    page++;
  }

  const items = [...byName.values()];
  const out = {
    scannedAt: new Date().toISOString(),
    count: items.length,
    withPromo: items.filter((i) => i.hasPromo).length,
    items,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`OK ${OUT} — ${out.count} menus, ${out.withPromo} with active promo price`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
