#!/usr/bin/env node
/**
 * Sync Grab option (ตัวเลือกเสริม) prices via bulk ZIP.
 * Always downloads a fresh catalog (ราคาและบริการ + ตัวเลือกเสริม).
 * Patches only numeric prices inside OptionGroup cells — names/ranges stay byte-identical.
 * Does not rewrite *Price. After apply: re-download → ingest → hub table.
 *
 *   node scripts/grab-hub-bulk-options.mjs --dry-run
 *   node scripts/grab-hub-bulk-options.mjs --apply
 *   node scripts/grab-hub-bulk-options.mjs --dry-run --csv=path/to/fresh.csv
 */
import { createServer } from "node:http";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parse } from "csv-parse/sync";
import archiver from "archiver";
import { getDocs, collection } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import {
  applyChannelRule,
  loadHubChannelContext,
} from "./lib/hub-channel-targets.mjs";
import { loadGrabExportCsv, namesEqual, normName, parseOptionGroup } from "./lib/grab-csv.mjs";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  GRAB_STORE_ID,
  clearGrabDownloads,
  downloadCurrentGrabMenuZip,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const BASE = join(__dir, "data/menu-price-baseline");
const OUT_CSV = join(BASE, "grab-hub-options-menu.csv");
const ZIP_NAME = `grab-hub-opt-fix.zip`;
const OUT_ZIP = join(BASE, ZIP_NAME);
const LOG = join(BASE, "grab-hub-bulk-options-log.json");
const PORT = 8768;

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

