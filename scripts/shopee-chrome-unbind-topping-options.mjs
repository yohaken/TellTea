#!/usr/bin/env node
/**
 * Untick all option groups on Shopee dishes in category ทัอปปิ้ง
 * (เมนูท็อปปิ้งไม่ควรมีตัวเลือก — เป็นท็อปปิ้งเอง)
 *
 *   node scripts/shopee-chrome-unbind-topping-options.mjs --dry-run
 *   node scripts/shopee-chrome-unbind-topping-options.mjs --apply
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findShopeeTab,
  chromeJsJsonOnTab,
  chromeJsOnTab,
  editUrl,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/shopee-unbind-topping-options-log.json");
const DISH_API = "https://foody.shopee.co.th/api/seller/store/dishes";

const apply = process.argv.includes("--apply");
const dryRun = !apply || process.argv.includes("--dry-run");
const workers = Math.max(1, Math.min(4, Number((process.argv.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 2));

function isToppingCat(name) {
  return /ท็?อ?ปปิ้ง|ท้อปปิ้ง|ทัอปปิ้ง|topping/i.test(String(name || ""));
}

function xhrOnTab(tabIndex, windowIndex, url) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(null);
      return JSON.stringify({ status: x.status, body: x.responseText });
    })()`,
    { windowIndex },
  );
}

function getJson(tabIndex, windowIndex, url) {
  const r = xhrOnTab(tabIndex, windowIndex, url);
  try {
    return JSON.parse(r.body);
  } catch {
    return { error: true };
  }
}

async function unbindAllOptionsUi(tabIndex, windowIndex, dishId) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(editUrl(dishId))}; return 'ok'; })()`,
    { windowIndex },
  );
  let ready = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    await sleep(400);
    ready = chromeJsJsonOnTab(
      tabIndex,
      `JSON.stringify({
        url: location.href,
        onEdit: location.href.includes('/dish/edit'),
        cbs: document.querySelectorAll('input[type="checkbox"]').length
      })`,
      { windowIndex },
    );
    if (ready?.onEdit && Number(ready.cbs) >= 8) break;
  }
  if (!ready?.onEdit || Number(ready.cbs) < 8) {
    return { ok: false, reason: "edit-not-ready", after: null };
  }

  const unticked = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const prefer = ['ท้อปปิ้ง','ท็อปปิ้ง','ความหวาน','แยกน้ำแข็ง','ประเภท','ช็อตกาแฟ','ช็อตมัทฉะ','ช็อตมะนาว'];
      const fold = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      let n = 0;
      const done = [];
      // 1) known option rows
      for (const name of prefer) {
        for (const tr of document.querySelectorAll('tr')) {
          const first = (tr.innerText || '').trim().split('\\n')[0].trim();
          if (fold(first) !== fold(name)) continue;
          const cb = tr.querySelector('input[type="checkbox"]');
          if (cb && cb.checked) {
            const label = tr.querySelector('label.shopee-pos-checkbox-wrapper') || tr.querySelector('label') || cb;
            try { tr.scrollIntoView({ block: 'center' }); } catch (e) {}
            label.click();
            n += 1;
            done.push(name);
          }
          break;
        }
      }
      // 2) any remaining checked in option table rows
      for (const tr of document.querySelectorAll('tr')) {
        const cb = tr.querySelector('input[type="checkbox"]');
        if (!cb || !cb.checked) continue;
        const first = (tr.innerText || '').trim().split('\\n')[0].trim();
        if (!first || first.length > 40) continue;
        const label = tr.querySelector('label.shopee-pos-checkbox-wrapper') || tr.querySelector('label') || cb;
        try { tr.scrollIntoView({ block: 'center' }); } catch (e) {}
        label.click();
        n += 1;
        done.push(first);
      }
      return JSON.stringify({ unticked: n, done });
    })()`,
    { windowIndex },
  );
  await sleep(500);

  const save = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'บันทึก');
      if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
      btn.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
  await sleep(800);
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const dialog = [...document.querySelectorAll('[class*=modal], [class*=dialog], [class*=confirm]')]
        .find((e) => /บันทึกแทนที่|อัปเดตข้อมูล/i.test(e.innerText || ''));
      if (!dialog) return 'none';
      const ok = [...dialog.querySelectorAll('button')].find((b) => /ตกลง|OK|ยืนยัน/i.test((b.innerText || '').trim()));
      if (ok) ok.click();
      return ok ? 'confirmed' : 'dialog';
    })()`,
    { windowIndex },
  );
  await sleep(2800);
  const after = getJson(tabIndex, windowIndex, `${DISH_API}/${dishId}`);
  const count = after?.data?.dish?.option_group_count ?? null;
  return {
    ok: !!save?.ok && Number(count) === 0,
    unticked: unticked?.unticked ?? 0,
    save,
    after: count,
  };
}

async function main() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const list = getJson(tabIndex, windowIndex, DISH_API);
  const rows = [];
  for (const c of list.data?.catalogs || []) {
    if (!isToppingCat(c.name)) continue;
    for (const d of c.dishes || []) {
      const count = Number(d.option_group_count) || 0;
      if (count <= 0) continue;
      rows.push({
        dishId: String(d.id),
        name: d.name || "",
        category: c.name || "",
        liveCount: count,
      });
    }
  }

  console.log(JSON.stringify({ dryRun, todo: rows.length, rows }, null, 2));
  if (dryRun) {
    writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), dryRun: true, rows }, null, 2) + "\n");
    return;
  }

  const results = await mapPool(rows, workers, async (ti, row, _i, wi) => {
    console.log(`  unbind ${row.name}`);
    const ui = await unbindAllOptionsUi(ti, wi, row.dishId);
    console.log(`    ${row.name} ${row.liveCount}→${ui.after} ${ui.ok ? "ok" : "fail"} ${ui.reason || ""}`);
    return { ...row, result: ui };
  });
  const ok = results.filter((r) => r?.result?.ok);
  const fail = results.filter((r) => r && !r.result?.ok);
  console.log(`\nunbound ${ok.length}/${results.length} · fail ${fail.length}`);
  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), dryRun: false, ok: ok.length, fail: fail.length, results }, null, 2) +
      "\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
