#!/usr/bin/env node
/**
 * Rename Grab / Shopee / LINE MAN categories (หมวด / ประเภท) to POS หลังร้าน names exactly.
 * Pairing is exact name, or unique item-name votes when spelling differs.
 *
 *   node scripts/channel-rename-categories-to-pos.mjs --dry-run
 *   node scripts/channel-rename-categories-to-pos.mjs --apply --channel=all
 *   node scripts/channel-rename-categories-to-pos.mjs --apply --channel=grab
 */
import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  createWriteStream,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parse } from "csv-parse/sync";
import archiver from "archiver";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { findShopeeTab, chromeJsJsonOnTab as shopeeJs } from "./lib/shopee-chrome.mjs";
import {
  findGrabTab,
  chromeJsOnTab as grabGo,
  fetchGrabMenuApi,
  downloadCurrentGrabMenuZip,
  sleep as grabSleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";
import {
  findWongnaiTab,
  chromeJsJsonOnTab as lmJs,
  chromeJsOnTab as lmGo,
  sleep as lmSleep,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const LOG = join(DATA, "channel-rename-categories-to-pos-log.json");
const SHOPEE_SCAN = join(DATA, "shopee-live-scan.json");
const SHOPEE_CATALOGS = join(DATA, "shopee-catalogs.json");
const GRAB_PORT = 8771;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const channelArg = (args.find((a) => a.startsWith("--channel=")) || "--channel=all").slice(10);
const channels = channelArg === "all" ? ["shopee", "grab", "lineman"] : channelArg.split(",").map((s) => s.trim());

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function loadPos() {
  const db = await getSeedDb();
  const [catsSnap, itemsSnap] = await Promise.all([
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuItems")),
  ]);
  const cats = catsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => c.active !== false);
  const catName = new Map(cats.map((c) => [c.id, c.name || ""]));
  const delivery = itemsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((p) => p.active !== false && !isStoreOnlyName(p.name || "") && p.storeOnly !== true)
    .map((p) => ({ name: p.name || "", cat: catName.get(p.categoryId) || "" }));
  const posByName = new Map();
  for (const p of delivery) {
    const n = normName(p.name);
    if (n && !posByName.has(n)) posByName.set(n, p);
  }
  const posCats = [...new Set(delivery.map((p) => p.cat).filter(Boolean))];
  return { cats, posCats, posByName };
}

function pairCats(liveCats, posCats, posByName) {
  const todo = [];
  const exact = [];
  const leftover = [];
  for (const live of liveCats) {
    const name = live.name || "";
    if (!name) continue;
    if (posCats.some((p) => namesEqual(p, name))) {
      exact.push({ id: live.id, name });
      continue;
    }
    const votes = new Map();
    for (const item of live.items || []) {
      const pos = posByName.get(normName(item));
      if (!pos?.cat) continue;
      votes.set(pos.cat, (votes.get(pos.cat) || 0) + 1);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked[0] && ranked[0][1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1]) && !namesEqual(name, ranked[0][0])) {
      todo.push({
        id: live.id,
        from: name,
        to: ranked[0][0],
        n: (live.items || []).length,
        votes: Object.fromEntries(ranked),
      });
    } else leftover.push({ id: live.id, name, n: (live.items || []).length, votes: Object.fromEntries(ranked) });
  }
  return { todo, exact, leftover };
}

function fetchShopeeCatalogs() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const json = shopeeJs(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', 'https://foody.shopee.co.th/api/seller/store/dishes', false);
      x.withCredentials = true;
      x.send(null);
      const catalogs = JSON.parse(x.responseText)?.data?.catalogs || [];
      return JSON.stringify(catalogs.map((c) => ({
        id: String(c.id),
        name: c.name || '',
        n: (c.dishes || []).length,
        items: (c.dishes || []).map((d) => d.name),
      })));
    })()`,
    { windowIndex },
  );
  return Array.isArray(json) ? json : [];
}

function applyShopee(todo) {
  const { windowIndex, tabIndex } = findShopeeTab();
  const out = [];
  for (const row of todo) {
    const r = shopeeJs(
      tabIndex,
      `(() => {
        const x = new XMLHttpRequest();
        x.open('POST', ${JSON.stringify(`https://foody.shopee.co.th/api/seller/store/catalogs/${row.id}`)}, false);
        x.withCredentials = true;
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ name: ${JSON.stringify(row.to)} }));
        return JSON.stringify({ status: x.status, body: x.responseText || '' });
      })()`,
      { windowIndex },
    );
    let json = null;
    try {
      json = JSON.parse(r?.body || "");
    } catch {
      /* ignore */
    }
    const ok = r?.status === 200 && json?.code === 0;
    out.push({ ...row, status: ok ? "renamed" : "fail", msg: json?.msg || r?.body || "" });
    console.log(`${ok ? "OK" : "FAIL"} Shopee หมวด ${row.from} → ${row.to}`);
  }
  return out;
}

function patchShopeeScan(todo) {
  if (!existsSync(SHOPEE_SCAN)) return;
  const scan = JSON.parse(readFileSync(SHOPEE_SCAN, "utf8"));
  const map = new Map(todo.map((t) => [normName(t.from), t.to]));
  for (const it of scan.items || []) {
    const next = map.get(normName(it.category));
    if (next) it.category = next;
  }
  writeFileSync(SHOPEE_SCAN, JSON.stringify(scan, null, 2) + "\n");
}

function fetchGrabCats() {
  const { windowIndex, tabIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  return (menu.categories || []).map((c) => ({
    id: c.categoryID,
    name: c.categoryName || c.name || "",
    items: (c.items || []).map((it) => it.itemName),
  }));
}

function rowsToCsv(columns, rows) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c] ?? "")).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

async function writeZip(csvText, zipPath) {
  await new Promise((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(out);
    archive.append(csvText, { name: "grab-menu.csv" });
    archive.finalize();
  });
}

function extractCsvFromZip(zipPath) {
  const dest = join(tmpdir(), `grab-cat-csv-${Date.now()}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", dest], { encoding: "utf8" });
  const csv = readdirSync(dest).find((n) => n.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error(`No CSV inside ${zipPath}`);
  return join(dest, csv);
}

