#!/usr/bin/env node
/**
 * Untick all option groups on LINE MAN items in category ทัอปปิ้ง
 *
 *   node scripts/lineman-chrome-unbind-topping-options.mjs --dry-run
 *   node scripts/lineman-chrome-unbind-topping-options.mjs --apply
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import {
  findWongnaiTab,
  listWongnaiMenuItems,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  editUrl,
  sleep,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/lineman-unbind-topping-options-log.json");

const apply = process.argv.includes("--apply");
const dryRun = !apply || process.argv.includes("--dry-run");

const CHANNEL_LABELS = new Set(["เดลิเวอรี", "รับที่ร้าน", "หน้าร้าน", "เลือกสินค้านี้เป็นสินค้าแนะนำของร้าน"]);
const OPTION_LIKE =
  /ประเภท|ความหวาน|แยกน้ำแข็ง|ท้อปปิ้ง|ท็อปปิ้ง|ช็อต|ขนาด|รสชาติ|ซอฟต์คุกกี้|โปรโมชั่น|ชิโอปัง/;

function isToppingCat(name) {
  return /ท็?อ?ปปิ้ง|ท้อปปิ้ง|ทัอปปิ้ง|topping/i.test(String(name || ""));
}

function tab() {
  return findWongnaiTab();
}

function go(url) {
  const { windowIndex, tabIndex } = tab();
  chromeJsOnTab(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, {
    windowIndex,
  });
}

function readChecked() {
  const { windowIndex, tabIndex } = tab();
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const skip = ${JSON.stringify([...CHANNEL_LABELS])};
      const checked = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter((el) => el.checked)
        .map((el) => (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim().split('\\n')[0])
        .filter((t) => t && !skip.includes(t) && t.length < 60);
      return JSON.stringify({
        url: location.href,
        onEdit: /\\/menu\\/0[a-zA-Z0-9]+\\/edit/.test(location.href),
        checked,
      });
    })()`,
    { windowIndex },
  );
}

function untickLabels(labels) {
  const { windowIndex, tabIndex } = tab();
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const labels = ${JSON.stringify(labels)};
      const done = [];
      const missed = [];
      for (const label of labels) {
        const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
        const box = boxes.find((el) => {
          const t = (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim().split('\\n')[0];
          return t === label;
        });
        if (!box) { missed.push(label); continue; }
        if (box.checked) box.click();
        done.push({ label, checked: !!box.checked });
      }
      return JSON.stringify({ done, missed });
    })()`,
    { windowIndex },
  );
}

function clickSave() {
  const { windowIndex, tabIndex } = tab();
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /บันทึก/.test((b.innerText || '').trim()));
      if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
      btn.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
}

async function loadPosToppingNames() {
  const db = await getSeedDb();
  const [itemsSnap, catsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
  ]);
  const cats = new Map(catsSnap.docs.map((d) => [d.id, d.data()?.name || ""]));
  return itemsSnap.docs
    .map((d) => {
      const data = d.data() || {};
      return {
        name: data.name || "",
        active: data.active !== false,
        category: cats.get(data.categoryId) || "",
      };
    })
    .filter((p) => p.active && isToppingCat(p.category))
    .map((p) => p.name);
}

async function main() {
  const toppingNames = await loadPosToppingNames();
  const toppingSet = new Set(toppingNames.map((n) => normName(n)));
  findWongnaiTab();
  const lmItems = await listWongnaiMenuItems();
  const candidates = lmItems.filter((it) => toppingSet.has(normName(it.name)) || toppingNames.some((n) => namesEqual(n, it.name)));

  const plan = [];
  for (const it of candidates) {
    go(editUrl(it.id));
    await sleep(2800);
    let state = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      state = readChecked();
      if (state?.onEdit) break;
      await sleep(400);
    }
    const checkedOpts = (state?.checked || []).filter((t) => OPTION_LIKE.test(t));
    plan.push({
      id: it.id,
      name: it.name,
      href: it.href || editUrl(it.id),
      checkedAll: state?.checked || [],
      checkedOpts,
      needUnbind: checkedOpts.length > 0,
    });
    console.log(`  scan ${it.name} opts=${checkedOpts.join(",") || "—"}`);
  }

  const todo = plan.filter((p) => p.needUnbind);
  console.log(JSON.stringify({ dryRun, scanned: plan.length, todo: todo.length, todoNames: todo.map((t) => t.name) }, null, 2));

  if (dryRun) {
    writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), dryRun: true, plan }, null, 2) + "\n");
    process.exit(0);
  }

  const results = [];
  for (const row of todo) {
    go(editUrl(row.id));
    await sleep(2800);
    let state = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      state = readChecked();
      if (state?.onEdit) break;
      await sleep(400);
    }
    const checkedOpts = (state?.checked || []).filter((t) => OPTION_LIKE.test(t));
    const untick = untickLabels(checkedOpts);
    await sleep(400);
    const save = clickSave();
    await sleep(2200);
    const after = readChecked();
    const afterOpts = (after?.checked || []).filter((t) => OPTION_LIKE.test(t));
    const ok = afterOpts.length === 0;
    console.log(`  unbind ${row.name} ${checkedOpts.length}→${afterOpts.length} ${ok ? "ok" : "fail"}`);
    results.push({ name: row.name, before: checkedOpts, after: afterOpts, untick, save, ok });
  }

  writeFileSync(
    LOG,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dryRun: false,
        scanned: plan.length,
        unbound: results.filter((r) => r.ok).length,
        fail: results.filter((r) => !r.ok).length,
        plan,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`OK LM topping unbind ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
