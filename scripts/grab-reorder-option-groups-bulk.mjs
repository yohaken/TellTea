#!/usr/bin/env node
/**
 * Reorder Grab OptionGroup1..N columns via bulk ZIP to match POS optionGroupIds.
 * (upsert-item ignores linkedModifierGroupIDs order.)
 *
 *   node scripts/grab-reorder-option-groups-bulk.mjs --dry-run
 *   node scripts/grab-reorder-option-groups-bulk.mjs --apply
 */
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import archiver from "archiver";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName, parseOptionGroup } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  GRAB_STORE_ID,
  clearGrabDownloads,
  downloadCurrentGrabMenuZip,
  fetchGrabMenuApi,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dir, "data/menu-price-baseline");
const OUT_CSV = join(BASE, "grab-hub-og-order-menu.csv");
const ZIP_NAME = "grab-hub-og-order.zip";
const OUT_ZIP = join(BASE, ZIP_NAME);
const LOG = join(BASE, "grab-reorder-option-groups-bulk-log.json");

const apply = process.argv.includes("--apply");
const uploadOnly = process.argv.includes("--upload-only");

function fold(s) {
  return normName(s || "");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(columns, rows) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c] ?? "")).join(","));
  }
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
  const dir = join(tmpdir(), `grab-og-order-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });
  const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".csv"));
  if (!files.length) throw new Error(`No CSV in ${zipPath}`);
  return join(dir, files[0]);
}

/** Keep Grab-only groups in their slots; reorder POS-matched cells to POS order. */
function reorderCells(cells, posGroupNames) {
  const parsed = cells.map((cell, i) => ({ i, cell, g: parseOptionGroup(cell) }));
  const live = parsed.filter((p) => p.g);
  if (live.length < 2) return { cells, changed: false };

  const posOrder = [];
  const posSet = new Set();
  for (const name of posGroupNames) {
    const hit = live.find((p) => !posSet.has(p.i) && namesEqual(p.g.groupName, name));
    if (!hit) continue;
    posSet.add(hit.i);
    posOrder.push(hit);
  }
  if (posOrder.length < 2) return { cells, changed: false };

  const out = [...cells];
  let pi = 0;
  for (const p of live) {
    if (posSet.has(p.i)) {
      if (pi < posOrder.length) {
        out[p.i] = posOrder[pi++].cell;
      }
    }
  }
  const changed = out.some((c, i) => c !== cells[i]);
  return { cells: out, changed };
}

async function loadPosByName() {
  const db = await getSeedDb();
  const [itemsSnap, groupsSnap] = await Promise.all([
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const groups = new Map();
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    groups.set(d.id, g.name || "");
  }
  const byName = new Map();
  for (const d of itemsSnap.docs) {
    const data = d.data() || {};
    if (data.active === false) continue;
    if (data.storeOnly || isStoreOnlyName(data.name || "")) continue;
    const ids = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
    byName.set(fold(data.name || ""), {
      name: data.name || "",
      optionNames: ids.map((id) => groups.get(id)).filter(Boolean),
    });
  }
  return byName;
}

async function uploadZip(zipPath) {
  const bytes = readFileSync(zipPath);
  const b64 = bytes.toString("base64");
  console.log(`inject zip ${bytes.length} bytes via Chrome (no localhost)`);
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
      return 'miss';
    })()`,
    { windowIndex },
  );
  await sleep(2500);

  const zipKey = "__ttGrabOgZipB64";
  chromeJsOnTab(tabIndex, `(() => { window[${JSON.stringify(zipKey)}] = ''; return 'ok'; })()`, {
    windowIndex,
  });
  const chunk = 24000;
  for (let i = 0; i < b64.length; i += chunk) {
    chromeJsOnTab(
      tabIndex,
      `(() => { window[${JSON.stringify(zipKey)}] += ${JSON.stringify(b64.slice(i, i + chunk))}; return window[${JSON.stringify(zipKey)}].length; })()`,
      { windowIndex },
    );
  }

  chromeJsOnTab(
    tabIndex,
    `(() => {
      window.__grabBulk = 'pending';
      (async () => {
        try {
          const b64 = window[${JSON.stringify(zipKey)}] || '';
          if (b64.length < 100) { window.__grabBulk = JSON.stringify({ err: 'short b64', len: b64.length }); return; }
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const file = new File([arr], '${ZIP_NAME}', { type: 'application/zip' });
          const input = document.querySelector('#INPUT_ID') || document.querySelector('input[type=file]');
          if (!input) { window.__grabBulk = JSON.stringify({ err: 'no input' }); return; }
          const dt = new DataTransfer();
          dt.items.add(file);
          try { input.files = dt.files; }
          catch { Object.defineProperty(input, 'files', { configurable: true, value: dt.files }); }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const zone = input.closest('[class*="FileDrag"], [class*="upload"], [class*="Upload"]') || input.parentElement;
          if (zone) {
            for (const type of ['dragenter', 'dragover', 'drop']) {
              const ev = new DragEvent(type, { bubbles: true, cancelable: true });
              Object.defineProperty(ev, 'dataTransfer', { value: dt });
              zone.dispatchEvent(ev);
            }
          }
          await new Promise((r) => setTimeout(r, 800));
          const sell = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'ลงขาย');
          window.__grabBulk = JSON.stringify({
            ok: true,
            name: input.files?.[0]?.name,
            size: input.files?.[0]?.size,
            sellDisabled: sell ? sell.disabled : null,
          });
        } catch (e) {
          window.__grabBulk = JSON.stringify({ err: String(e) });
        }
      })();
      return 'started';
    })()`,
    { windowIndex },
  );
  let inject = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const raw = chromeJsOnTab(tabIndex, `(() => window.__grabBulk || 'pending')()`, { windowIndex });
    if (raw && raw !== "pending" && raw !== "started") {
      try {
        inject = JSON.parse(raw);
      } catch {
        inject = { raw };
      }
      break;
    }
  }
  console.log("inject:", inject);
  if (!inject?.ok) throw new Error(`inject failed: ${JSON.stringify(inject)}`);
  await sleep(1000);
  const submit = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const sell = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'ลงขาย');
      if (!sell) return JSON.stringify({ err: 'no sell' });
      if (sell.disabled) return JSON.stringify({ err: 'sell disabled' });
      sell.click();
      return JSON.stringify({ clicked: true });
    })()`,
    { windowIndex },
  );
  console.log("submit:", submit);
  if (!submit?.clicked) throw new Error(`submit failed: ${JSON.stringify(submit)}`);

  let status = null;
  for (let i = 0; i < 48; i++) {
    await sleep(5000);
    chromeJsOnTab(
      tabIndex,
      `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu'; return 'ok'; })()`,
      { windowIndex },
    );
    await sleep(2000);
    status = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const rows = [...document.querySelectorAll('tr, [class*="history"], [class*="History"], li')];
        const texts = rows.map((r) => (r.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
        const top = texts[0] || '';
        const ok = /สำเร็จ|success|complete/i.test(top);
        const fail = /ล้มเหลว|fail|error/i.test(top);
        return JSON.stringify({ top: top.slice(0, 160), ok, fail, texts });
      })()`,
      { windowIndex },
    );
    console.log(`history[${i}]`, status?.top?.slice(0, 80));
    if (status?.ok || status?.fail) break;
  }
  return status;
}

async function main() {
  mkdirSync(BASE, { recursive: true });

  let changedRows = 0;
  let samples = [];

  if (uploadOnly) {
    if (!existsSync(OUT_ZIP)) throw new Error(`Missing ${OUT_ZIP} — run without --upload-only first`);
    changedRows = -1;
    console.log(`upload-only → ${OUT_ZIP}`);
  } else {
    clearGrabDownloads();
    console.log("downloading Grab catalog (ราคา + ตัวเลือกเสริม)…");
    const sourceZip = await downloadCurrentGrabMenuZip({ fields: "price+options" });
    const sourceCsv = extractCsvFromZip(sourceZip);
    const stamp = Date.now();
    copyFileSync(sourceZip, join(BASE, `grab-export-og-order-${stamp}.zip`));
    copyFileSync(sourceCsv, join(BASE, `grab-export-og-order-${stamp}.csv`));
    try {
      unlinkSync(sourceZip);
    } catch {
      /* ignore */
    }

    const posByName = await loadPosByName();
    const rows = parse(readFileSync(sourceCsv), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      relax_quotes: true,
    });
    const columns = Object.keys(rows[0] || {});
    const optionCols = columns.filter((c) => /^OptionGroup\d+$/.test(c));
    if (!optionCols.length) throw new Error("CSV has no OptionGroup columns");

    for (const row of rows) {
      if (!String(row["*ItemID"] || "").startsWith("THITE")) continue;
      const name = fold(row["*ItemName"] || row.ItemName || "");
      const pos = posByName.get(name);
      if (!pos?.optionNames?.length) continue;
      const cells = optionCols.map((c) => row[c] ?? "");
      const before = cells.map((c) => parseOptionGroup(c)?.groupName).filter(Boolean);
      const { cells: next, changed } = reorderCells(cells, pos.optionNames);
      if (!changed) continue;
      changedRows += 1;
      optionCols.forEach((c, i) => {
        row[c] = next[i] ?? "";
      });
      const after = next.map((c) => parseOptionGroup(c)?.groupName).filter(Boolean);
      if (samples.length < 12) {
        samples.push({ name: pos.name, before: before.join(" → "), after: after.join(" → ") });
      }
    }

    const csvText = rowsToCsv(columns, rows);
    writeFileSync(OUT_CSV, csvText);
    await writeZip(csvText, OUT_ZIP);
    console.log(`=== Grab OG order bulk ${apply ? "APPLY" : "DRY-RUN"} ===`);
    console.log(`changed rows ${changedRows} · option cols ${optionCols.join(",")}`);
    for (const s of samples) {
      console.log(`  ${s.name}`);
      console.log(`    ${s.before}`);
      console.log(`    → ${s.after}`);
    }
    console.log(`→ ${OUT_CSV}`);
    console.log(`→ ${OUT_ZIP}`);
  }

  let upload = null;
  if (apply || uploadOnly) {
    if (!uploadOnly && !changedRows) {
      console.log("nothing to upload");
    } else {
      upload = await uploadZip(OUT_ZIP);
      console.log("upload result", upload);
      await sleep(3000);
      const { tabIndex, windowIndex } = findGrabTab();
      const menu = fetchGrabMenuApi(tabIndex, windowIndex);
      const byId = new Map(
        (menu.modifierGroups || []).map((g) => [g.modifierGroupID, g.modifierGroupName]),
      );
      const check = ["โกปี๊ ยกล้อ (ใส่นม) (เย็น/ปั่น)", "ชาเขียวมะลิ"];
      for (const c of menu.categories || []) {
        for (const it of c.items || []) {
          if (!check.includes(it.itemName)) continue;
          console.log(
            "verify",
            it.itemName,
            (it.linkedModifierGroupIDs || []).map((id) => byId.get(id)).join(" → "),
          );
        }
      }
    }
  }

  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), apply, uploadOnly, changedRows, samples, upload }, null, 2) +
      "\n",
  );
  console.log(`→ ${LOG}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
