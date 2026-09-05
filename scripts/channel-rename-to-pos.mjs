#!/usr/bin/env node
/**
 * Rename Grab / Shopee / LINE MAN item names to match POS storefront names exactly.
 *
 *   node scripts/channel-rename-to-pos.mjs --dry-run
 *   node scripts/channel-rename-to-pos.mjs --apply --channel=all --workers=4
 *   node scripts/channel-rename-to-pos.mjs --apply --channel=lineman --workers=4
 */
import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  createWriteStream,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parse } from "csv-parse/sync";
import archiver from "archiver";
import { loadHubChannelContext } from "./lib/hub-channel-targets.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { namesEqual } from "./lib/grab-csv.mjs";
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";
import {
  findShopeeTab,
  chromeJsJsonOnTab as shopeeJs,
  chromeJsOnTab as shopeeGo,
} from "./lib/shopee-chrome.mjs";
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
  listWongnaiMenuItems,
  openEditItem,
  saveNameAndRead,
  mapPool,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const SHOPEE_SCAN = join(DATA, "shopee-live-scan.json");
const GRAB_SCAN = join(DATA, "grab-live-scan.json");
const LM_SCAN = join(DATA, "lineman-live-scan.json");
const LOG = join(DATA, "channel-rename-to-pos-log.json");
const GRAB_PORT = 8768;
const MICROS = 100_000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const channelArg = (args.find((a) => a.startsWith("--channel=")) || "--channel=all").slice(10);
const workers = Math.min(6, Math.max(1, Number((args.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 4));
const limit = Math.max(0, Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0);
const channels = channelArg === "all" ? ["shopee", "grab", "lineman"] : channelArg.split(",").map((s) => s.trim());

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pairLiveToPos(liveItems, posItems, { idKey }) {
  const delivery = posItems.filter((p) => p.active !== false && !p.storeOnly && !isStoreOnlyName(p.name || ""));
  const used = new Set();
  const todo = [];
  const exact = [];
  const unmatched = [];
  for (const live of liveItems || []) {
    const name = String(live.name || "");
    const id = String(live[idKey] || live.id || "");
    if (!name || /^ลบไม่ได้/.test(name)) continue;
    let pos = delivery.find((p) => !used.has(p.id) && namesEqual(p.name, name));
    if (!pos) {
      unmatched.push({ id, name });
      continue;
    }
    used.add(pos.id);
    if (name === pos.name) exact.push({ id, name, posId: pos.id });
    else
      todo.push({
        id,
        from: name,
        to: pos.name,
        posId: pos.id,
        category: live.category || "",
        href: live.href || "",
        price: Number(live.listPrice ?? live.price) || null,
      });
  }
  return { todo, exact: exact.length, unmatched };
}

async function applyShopee(todo) {
  const { windowIndex, tabIndex } = findShopeeTab();
  shopeeGo(
    tabIndex,
    `(() => { if (!/menu-management/.test(location.href)) location.href='https://partner.shopee.co.th/shopee-pos/menu-management?storeId=10212109&defaultTab=sf'; return 'ok'; })()`,
    { windowIndex },
  );
  await new Promise((r) => setTimeout(r, 2000));
  const payload = JSON.stringify(todo.map((t) => ({ dishId: t.id, to: t.to, posId: t.posId })));
  const raw = shopeeJs(
    tabIndex,
    `(() => {
      const rows = ${payload};
      const xhr = (method, url, body) => {
        const x = new XMLHttpRequest();
        x.open(method, url, false);
        x.withCredentials = true;
        if (body != null) x.setRequestHeader('Content-Type','application/json');
        x.send(body == null ? null : JSON.stringify(body));
        let json = null;
        try { json = JSON.parse(x.responseText); } catch {}
        return { status: x.status, code: json?.code, msg: json?.msg, json };
      };
      const out = [];
      for (const row of rows) {
        const got = xhr('GET', 'https://foody.shopee.co.th/api/seller/store/dishes/' + row.dishId, null);
        const dish = got.json?.data?.dish;
        if (!dish) { out.push({ ...row, status: 'missing' }); continue; }
        if (dish.name === row.to) { out.push({ ...row, status: 'skip', before: dish.name }); continue; }
        const listPrice = Number(dish.list_price || dish.price || 0);
        const put = xhr('POST', 'https://foody.shopee.co.th/api/seller/store/dishes/' + row.dishId, {
          dish: { ...dish, name: row.to, list_price: listPrice, price: String(dish.price || listPrice) },
        });
        out.push({
          ...row,
          status: put.code === 0 ? 'renamed' : 'fail',
          before: dish.name,
          msg: put.msg || '',
        });
      }
      return JSON.stringify(out);
    })()`,
    { windowIndex },
  );
  return Array.isArray(raw) ? raw : [];
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

async function extractCsvFromZip(zipPath) {
  const dest = join(tmpdir(), `grab-rename-csv-${Date.now()}`);
  mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", dest], { encoding: "utf8" });
  const csv = readdirSync(dest).find((n) => n.toLowerCase().endsWith(".csv"));
  if (!csv) throw new Error(`No CSV inside ${zipPath}`);
  return join(dest, csv);
}

async function uploadGrabZip(zipPath) {
  const fileName = "grab-rename-to-pos.zip";
  const bytes = readFileSync(zipPath);
  const server = await new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === `/${fileName}` || req.url === "/") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": bytes.length,
        });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    server.listen(GRAB_PORT, "127.0.0.1", () => resolvePromise(server));
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
      `(() => { window.__grabRename = 'pending'; (async () => {
        try {
          const res = await fetch('http://127.0.0.1:${GRAB_PORT}/${fileName}');
          if (!res.ok) { window.__grabRename = JSON.stringify({ err: 'fetch ' + res.status }); return; }
          const blob = await res.blob();
          const file = new File([blob], '${fileName}', { type: 'application/zip' });
          const input = document.querySelector('input[type="file"]');
          if (!input) { window.__grabRename = JSON.stringify({ err: 'no input' }); return; }
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          window.__grabRename = JSON.stringify({ ok: true, name: input.files[0]?.name, size: input.files[0]?.size });
        } catch (e) {
          window.__grabRename = JSON.stringify({ err: String(e) });
        }
      })(); return 'started'; })()`,
      { windowIndex },
    );
    let inject = null;
    for (let i = 0; i < 40; i++) {
      await grabSleep(400);
      const raw = grabGo(tabIndex, `(() => window.__grabRename || 'pending')()`, { windowIndex });
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
  console.log("downloading Grab catalog for name patch…");
  const zipPath = await downloadCurrentGrabMenuZip();
  const csvPath = await extractCsvFromZip(zipPath);
  copyFileSync(csvPath, join(DATA, `grab-rename-source-${Date.now()}.csv`));
  try {
    unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  const byId = new Map(todo.map((t) => [t.id, t]));
  const raw = readFileSync(csvPath);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
  const columns = Object.keys(rows[0] || {});
  const changes = [];
  for (const row of rows) {
    const id = String(row["*ItemID"] || "").trim();
    const t = byId.get(id);
    if (!t) continue;
    const before = String(row["*ItemName"] || "");
    if (before === t.to) continue;
    row["*ItemName"] = t.to;
    changes.push({ ...t, before, status: "patched" });
  }
  if (!changes.length) return { changes: [], upload: null };
  const csvText = rowsToCsv(columns, rows);
  const outCsv = join(DATA, "grab-rename-to-pos-menu.csv");
  const outZip = join(DATA, "grab-rename-to-pos.zip");
  writeFileSync(outCsv, csvText);
  await writeZip(csvText, outZip);
  console.log(`Grab patched ${changes.length} names → upload`);
  const upload = await uploadGrabZip(outZip);
  return { changes, upload };
}

async function applyLineman(todo) {
  const results = [];
  await mapPool(todo, workers, async (tabIndex, item, i, windowIndex) => {
    const page = await openEditItem(tabIndex, item.id, item.from, windowIndex, item.href);
    if (!page?.onEdit) {
      const r = { ...item, status: "error", error: "edit page not open" };
      results[i] = r;
      console.log(`[LM ${i + 1}/${todo.length}] error ${item.from}`);
      return r;
    }
    if (page.name === item.to) {
      const r = { ...item, status: "skip", before: page.name };
      results[i] = r;
      console.log(`[LM ${i + 1}/${todo.length}] skip ${item.to}`);
      return r;
    }
    if (!apply) {
      const r = { ...item, status: "dry-run", before: page.name };
      results[i] = r;
      console.log(`[LM ${i + 1}/${todo.length}] dry-run ${page.name} → ${item.to}`);
      return r;
    }
    const saved = await saveNameAndRead(tabIndex, item.to, true, windowIndex);
    const after = saved?.afterName || "";
    const ok = after === item.to;
    const r = {
      ...item,
      status: saved?.specialNameBlock ? "blocked_special_char" : ok ? "renamed" : saved?.blocked ? "blocked" : "verify_fail",
      before: saved?.before || page.name,
      after,
      popup: saved?.popupText || "",
    };
    results[i] = r;
    console.log(`[LM ${i + 1}/${todo.length}] ${r.status}: ${r.before} → ${item.to}`);
    return r;
  });
  return results.filter(Boolean);
}

async function patchScan(channel, results) {
  const path = channel === "shopee" ? SHOPEE_SCAN : channel === "grab" ? GRAB_SCAN : LM_SCAN;
  const idKey = channel === "shopee" ? "dishId" : channel === "grab" ? "itemId" : "id";
  if (!existsSync(path)) return;
  const scan = JSON.parse(readFileSync(path, "utf8"));
  const byId = new Map((scan.items || []).map((it) => [String(it[idKey] || it.id), it]));
  for (const r of results) {
    if (r.status !== "renamed" && r.status !== "skip" && r.status !== "patched") continue;
    const it = byId.get(String(r.id || r.dishId));
    if (it) it.name = r.to;
  }
  scan.scannedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(scan, null, 2) + "\n");
}

