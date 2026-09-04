#!/usr/bin/env node
/**
 * Scan Grab modifier groups from open Merchant UI (parallel tabs).
 *
 *   node scripts/grab-chrome-scan-options.mjs [--workers=4]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  mapPool,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const LIST = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/modifierGroups`;

async function listGroups(tabIndex, windowIndex) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href='${LIST}'; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(2800);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const out = [];
      const seen = new Set();
      // Prefer links/cards with group names
      for (const el of document.querySelectorAll('a, [role="button"], div, span')) {
        const t = (el.innerText || '').trim();
        if (!t || t.length > 80) continue;
        const lines = t.split('\\n').map(x => x.trim()).filter(Boolean);
        if (lines.length < 1) continue;
        const name = lines[0];
        if (/^(ตัวเลือกเสริม|สร้าง|ภาพรวม|เมนู|รายการสินค้า|อัปเดต)/.test(name)) continue;
        if (/^\\d+$/.test(name)) continue;
        // heuristic: name then count number nearby
        const hasCount = lines.some(l => /^\\d+$/.test(l));
        if (!hasCount && lines.length === 1) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name });
      }
      return JSON.stringify(out);
    })()`,
    { windowIndex },
  );
}

function readGroupPage(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const text = document.body.innerText || '';
      const titleEl = document.querySelector('h1,h2,[class*="title"]');
      let group = (titleEl?.innerText || '').trim().split('\\n')[0] || '';
      if (!group) {
        const m = text.match(/ตัวเลือกเสริม[\\s\\S]{0,40}?\\n([^\\n]+)/);
        group = m ? m[1].trim() : '';
      }
      const options = [];
      const seen = new Set();
      // Pattern: name\\n฿price
      const re = /([^\\n]{1,80})\\n฿\\s*([0-9]+(?:\\.[0-9]+)?)/g;
      let m;
      while ((m = re.exec(text))) {
        const name = m[1].trim();
        if (/^(ตัวเลือกเสริม|รายการตัวเลือก|พร้อมจำหน่าย|สร้าง|อัปเดต)/.test(name)) continue;
        if (name === group) continue;
        const price = Number(m[2]);
        const key = name + '|' + price;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ name, price, prices: [price] });
      }
      return JSON.stringify({ group, options, url: location.href });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg
    ? Math.min(8, Math.max(2, Number(workersArg.slice(10))))
    : 4;
  const { windowIndex, tabIndex } = findGrabTab();
  console.log("listing Grab modifier groups…");
  let groups = await listGroups(tabIndex, windowIndex);
  if (!Array.isArray(groups) || !groups.length) {
    // fallback from previous scan
    const prev = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : {};
    const names = [...new Set((prev.options || []).map((o) => o.group).filter(Boolean))];
    groups = names.map((name) => ({ name }));
  }
  console.log(`=== Grab options ×${workers} — ${groups.length} groups ===`);

  const results = await mapPool(groups, workers, async (ti, g, i, wi) => {
    chromeJsOnTab(
      ti,
      `(() => { location.href='${LIST}'; return 'ok'; })()`,
      { windowIndex: wi },
    );
    await sleep(1800);
    const esc = JSON.stringify(g.name);
    chromeJsOnTab(
      ti,
      `(() => {
        const target = ${esc};
        for (const el of document.querySelectorAll('*')) {
          if ((el.innerText||'').trim().split('\\n')[0] === target && el.children.length <= 6) {
            el.click(); return 'ok';
          }
        }
        return 'no';
      })()`,
      { windowIndex: wi },
    );
    await sleep(1800);
    let data = readGroupPage(ti, wi);
    if (!data?.options?.length) {
      await sleep(1200);
      data = readGroupPage(ti, wi);
    }
    console.log(
      `[${i + 1}/${groups.length}] ${(data?.group || g.name).slice(0, 36)} → ${data?.options?.length || 0}`,
    );
    return {
      group: data?.group || g.name,
      options: data?.options || [],
      url: data?.url || LIST,
    };
  });

  const flat = [];
  for (const r of results) {
    for (const o of r.options) {
      flat.push({
        group: r.group,
        name: o.name,
        price: o.price,
        prices: o.prices || [o.price],
        url: r.url,
      });
    }
  }

  const prev = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  prev.options = flat;
  prev.optionsScannedAt = new Date().toISOString();
  writeFileSync(SCAN, JSON.stringify(prev, null, 2) + "\n");
  console.log(`OK options ${flat.length} → ${SCAN}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
