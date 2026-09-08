#!/usr/bin/env node
/**
 * Remove unused Shio Pan fillings (วนิลา / สตรอเบอรี่ / บลูเบอรี่ / ส้ม)
 * from POS + Shopee + Grab + LINE. Keep ไม่เพิ่ม + ช็อคโกแลต.
 *
 *   node scripts/remove-shio-pan-fillings.mjs
 */
import {
  readFileSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  copyFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import archiver from "archiver";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { findShopeeTab, chromeJsJsonOnTab } from "./lib/shopee-chrome.mjs";
import {
  findGrabTab,
  fetchGrabMenuApi,
  clearGrabDownloads,
  downloadCurrentGrabMenuZip,
  chromeJsOnTab,
  chromeJsJsonOnTab as grabJson,
  sleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";
import { parseOptionGroup, namesEqual } from "./lib/grab-csv.mjs";
import { findWongnaiTab, chromeJsOnTab as lmOn, sleep as lmSleep } from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const POS_GROUP_ID = "fs_opt_42031501";
const REMOVE_IDS = new Set(["fs_c_42718722", "fs_c_42718724", "fs_c_42718725", "fs_c_42718726"]);
const REMOVE_NAMES = ["วนิลา", "สตรอเบอรี่", "สตรอเบอรี", "บลูเบอรี่", "บลูเบอรี", "ส้ม"];
const SHOPEE_GID = "2748230794438144";
const SHOPEE_API = "https://foody.shopee.co.th/api/seller/store/option-groups";
const LOG = join(DATA, "remove-shio-pan-fillings-log.json");

function shouldRemove(name) {
  const n = String(name || "").trim();
  return REMOVE_NAMES.some((r) => namesEqual(r, n));
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
  const dir = join(tmpdir(), `grab-shio-fill-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });
  const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".csv"));
  if (!files.length) throw new Error(`No CSV in ${zipPath}`);
  return join(dir, files[0]);
}

function shopeeXhr(tabIndex, windowIndex, method, url, body) {
  const js = `(() => {
    try {
      const x = new XMLHttpRequest();
      x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader("Content-Type", "application/json");
      x.send(${body != null ? JSON.stringify(JSON.stringify(body)) : "null"});
      return JSON.stringify({ status: x.status, body: x.responseText });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  })()`;
  const raw = chromeJsJsonOnTab(tabIndex, js, { windowIndex });
  if (raw?.error) return raw;
  try {
    return { status: raw.status, json: JSON.parse(raw.body) };
  } catch {
    return { status: raw?.status, raw: String(raw?.body || "").slice(0, 2000) };
  }
}

function lmJson(tabIndex, windowIndex, code) {
  const out = lmOn(tabIndex, code, { windowIndex });
  if (!out || out === "missing value") return null;
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

async function uploadGrabZip(zipPath) {
  const bytes = readFileSync(zipPath);
  const b64 = bytes.toString("base64");
  const { windowIndex, tabIndex } = findGrabTab();
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu'; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(3500);
  chromeJsOnTab(
    tabIndex,
    `(() => {
      for (const el of document.querySelectorAll('button,span,div,a')) {
        if ((el.innerText || '').trim() === 'แก้ไขหลายรายการ') { el.click(); return 'opened'; }
      }
      return 'no-tab';
    })()`,
    { windowIndex },
  );
  await sleep(2000);
  const inject = grabJson(
    tabIndex,
    `(() => {
      const b64 = ${JSON.stringify(b64)};
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'grab-hub-og-order.zip', { type: 'application/zip' });
      const input = document.querySelector('input[type=file]');
      if (!input) return JSON.stringify({ ok: false, why: 'no-file-input' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const sellDisabled = [...document.querySelectorAll('input[type=checkbox]')].some(
        (c) => (c.parentElement?.innerText || '').includes('ปิดการขาย') && c.checked
      );
      return JSON.stringify({ ok: true, name: file.name, size: file.size, sellDisabled });
    })()`,
    { windowIndex },
  );
  await sleep(1500);
  const submit = grabJson(
    tabIndex,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => /อัปโหลด|Upload/i.test(b.innerText || '') && !b.disabled
      );
      if (!btn) return JSON.stringify({ ok: false, why: 'no-upload-btn' });
      btn.click();
      return JSON.stringify({ ok: true, clicked: true });
    })()`,
    { windowIndex },
  );
  return { inject, submit };
}

async function stepPos(db, log) {
  const ref = doc(db, "menuOptionGroups", POS_GROUP_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("POS group missing");
  const data = snap.data() || {};
  const before = (data.options || []).map((o) => o.name);
  const next = (data.options || []).filter(
    (o) => !REMOVE_IDS.has(o.id) && !shouldRemove(o.name),
  );
  await setDoc(ref, { ...data, options: next, updatedAt: Date.now() }, { merge: true });
  log.pos = { before, after: next.map((o) => o.name) };
  console.log("POS", before.join(" → "), "→", next.map((o) => o.name).join(" → "));

  const liveRef = doc(db, "menuPriceHub", "channelLive");
  const liveSnap = await getDoc(liveRef);
  const live = liveSnap.data() || {};
  const options = { ...(live.options || {}) };
  let dropped = 0;
  for (const id of REMOVE_IDS) {
    const key = `${POS_GROUP_ID}::${id}`;
    if (options[key]) {
      delete options[key];
      dropped += 1;
    }
  }
  await setDoc(liveRef, { ...live, options }, { merge: true });

  const settingsRef = doc(db, "menuPriceHub", "settings");
  const settingsSnap = await getDoc(settingsRef);
  const settings = settingsSnap.data() || {};
  const overrides = { ...(settings.optionOverrides || {}) };
  let ovDrop = 0;
  for (const id of REMOVE_IDS) {
    const key = `${POS_GROUP_ID}::${id}`;
    if (overrides[key]) {
      delete overrides[key];
      ovDrop += 1;
    }
  }
  if (ovDrop) await setDoc(settingsRef, { ...settings, optionOverrides: overrides }, { merge: true });
  log.hub = { droppedOptionKeys: dropped, droppedOverrides: ovDrop };
}

async function stepShopee(log) {
  const { windowIndex, tabIndex } = findShopeeTab();
  const get = shopeeXhr(tabIndex, windowIndex, "GET", `${SHOPEE_API}/${SHOPEE_GID}`);
  const g = get.json?.data;
  if (!g) throw new Error(`Shopee GET fail ${JSON.stringify(get).slice(0, 300)}`);
  const before = (g.options || []).map((o) => o.option_name);
  const kept = (g.options || []).filter((o) => !shouldRemove(o.option_name));
  if (kept.length === (g.options || []).length) {
    log.shopee = { skipped: true, before };
    console.log("Shopee already without target fillings");
    return;
  }
  const groupName = g.name || g.group_name || "";
  const body = {
    option_group: {
      group_id: String(g.group_id),
      name: groupName,
      group_name: groupName,
      remark: g.remark || "",
      shelve_state: g.shelve_state ? 1 : 0,
      select_min: g.select_min ?? 0,
      select_max: g.select_max ?? 0,
      select_mode: g.select_mode ?? 5,
    },
    options: kept.map((o) => ({
      id: String(o.option_id),
      name: o.option_name,
      rank: o.rank,
      price: String(o.price ?? "0"),
      available: o.available ? 1 : 0,
    })),
  };
  const put = shopeeXhr(tabIndex, windowIndex, "PUT", `${SHOPEE_API}/${SHOPEE_GID}`, body);
  await sleep(400);
  const verify = shopeeXhr(tabIndex, windowIndex, "GET", `${SHOPEE_API}/${SHOPEE_GID}`);
  const after = (verify.json?.data?.options || []).map((o) => o.option_name);
  log.shopee = {
    putStatus: put.status,
    putCode: put.json?.code,
    putMsg: put.json?.msg,
    before,
    after,
  };
  console.log("Shopee", before.join(","), "→", after.join(","), put.json?.code === 0 ? "OK" : "FAIL");
  if (put.json?.code !== 0) throw new Error(`Shopee PUT failed: ${put.json?.msg || put.status}`);
}

async function stepGrab(log) {
  clearGrabDownloads();
  console.log("Grab: download price+options CSV…");
  const sourceZip = await downloadCurrentGrabMenuZip({ fields: "price+options" });
  const sourceCsv = extractCsvFromZip(sourceZip);
  const stamp = Date.now();
  copyFileSync(sourceZip, join(DATA, `grab-export-shio-fill-${stamp}.zip`));
  copyFileSync(sourceCsv, join(DATA, `grab-export-shio-fill-${stamp}.csv`));
  try {
    unlinkSync(sourceZip);
  } catch {
    /* ignore */
  }

  const rows = parse(readFileSync(sourceCsv), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
  const columns = Object.keys(rows[0] || {});
  const optionCols = columns.filter((c) => /^OptionGroup\d+$/.test(c));
  let cellsChanged = 0;
  const samples = [];
  for (const row of rows) {
    if (!String(row["*ItemID"] || "").startsWith("THITE")) continue;
    for (const key of optionCols) {
      const g = parseOptionGroup(row[key]);
      if (!g || !/ชิโอปัง เพิ่มไส้พิเศษ/.test(g.groupName)) continue;
      const kept = g.options.filter((o) => !shouldRemove(o.name));
      if (kept.length === g.options.length) continue;
      const opts = kept.map((o) => `${o.name}:${o.price ?? 0}`).join("#");
      row[key] = `${g.groupName}##${g.range}##${opts}`;
      cellsChanged += 1;
      samples.push({
        item: row["*ItemName"],
        before: g.options.map((o) => o.name),
        after: kept.map((o) => o.name),
      });
    }
  }
  const outCsv = join(DATA, "grab-shio-fill-remove-menu.csv");
  const outZip = join(DATA, "grab-hub-og-order.zip");
  const csvText = rowsToCsv(columns, rows);
  writeFileSync(outCsv, csvText);
  await writeZip(csvText, outZip);
  console.log(`Grab cells changed ${cellsChanged}`);
  for (const s of samples) console.log(" ", s.item, s.before.join("|"), "→", s.after.join("|"));
  if (!cellsChanged) {
    log.grab = { skipped: true, samples };
    return;
  }
  const upload = await uploadGrabZip(outZip);
  console.log("Grab upload", upload);
  await sleep(5000);
  const { tabIndex, windowIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  const group = (menu.modifierGroups || []).find((g) => /ชิโอปัง เพิ่มไส้พิเศษ/.test(g.modifierGroupName || ""));
  const liveNames = (group?.modifiers || []).map((m) => m.modifierName);
  log.grab = { cellsChanged, samples, upload, liveNames };
  console.log("Grab live now:", liveNames.join(" → "));
  if (liveNames.some(shouldRemove)) throw new Error("Grab still has removed fillings");
}

async function stepLineman(log) {
  // Find edit URL from list page
  const { windowIndex, tabIndex } = findWongnaiTab();
  lmOn(
    tabIndex,
    `(() => { location.href='https://merchant.wongnai.com/businesses/2688343/menu-option'; return 'ok'; })()`,
    { windowIndex },
  );
  await lmSleep(2500);
  const listed = lmJson(
    tabIndex,
    windowIndex,
    `(() => {
      const want = 'ชิโอปัง เพิ่มไส้พิเศษ';
      const links = [...document.querySelectorAll('a')].filter(a => (a.innerText||'').includes(want));
      const href = links[0]?.href || '';
      const m = href.match(/menu-option\\/(0[a-zA-Z0-9]+)/);
      return JSON.stringify({ href, id: m && m[1], n: links.length });
    })()`,
  );
  if (!listed?.id) {
    log.lineman = { skipped: true, reason: "group-not-listed", listed };
    console.log("LINE: group not found on list — skip");
    return;
  }
  const editUrl = `https://merchant.wongnai.com/businesses/2688343/menu-option/${listed.id}/edit`;
  lmOn(tabIndex, `(() => { location.href=${JSON.stringify(editUrl)}; return 'ok'; })()`, { windowIndex });
  await lmSleep(3000);
  for (let i = 0; i < 20; i++) {
    const st = lmJson(
      tabIndex,
      windowIndex,
      `JSON.stringify({
        hasSave: !!document.querySelector('[data-testid=option-form-save-button]'),
        url: location.href
      })`,
    );
    if (st?.hasSave) break;
    await lmSleep(500);
  }

  const before = lmJson(
    tabIndex,
    windowIndex,
    `(() => {
      const tx = document.body.innerText || '';
      const names = ${JSON.stringify(REMOVE_NAMES)};
      return JSON.stringify({
        has: names.filter(n => tx.includes(n)),
        choc: tx.includes('ช็อคโกแลต'),
        none: tx.includes('ไม่เพิ่ม')
      });
    })()`,
  );
  console.log("LINE before:", before);

  const removed = [];
  for (const name of ["วนิลา", "สตรอเบอรี่", "บลูเบอรี่", "ส้ม"]) {
    const r = lmJson(
      tabIndex,
      windowIndex,
      `(() => {
        const name = ${JSON.stringify(name)};
        let row = null;
        for (const el of document.querySelectorAll('div')) {
          const tx = (el.innerText || '').trim();
          if (!tx.startsWith(name)) continue;
          if (!tx.includes('+฿') && !tx.includes('฿') && !/งดขาย|มีจำหน่าย/.test(tx)) continue;
          if (tx.length > Math.max(160, name.length + 100)) continue;
          row = el;
          break;
        }
        if (!row) return JSON.stringify({ ok: false, reason: 'no-row' });
        const btns = [...row.querySelectorAll('button')];
        const xBtn = btns[btns.length - 1];
        if (!xBtn) return JSON.stringify({ ok: false, reason: 'no-x' });
        xBtn.click();
        return JSON.stringify({ ok: true, btnCount: btns.length });
      })()`,
    );
    removed.push({ name, ...r });
    await lmSleep(400);
  }

  const save = lmJson(
    tabIndex,
    windowIndex,
    `(() => {
      const btn = document.querySelector('[data-testid=option-form-save-button]');
      if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
      btn.click();
      return JSON.stringify({ ok: true });
    })()`,
  );
  await lmSleep(2500);
  const after = lmJson(
    tabIndex,
    windowIndex,
    `(() => {
      const tx = document.body.innerText || '';
      const names = ${JSON.stringify(["วนิลา", "สตรอเบอรี่", "บลูเบอรี่", "ส้ม"])};
      return JSON.stringify({ left: names.filter(n => tx.includes(n)), choc: tx.includes('ช็อคโกแลต') });
    })()`,
  );
  log.lineman = { listed, before, removed, save, after };
  console.log("LINE after:", after);
}

async function main() {
  const log = { at: new Date().toISOString() };
  const db = await getSeedDb();
  console.log("=== 1) POS ===");
  await stepPos(db, log);
  console.log("=== 2) Shopee ===");
  try {
    await stepShopee(log);
  } catch (e) {
    log.shopee = { error: String(e.message || e) };
    console.warn("Shopee blocked:", e.message || e);
  }
  console.log("=== 3) Grab ===");
  try {
    await stepGrab(log);
  } catch (e) {
    log.grab = { error: String(e.message || e) };
    console.warn("Grab blocked:", e.message || e);
  }
  console.log("=== 4) LINE ===");
  try {
    await stepLineman(log);
  } catch (e) {
    log.lineman = { error: String(e.message || e) };
    console.warn("LINE warn:", e.message || e);
  }
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log("→", LOG);
  console.log("DONE");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