async function uploadGrabZip(zipPath) {
  const fileName = "grab-rename-categories-to-pos.zip";
  const bytes = readFileSync(zipPath);
  const server = await new Promise((resolvePromise) => {
    const s = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === `/${fileName}` || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": bytes.length });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    s.listen(GRAB_PORT, "127.0.0.1", () => resolvePromise(s));
  });
  try {
    const { windowIndex, tabIndex } = findGrabTab();
    grabGo(
      tabIndex,
      `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu'; return 'ok'; })()`,
      { windowIndex },
    );
    await grabSleep(3500);
    grabGo(
      tabIndex,
      `(() => {
        for (const el of document.querySelectorAll('button,span,div,a')) {
          if ((el.innerText || '').trim() === 'แก้ไขหลายรายการ') { el.click(); return 'opened'; }
        }
        return 'miss';
      })()`,
      { windowIndex },
    );
    await grabSleep(2500);
    grabGo(
      tabIndex,
      `(() => { window.__grabCatRename = 'pending'; (async () => {
        try {
          const res = await fetch('http://127.0.0.1:${GRAB_PORT}/${fileName}');
          if (!res.ok) { window.__grabCatRename = JSON.stringify({ err: 'fetch ' + res.status }); return; }
          const blob = await res.blob();
          const file = new File([blob], '${fileName}', { type: 'application/zip' });
          const input = document.querySelector('input[type="file"]');
          if (!input) { window.__grabCatRename = JSON.stringify({ err: 'no input' }); return; }
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          window.__grabCatRename = JSON.stringify({ ok: true, name: input.files[0]?.name, size: input.files[0]?.size });
        } catch (e) {
          window.__grabCatRename = JSON.stringify({ err: String(e) });
        }
      })(); return 'started'; })()`,
      { windowIndex },
    );
    let inject = null;
    for (let i = 0; i < 40; i++) {
      await grabSleep(400);
      const raw = grabGo(tabIndex, `(() => window.__grabCatRename || 'pending')()`, { windowIndex });
      if (raw && raw !== "pending" && raw !== "started") {
        try {
          inject = JSON.parse(raw);
        } catch {
          inject = { raw };
        }
        break;
      }
    }
    await grabSleep(1500);
    const submit = grabGo(
      tabIndex,
      `(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = (b.innerText || '').trim();
          if (t === 'ลงขาย' || t === 'อัปโหลด') { b.click(); return 'clicked:' + t; }
        }
        return 'no-submit';
      })()`,
      { windowIndex },
    );
    await grabSleep(8000);
    return { inject, submit };
  } finally {
    server.close();
  }
}

async function applyGrab(todo) {
  if (!todo.length) return { changes: [], upload: null };
  console.log("downloading Grab catalog for category patch…");
  const zipPath = await downloadCurrentGrabMenuZip({ fields: "categories" });
  const csvPath = extractCsvFromZip(zipPath);
  const raw = readFileSync(csvPath);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
  const columns = Object.keys(rows[0] || {});
  const catCol = columns.find((c) => /\*?CategoryName/i.test(c) || c.includes("หมวด")) || "*CategoryName";
  console.log("Grab CSV columns", columns);
  const map = new Map(todo.map((t) => [normName(t.from), t.to]));
  const changes = [];
  for (const row of rows) {
    const before = String(row[catCol] || "");
    const next = map.get(normName(before));
    if (!next || before === next) continue;
    row[catCol] = next;
    changes.push({ id: row["*ItemID"] || row.ItemID, item: row["*ItemName"] || row.ItemName, from: before, to: next });
  }
  if (!changes.length) return { changes: [], upload: null, columns };
  const csvText = rowsToCsv(columns, rows);
  const outCsv = join(DATA, "grab-rename-categories-to-pos-menu.csv");
  const outZip = join(DATA, "grab-rename-categories-to-pos.zip");
  writeFileSync(outCsv, csvText);
  await writeZip(csvText, outZip);
  console.log(`Grab patched ${changes.length} item categories → upload`);
  const upload = await uploadGrabZip(outZip);
  return { changes, upload, columns };
}