function removeIfExists(path) {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

function wipeStaleGrabFiles({ keepBase = false } = {}) {
  const removed = [];
  const cleared = clearGrabDownloads();
  removed.push(...cleared.map((n) => `Downloads/${n}`));
  if (keepBase) return removed;
  for (const name of readdirSync(BASE)) {
    if (
      name === "grab-hub-options-update.zip" ||
      name === "grab-hub-opt-price.zip" ||
      name === "grab-hub-opt-fix.zip" ||
      name === "grab-hub-options-menu.csv" ||
      name === "grab-hub-options-error-report.csv" ||
      /^grab-export-fresh/i.test(name)
    ) {
      removeIfExists(join(BASE, name));
      removed.push(name);
    }
  }
  return removed;
}

function extractCsvFromZip(zipPath) {
  const dest = join(tmpdir(), `grab-csv-${Date.now()}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", dest], { encoding: "utf8" });
  const csv = readdirSync(dest).find((n) => n.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error(`No CSV inside ${zipPath}`);
  return join(dest, csv);
}

function bestPosChoice(grabName, grabGroup, posChoices) {
  return posChoices.find((p) => namesEqual(grabName, p.name) && namesEqual(grabGroup, p.groupName)) || null;
}

/** Key for option target map — group+name (same choice name can differ by promo group). */
function optTargetKey(groupName, optionName) {
  return `${normName(groupName)}|${normName(optionName)}`;
}

/** Replace only `name:price` numbers in the original cell — keep group text identical. */
function patchOptionGroupCell(cell, priceByKey) {
  const raw = String(cell ?? "");
  const g = parseOptionGroup(raw);
  if (!g) return { cell: raw, changed: 0, skipped: 0 };
  let next = raw;
  let changed = 0;
  let skipped = 0;
  for (const o of g.options) {
    const key = optTargetKey(g.groupName, o.name);
    if (!priceByKey.has(key)) continue;
    const target = priceByKey.get(key);
    if (o.price === target) continue;
    if (o.price != null && o.price > 0) {
      const ratio = Math.abs(target - o.price) / o.price;
      if (ratio > 1) {
        skipped++;
        continue;
      }
    }
    const from = `${o.name}:${o.price}`;
    const to = `${o.name}:${target}`;
    const idx = next.indexOf(from);
    if (idx < 0) {
      skipped++;
      continue;
    }
    next = next.slice(0, idx) + to + next.slice(idx + from.length);
    changed++;
  }
  return { cell: next, changed, skipped };
}

async function loadPosChoices() {
  const db = await getSeedDb();
  const { channels, optionOverrides } = await loadHubChannelContext();
  const grabRule = channels.grab || { mode: "gp", value: 30 };
  const groupsSnap = await getDocs(collection(db, "menuOptionGroups"));
  const posChoices = [];
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    for (const c of g.options || []) {
      if (c.active === false) continue;
      const key = `${d.id}::${c.id}`;
      const override = optionOverrides?.[key]?.grab;
      const rule = override || grabRule;
      const store = Math.max(0, Number(c.priceDelta) || 0);
      posChoices.push({
        key,
        groupId: d.id,
        groupName: g.name || "",
        choiceId: c.id,
        name: c.name || "",
        priceDelta: store,
        target: applyChannelRule(store, rule),
        rule,
      });
    }
  }
  return { posChoices, grabRule };
}

function buildPlan(rows, posChoices) {
  /** @type {Map<string, number>} group|name → target */
  const priceByKey = new Map();
  /** @type {object[]} */
  const diffs = [];
  const seen = new Set();

  for (const row of rows) {
    if (!String(row["*ItemID"] || "").startsWith("THITE")) continue;
    for (let i = 1; i <= 8; i++) {
      const raw = row[`OptionGroup${i}`];
      const g = parseOptionGroup(raw);
      if (!g) continue;
      for (const o of g.options) {
        if (!o.name || o.price == null) continue;
        const pos = bestPosChoice(o.name, g.groupName, posChoices);
        if (!pos) continue;
        // Skip ambiguous zero-store matches unless group aligns and target is free (฿0).
        if (pos.priceDelta === 0 && o.price > 0) {
          const gg = normName(g.groupName);
          const pg = normName(pos.groupName);
          const groupOk = gg && pg && gg === pg;
          if (!groupOk || pos.target !== 0) continue;
        }
        if (o.price === pos.target) continue;
        const k = `${normName(g.groupName)}|${normName(o.name)}|${o.price}->${pos.target}`;
        if (!seen.has(k)) {
          seen.add(k);
          diffs.push({
            grabGroup: g.groupName,
            name: o.name,
            live: o.price,
            store: pos.priceDelta,
            target: pos.target,
            posKey: pos.key,
            posGroup: pos.groupName,
          });
        }
        priceByKey.set(optTargetKey(g.groupName, o.name), pos.target);
      }
    }
  }
  diffs.sort((a, b) => Math.abs(b.live - b.target) - Math.abs(a.live - a.target));
  return { priceByKey, diffs };
}

function startServer(bytes, fileName) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === `/${fileName}` || req.url === "/") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": bytes.length,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    server.listen(PORT, "127.0.0.1", () => resolvePromise(server));
  });
}

async function uploadZip(zipPath) {
  const fileName = ZIP_NAME;
  const bytes = readFileSync(zipPath);
  const server = await startServer(bytes, fileName);
  console.log(`Serving http://127.0.0.1:${PORT}/${fileName} (${bytes.length} bytes)`);
  try {
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

    chromeJsOnTab(
      tabIndex,
      `(() => {
        window.__grabBulk = 'pending';
        (async () => {
          try {
            const res = await fetch('http://127.0.0.1:${PORT}/${fileName}');
            if (!res.ok) { window.__grabBulk = JSON.stringify({ err: 'fetch ' + res.status }); return; }
            const buf = await res.arrayBuffer();
            const file = new File([buf], '${fileName}', { type: 'application/zip' });
            const input = document.querySelector('#INPUT_ID') || document.querySelector('input[type=file]');
            if (!input) { window.__grabBulk = JSON.stringify({ err: 'no input' }); return; }
            const dt = new DataTransfer();
            dt.items.add(file);
            try { input.files = dt.files; }
            catch {
              Object.defineProperty(input, 'files', { configurable: true, value: dt.files });
            }
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
            await new Promise((r) => setTimeout(r, 600));
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

    // poll history
    let status = null;
    for (let i = 0; i < 36; i++) {
      await sleep(5000);
      chromeJsOnTab(
        tabIndex,
        `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu'; return 'ok'; })()`,
        { windowIndex },
      );
      await sleep(3500);
      status = chromeJsJsonOnTab(
        tabIndex,
        `(() => {
          const t = document.body.innerText || '';
          const idx = t.indexOf('${ZIP_NAME}');
          const slice = idx >= 0 ? t.slice(idx, idx + 240) : '';
          const reProc = /${ZIP_NAME.replace(/\./g, "\\.")}[\\s\\S]{0,80}กำลังดำเนินการ/;
          const reOk = /${ZIP_NAME.replace(/\./g, "\\.")}[\\s\\S]{0,80}สำเร็จ/;
          return JSON.stringify({
            slice,
            processing: reProc.test(t),
            success: reOk.test(t),
          });
        })()`,
        { windowIndex },
      );
      console.log(`[poll ${i}]`, status);
      if (status?.success && !status?.processing) break;
    }
    return { inject, submit, status };
  } finally {
    server.close();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const csvArg = process.argv.find((a) => a.startsWith("--csv="));
  const csvOverride = csvArg ? csvArg.slice(6) : "";

  const wiped = wipeStaleGrabFiles({ keepBase: Boolean(csvOverride) });
  console.log(`wiped stale Grab files (${wiped.length}):`, wiped.slice(0, 12).join(", ") || "(none)");

  let sourceCsv;
  let sourceZip = null;
  if (csvOverride) {
    if (!existsSync(csvOverride)) throw new Error(`Missing ${csvOverride}`);
    sourceCsv = csvOverride;
    console.log("using provided CSV (not a fresh download):", sourceCsv);
  } else {
    console.log("downloading fresh Grab catalog (ราคา + ตัวเลือกเสริม)…");
    sourceZip = await downloadCurrentGrabMenuZip({ fields: "price+options" });
    console.log("fresh zip:", sourceZip);
    sourceCsv = extractCsvFromZip(sourceZip);
    const stamp = Date.now();
    copyFileSync(sourceZip, join(BASE, `grab-export-fresh-${stamp}.zip`));
    copyFileSync(sourceCsv, join(BASE, `grab-export-fresh-${stamp}.csv`));
    unlinkSync(sourceZip);
    console.log("copied fresh export into data/ and removed Downloads zip");
  }

  const parsed = loadGrabExportCsv(sourceCsv);
  const optionCols = Object.keys(
    parse(readFileSync(sourceCsv), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      relax_quotes: true,
    })[0] || {},
  ).filter((c) => /^OptionGroup\d+$/.test(c));
  if (!optionCols.length) {
    throw new Error("Fresh CSV has no OptionGroup columns — download did not include ตัวเลือกเสริม");
  }

  const { posChoices, grabRule } = await loadPosChoices();
  const raw = readFileSync(sourceCsv);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
  const columns = Object.keys(rows[0] || {});
  const { priceByKey, diffs } = buildPlan(rows, posChoices);

  let cellPatches = 0;
  let skippedOver100 = 0;
  for (const row of rows) {
    if (!String(row["*ItemID"] || "").startsWith("THITE")) continue;
    for (let i = 1; i <= 8; i++) {
      const key = `OptionGroup${i}`;
      if (!(key in row)) continue;
      const { cell, changed, skipped } = patchOptionGroupCell(row[key], priceByKey);
      skippedOver100 += skipped || 0;
      if (changed) {
        row[key] = cell;
        cellPatches += changed;
      }
    }
  }

  const csvText = rowsToCsv(columns, rows);
  writeFileSync(OUT_CSV, csvText);
  await writeZip(csvText, OUT_ZIP);

  console.log(`=== Grab hub bulk OPTIONS ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`src ${sourceCsv}`);
  console.log(`fresh items ${parsed.items.length} · option keys ${parsed.options.length} · cols ${optionCols.join(",")}`);
  console.log(`Grab rule`, grabRule);
  console.log(`unique option diffs ${diffs.length} · cell price patches ${cellPatches} · skip>100% ${skippedOver100}`);
  console.log("sample:", diffs.slice(0, 15));
  console.log(`→ ${OUT_CSV}`);
  console.log(`→ ${OUT_ZIP}`);

  const log = {
    at: new Date().toISOString(),
    apply,
    sourceCsv,
    grabRule,
    diffs,
    cellPatches,
    skippedOver100,
    optionCols,
  };

  if (!apply) {
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log("Dry-run only — pass --apply to upload the fresh-patched ZIP");
    return;
  }
  if (!diffs.length || !cellPatches) {
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log("Nothing to patch");
    return;
  }

  const upload = await uploadZip(OUT_ZIP);
  log.upload = upload;
  console.log("waiting for Grab to accept bulk upload…");
  await sleep(12_000);

  clearGrabDownloads();
  console.log("re-downloading Grab catalog (ราคา + ตัวเลือกเสริม) to verify…");
  const verifyZip = await downloadCurrentGrabMenuZip({ fields: "price+options" });
  const verifyCsv = extractCsvFromZip(verifyZip);
  const verifyStamp = Date.now();
  copyFileSync(verifyZip, join(BASE, `grab-export-verify-${verifyStamp}.zip`));
  copyFileSync(verifyCsv, join(BASE, `grab-export-verify-${verifyStamp}.csv`));
  unlinkSync(verifyZip);

  execSync(`node scripts/grab-ingest-export.mjs --csv=${JSON.stringify(verifyCsv)}`, {
    stdio: "inherit",
    cwd: ROOT,
  });
  execSync("node scripts/channel-scan-to-hub.mjs --channel=grab", {
    stdio: "inherit",
    cwd: ROOT,
  });

  const after = loadGrabExportCsv(verifyCsv);
  const afterOpts = new Map();
  for (const o of after.options || []) {
    afterOpts.set(optTargetKey(o.group, o.name), o.price);
  }
  let matched = 0;
  let stillOff = 0;
  for (const d of diffs) {
    const live = afterOpts.get(optTargetKey(d.grabGroup, d.name));
    d.verifyLive = live ?? null;
    if (live === d.target) matched++;
    else stillOff++;
  }
  log.verify = { matched, stillOff, csv: verifyCsv };
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`verify: ${matched}/${diffs.length} option keys at hub target · still off ${stillOff}`);
  console.log(`→ ${LOG}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message || e);
    process.exit(1);
  });