async function writeHubNames(results) {
  for (const r of results) {
    if (!r.posId) continue;
    if (r.status !== "renamed" && r.status !== "skip" && r.status !== "patched") continue;
    const price = Number(r.price);
    await writeHubChannelLiveRow({
      posId: r.posId,
      channel: r.channel,
      name: r.to,
      price: Number.isFinite(price) ? price : null,
      scannedAt: new Date().toISOString(),
      externalId: String(r.id || r.dishId || ""),
      source: "rename",
    }).catch(() => false);
  }
}

async function main() {
  const { items } = await loadHubChannelContext();
  const log = { at: new Date().toISOString(), apply, channels, results: {} };

  if (channels.includes("shopee")) {
    const scan = existsSync(SHOPEE_SCAN) ? JSON.parse(readFileSync(SHOPEE_SCAN, "utf8")) : { items: [] };
    const plan = pairLiveToPos(scan.items || [], items, { idKey: "dishId" });
    if (limit) plan.todo = plan.todo.slice(0, limit);
    console.log(`=== Shopee names ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact} · unmatched ${plan.unmatched.length} ===`);
    for (const t of plan.todo.slice(0, 12)) console.log(`  ${t.from} → ${t.to}`);
    if (apply && plan.todo.length) {
      const rows = await applyShopee(plan.todo);
      rows.forEach((r) => {
        r.channel = "shopee";
      });
      log.results.shopee = rows;
      await patchScan("shopee", rows);
      await writeHubNames(rows.map((r) => ({ ...r, channel: "shopee", id: r.dishId || r.id, price: r.price })));
      const n = rows.filter((r) => r.status === "renamed").length;
      const f = rows.filter((r) => r.status === "fail").length;
      console.log(`Shopee renamed ${n} · fail ${f}`);
    } else {
      log.results.shopee = { todo: plan.todo, exact: plan.exact };
    }
  }

  if (channels.includes("grab")) {
    const scan = existsSync(GRAB_SCAN) ? JSON.parse(readFileSync(GRAB_SCAN, "utf8")) : { items: [] };
    let liveItems = scan.items || [];
    try {
      const { windowIndex, tabIndex } = findGrabTab();
      const menu = fetchGrabMenuApi(tabIndex, windowIndex);
      const apiItems = [];
      for (const c of menu.categories || []) {
        for (const it of c.items || []) {
          apiItems.push({ name: it.itemName, itemId: it.itemID, category: c.categoryName });
        }
      }
      if (apiItems.length) liveItems = apiItems;
    } catch (e) {
      console.warn("Grab API names fallback to scan:", e.message);
    }
    const plan = pairLiveToPos(liveItems, items, { idKey: "itemId" });
    if (limit) plan.todo = plan.todo.slice(0, limit);
    console.log(`=== Grab names ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact} · unmatched ${plan.unmatched.length} ===`);
    for (const t of plan.todo.slice(0, 12)) console.log(`  ${t.from} → ${t.to}`);
    if (apply && plan.todo.length) {
      const { changes, upload } = await applyGrab(plan.todo);
      changes.forEach((r) => {
        r.channel = "grab";
        r.status = "renamed";
      });
      log.results.grab = { changes, upload };
      await patchScan("grab", changes);
      await writeHubNames(changes.map((r) => ({ ...r, channel: "grab" })));
      console.log(`Grab renamed ${changes.length}`);
    } else {
      log.results.grab = { todo: plan.todo, exact: plan.exact };
    }
  }

  if (channels.includes("lineman")) {
    let liveItems = existsSync(LM_SCAN) ? JSON.parse(readFileSync(LM_SCAN, "utf8")).items || [] : [];
    try {
      const gql = await listWongnaiMenuItems();
      if (gql.length) liveItems = gql;
    } catch (e) {
      console.warn("LINE MAN graphql fallback to scan:", e.message);
    }
    const plan = pairLiveToPos(liveItems, items, { idKey: "id" });
    if (limit) plan.todo = plan.todo.slice(0, limit);
    console.log(`=== LINE MAN names ${apply ? "APPLY" : "DRY-RUN"} · todo ${plan.todo.length} · exact ${plan.exact} · unmatched ${plan.unmatched.length} ===`);
    for (const t of plan.todo.slice(0, 12)) console.log(`  ${t.from} → ${t.to}`);
    if (plan.todo.length) {
      const rows = apply ? await applyLineman(plan.todo) : plan.todo.map((t) => ({ ...t, status: "dry-run" }));
      rows.forEach((r) => {
        r.channel = "lineman";
      });
      log.results.lineman = rows;
      if (apply) {
        await patchScan("lineman", rows);
        await writeHubNames(rows);
        const n = rows.filter((r) => r.status === "renamed").length;
        const b = rows.filter((r) => String(r.status).startsWith("blocked")).length;
        console.log(`LINE MAN renamed ${n} · blocked ${b}`);
      }
    } else {
      log.results.lineman = { todo: [], exact: plan.exact };
    }
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`→ ${LOG}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message || e);
    process.exit(1);
  });