function fetchLinemanCats() {
  const { windowIndex, tabIndex } = findWongnaiTab();
  lmGo(
    tabIndex,
    `(() => { location.href='https://merchant.wongnai.com/businesses/2688343/menu-group'; return 'ok'; })()`,
    { windowIndex },
  );
  return lmSleep(2500).then(() => {
    const loc = findWongnaiTab();
    const live = lmJs(
      loc.tabIndex,
      `(() => {
        const cards = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a[href*="/menu-group/"]')) {
          const href = a.getAttribute('href') || '';
          if (/\\/create/.test(href)) continue;
          const name = (a.innerText || '').trim().split('\\n')[0].trim();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const m = href.match(/menu-group\\/([^/?]+)/);
          cards.push({ id: m ? m[1] : '', name, href });
        }
        return JSON.stringify(cards);
      })()`,
      { windowIndex: loc.windowIndex },
    );
    return Array.isArray(live) ? live.map((c) => ({ ...c, items: [] })) : [];
  });
}

async function applyLineman(todo) {
  const out = [];
  for (const row of todo) {
    const href = `https://merchant.wongnai.com/businesses/2688343/menu-group/${row.id}/edit`;
    const { windowIndex, tabIndex } = findWongnaiTab();
    lmGo(tabIndex, `(() => { location.href=${JSON.stringify(href)}; return 'ok'; })()`, { windowIndex });
    await lmSleep(2500);
    const loc = findWongnaiTab();
    const result = lmJs(
      loc.tabIndex,
      `(() => {
        const want = ${JSON.stringify(row.to)};
        const apply = ${JSON.stringify(apply)};
        const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];
        const el = inputs.find((i) => (i.value || '').trim() === ${JSON.stringify(row.from)}) || inputs[0];
        if (!el) return JSON.stringify({ status: 'no-input' });
        const before = el.value || '';
        if (before === want) return JSON.stringify({ status: 'skip', before });
        if (!apply) return JSON.stringify({ status: 'dry', before });
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        el.focus();
        setter.call(el, want);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        const btn = [...document.querySelectorAll('button')].find((b) => /บันทึก|Save/i.test((b.innerText || '').trim()));
        if (btn) btn.click();
        return JSON.stringify({ status: 'saved', before, after: el.value });
      })()`,
      { windowIndex: loc.windowIndex },
    );
    out.push({ ...row, ...(result || { status: "fail" }) });
    console.log(`${result?.status || "fail"} LINE MAN หมวด ${row.from} → ${row.to}`);
    await lmSleep(1500);
  }
  return out;
}

async function main() {
  const { posCats, posByName } = await loadPos();
  const log = { at: new Date().toISOString(), apply, channels, results: {} };

  if (channels.includes("shopee")) {
    const live = fetchShopeeCatalogs();
    const plan = pairCats(live, posCats, posByName);
    console.log(`=== Shopee หมวด ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact.length} ===`);
    for (const t of plan.todo) console.log(`  ${t.from} → ${t.to}  (n=${t.n})`);
    for (const L of plan.leftover) console.log(`  leftover ${L.name} n=${L.n}`);
    if (apply && plan.todo.length) {
      const rows = applyShopee(plan.todo);
      log.results.shopee = rows;
      patchShopeeScan(plan.todo);
    } else log.results.shopee = plan;
    const liveNow = fetchShopeeCatalogs();
    writeFileSync(SHOPEE_CATALOGS, JSON.stringify(liveNow.map(({ items, ...c }) => ({ id: c.id, name: c.name, n: items.length })), null, 2) + "\n");
  }

  if (channels.includes("grab")) {
    const live = fetchGrabCats();
    const plan = pairCats(live, posCats, posByName);
    console.log(`=== Grab หมวด ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact.length} ===`);
    for (const t of plan.todo) console.log(`  ${t.from} → ${t.to}  (n=${t.n})`);
    for (const L of plan.leftover) console.log(`  leftover ${L.name} n=${L.n}`);
    if (apply && plan.todo.length) log.results.grab = await applyGrab(plan.todo);
    else log.results.grab = plan;
  }

  if (channels.includes("lineman")) {
    const live = await fetchLinemanCats();
    const plan = pairCats(live, posCats, posByName);
    console.log(`=== LINE MAN ประเภท ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact.length} ===`);
    for (const t of plan.todo) console.log(`  ${t.from} → ${t.to}`);
    for (const L of plan.leftover) console.log(`  leftover ${L.name}`);
    if (apply && plan.todo.length) log.results.lineman = await applyLineman(plan.todo);
    else log.results.lineman = plan;
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log("wrote", LOG);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).then(() => process.exit(0));
