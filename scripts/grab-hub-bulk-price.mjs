#!/usr/bin/env node
/**
 * Sync Grab item prices via bulk ZIP.
 * Always downloads a fresh Grab catalog first (deletes old Downloads zips).
 * Patches only *Price — OptionGroup cells stay byte-identical so no new THMOG groups.
 * After apply: download again → ingest → hub table.
 *
 *   node scripts/grab-hub-bulk-price.mjs --dry-run
 *   node scripts/grab-hub-bulk-price.mjs --apply
 *   node scripts/grab-hub-bulk-price.mjs --apply --note="update price"
 *   node scripts/grab-hub-bulk-price.mjs --dry-run --csv=path/to/fresh.csv
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
import { buildGrabHubPlan } from "./lib/hub-channel-targets.mjs";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  GRAB_STORE_ID,
  clearGrabDownloads,
  downloadCurrentGrabMenuZip,
} from "./lib/grab-chrome.mjs";
import { loadGrabExportCsv } from "./lib/grab-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const BASE = join(__dir, "data/menu-price-baseline");
const SCAN = join(BASE, "grab-live-scan.json");
const TRACKER = join(BASE, "grab-price-tracker.json");
const OUT_CSV = join(BASE, "grab-hub-price-menu.csv");
const OUT_ZIP = join(BASE, "grab-hub-price-update.zip");
const LOG = join(BASE, "grab-hub-bulk-price-log.json");
const PORT = 8767;

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

function loadTracker() {
  if (!existsSync(TRACKER)) return { round: 0, items: {} };
  try {
    return JSON.parse(readFileSync(TRACKER, "utf8"));
  } catch {
    return { round: 0, items: {} };
  }
}

function removeIfExists(path) {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive: true, force: true });
  return true;
}

function wipeStaleGrabFiles() {
  const removed = [];
  const cleared = clearGrabDownloads();
  removed.push(...cleared.map((n) => `Downloads/${n}`));
  for (const name of readdirSync(BASE)) {
    if (
      name === "grab-hub-price-update.zip" ||
      name === "grab-hub-price-menu.csv" ||
      name === "grab-hub-price-error-report.csv" ||
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

async function buildTargetMap(scanItems, { noteFilter = "" } = {}) {
  const forced = { items: {} };
  for (const it of scanItems || []) {
    if (!it.itemId) continue;
    forced.items[it.itemId] = { currentLive: -999999, rounds: [] };
  }
  const allDiff = await buildGrabHubPlan(scanItems || [], {
    tracker: forced,
    retryBlocked: true,
    noteFilter,
    includeAtTarget: true,
  });
  const byId = new Map();
  for (const t of allDiff.todo) {
    if (t.itemId) byId.set(String(t.itemId), t);
  }
  return { byId, meta: allDiff.meta, count: byId.size };
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
  const fileName = "grab-hub-price-update.zip";
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

    const inject = chromeJsJsonOnTab(
      tabIndex,
      `(async () => {
        try {
          const res = await fetch('http://127.0.0.1:${PORT}/${fileName}');
          if (!res.ok) return { err: 'fetch ' + res.status };
          const blob = await res.blob();
          const file = new File([blob], '${fileName}', { type: 'application/zip' });
          const input =
            document.querySelector('input[type=file]') ||
            document.querySelector('input[accept*="zip"]') ||
            document.querySelector('input[accept*=".zip"]');
          if (!input) {
            return { err: 'no input', sample: (document.body.innerText || '').slice(0, 400) };
          }
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const zone =
            document.querySelector('[class*="upload"]') ||
            document.querySelector('[class*="Upload"]') ||
            input.closest('div') ||
            input.parentElement;
          if (zone) {
            for (const type of ['dragenter', 'dragover', 'drop']) {
              const ev = new DragEvent(type, { bubbles: true, cancelable: true });
              Object.defineProperty(ev, 'dataTransfer', { value: dt });
              zone.dispatchEvent(ev);
            }
          }
          return {
            ok: true,
            name: input.files[0]?.name,
            size: input.files[0]?.size,
            accept: input.accept || '',
          };
        } catch (e) {
          return { err: String(e) };
        }
      })()`,
      { windowIndex },
    );
    // chromeJsJsonOnTab may not await async IIFE — poll
    let result = inject;
    if (!result || result === "pending" || typeof result.then === "function") {
      chromeJsOnTab(
        tabIndex,
        `(() => { window.__grabBulk = 'pending'; (async () => {
          try {
            const res = await fetch('http://127.0.0.1:${PORT}/${fileName}');
            if (!res.ok) { window.__grabBulk = JSON.stringify({ err: 'fetch ' + res.status }); return; }
            const blob = await res.blob();
            const file = new File([blob], '${fileName}', { type: 'application/zip' });
            const input = document.querySelector('input[type=file]');
            if (!input) { window.__grabBulk = JSON.stringify({ err: 'no input' }); return; }
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            window.__grabBulk = JSON.stringify({ ok: true, name: input.files[0]?.name, size: input.files[0]?.size });
          } catch (e) {
            window.__grabBulk = JSON.stringify({ err: String(e) });
          }
        })(); return 'started'; })()`,
        { windowIndex },
      );
      for (let i = 0; i < 40; i++) {
        await sleep(400);
        const raw = chromeJsOnTab(tabIndex, `(() => window.__grabBulk || 'pending')()`, { windowIndex });
        if (raw && raw !== "pending" && raw !== "started") {
          try {
            result = JSON.parse(raw);
          } catch {
            result = { raw };
          }
          break;
        }
      }
    }
    console.log("inject:", result);

    await sleep(2000);
    const ui = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const t = document.body.innerText || '';
        return {
          hasFileName: t.includes('grab-hub-price-update') || t.includes('.zip'),
          hasลงขาย: [...document.querySelectorAll('button')].some(b => (b.innerText||'').trim() === 'ลงขาย'),
          sample: t.slice(0, 800),
        };
      })()`,
      { windowIndex },
    );
    console.log("ui:", ui);

    const submit = chromeJsOnTab(
      tabIndex,
      `(() => {
        for (const label of ['ลงขาย', 'อัปโหลด', 'ยืนยัน', 'Submit', 'Upload']) {
          for (const b of document.querySelectorAll('button')) {
            if ((b.innerText || '').trim() === label && !b.disabled) {
              b.click();
              return 'clicked:' + label;
            }
          }
        }
        return 'no-submit';
      })()`,
      { windowIndex },
    );
    console.log("submit:", submit);

    await sleep(6000);
    const after = chromeJsJsonOnTab(
      tabIndex,
      `(() => ({
        url: location.href,
        sample: (document.body.innerText || '').slice(0, 1800),
      }))()`,
      { windowIndex },
    );
    console.log("after:", JSON.stringify(after).slice(0, 1200));
    return { inject: result, submit, after };
  } finally {
    server.close();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const noteArg = process.argv.find((a) => a.startsWith("--note="));
  const noteFilter = noteArg ? noteArg.slice(7) : "";
  const csvArg = process.argv.find((a) => a.startsWith("--csv="));
  const csvOverride = csvArg ? csvArg.slice(6) : "";

  const wiped = wipeStaleGrabFiles();
  console.log(`wiped stale Grab files (${wiped.length}):`, wiped.slice(0, 12).join(", ") || "(none)");

  let sourceCsv;
  let sourceZip = null;
  if (csvOverride) {
    if (!existsSync(csvOverride)) throw new Error(`Missing ${csvOverride}`);
    sourceCsv = csvOverride;
    console.log("using provided CSV (not a fresh download):", sourceCsv);
  } else {
    console.log("downloading fresh Grab catalog…");
    sourceZip = await downloadCurrentGrabMenuZip();
    console.log("fresh zip:", sourceZip);
    sourceCsv = extractCsvFromZip(sourceZip);
    const stamp = Date.now();
    copyFileSync(sourceZip, join(BASE, `grab-export-fresh-${stamp}.zip`));
    copyFileSync(sourceCsv, join(BASE, `grab-export-fresh-${stamp}.csv`));
    unlinkSync(sourceZip);
    console.log("copied fresh export into data/ and removed Downloads zip");
  }

  const parsed = loadGrabExportCsv(sourceCsv);
  const { byId, meta, count } = await buildTargetMap(parsed.items, { noteFilter });

  const raw = readFileSync(sourceCsv);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
  const columns = Object.keys(rows[0] || {});
  let patched = 0;
  let skipped = 0;
  const changes = [];

  for (const row of rows) {
    const id = String(row["*ItemID"] || "").trim();
    if (!id.startsWith("THITE")) continue;
    const t = byId.get(id);
    if (!t) {
      skipped++;
      continue;
    }
    const before = Number(String(row["*Price"] || "").replace(/[^\d.-]/g, ""));
    const target = Number(t.target);
    if (!Number.isFinite(target)) continue;
    if (before === target) continue;
    row["*Price"] = String(target);
    patched++;
    changes.push({
      itemId: id,
      name: row["*ItemName"] || t.name,
      before,
      target,
      posId: t.posId || null,
      posName: t.posName || null,
      hubNote: t.hubNote || "",
    });
  }

  const csvText = rowsToCsv(columns, rows);
  writeFileSync(OUT_CSV, csvText);
  await writeZip(csvText, OUT_ZIP);

  console.log(`=== Grab hub bulk price ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(
    `fresh items ${parsed.items.length} · hub targets ${count} · patched ${patched} · csv-skip ${skipped}${
      noteFilter ? ` · note «${noteFilter}»` : ""
    }`,
  );
  console.log(`meta`, meta);
  console.log(`→ ${OUT_CSV}`);
  console.log(`→ ${OUT_ZIP}`);
  console.log("sample changes:", changes.slice(0, 12));

  const log = {
    at: new Date().toISOString(),
    apply,
    noteFilter,
    sourceCsv,
    patched,
    skipped,
    meta,
    changes,
  };

  if (!apply) {
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log("Dry-run only — pass --apply to upload the fresh-patched ZIP");
    return;
  }

  if (!patched) {
    console.log("Nothing to patch — fresh export already at hub targets");
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    return;
  }

  const upload = await uploadZip(OUT_ZIP);
  log.upload = upload;
  console.log("waiting for Grab to accept bulk upload…");
  await sleep(12_000);

  clearGrabDownloads();
  console.log("re-downloading Grab catalog to verify…");
  const verifyZip = await downloadCurrentGrabMenuZip();
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
  const byAfter = new Map(after.items.map((it) => [it.itemId, it.listPrice]));
  let matched = 0;
  let stillOff = 0;
  for (const c of changes) {
    const live = byAfter.get(c.itemId);
    c.verifyLive = live ?? null;
    if (live === c.target) matched++;
    else stillOff++;
  }
  log.verify = { matched, stillOff, csv: verifyCsv };
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`verify: ${matched}/${changes.length} now at hub target · still off ${stillOff}`);
  console.log(`→ ${LOG}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
