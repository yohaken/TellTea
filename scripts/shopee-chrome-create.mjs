#!/usr/bin/env node
/**
 * Create missing Shopee dishes from POS. Clone catalog + photo from a
 * same-category sibling already on Shopee; bind POS option groups that
 * already exist (do not create new groups).
 *
 *   node scripts/shopee-chrome-create.mjs --dry-run
 *   node scripts/shopee-chrome-create.mjs --apply --limit=1
 *   node scripts/shopee-chrome-create.mjs --apply --exclude=อู่หลง --limit=16
 *
 * Option bind: always edit-page UI tick + บันทึก (PUT option_group_ids does not persist).
 * After save, require live option_group_count === POS group count.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { applyChannelRule } from "./lib/hub-channel-targets.mjs";
import { writeHubChannelLiveRow, writeMenuItemHubNote } from "./lib/hub-live-write.mjs";
import {
  findShopeeTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  editUrl,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const SCAN = join(DATA, "shopee-live-scan.json");
const PLAN = join(DATA, "shopee-create-plan.json");
const LOG = join(DATA, "shopee-create-log.json");
const API = "https://foody.shopee.co.th/api/seller/store/dishes";
const MICROS = 100_000;
const STORE_QS = "storeId=10212109&defaultTab=sf";
const CREATE_URL = `https://partner.shopee.co.th/shopee-pos/menu-management/dish/create?${STORE_QS}`;
const LIST_URL = `https://partner.shopee.co.th/shopee-pos/menu-management?${STORE_QS}`;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply || args.includes("--dry-run");
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();
const exclude = (args.find((a) => a.startsWith("--exclude=")) || "").slice(10).trim();
const preferFile = (args.find((a) => a.startsWith("--prefer=")) || "").slice(9).trim();

const QUOTA_RE =
  /limit|quota|สูงสุด|เต็ม|ไม่สามารถสร้าง|exceed|too many|จำนวน.*(เต็ม|สูงสุด)|reach|maximum/i;

function fold(s) {
  return normName(s)
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง")
    .replace(/\u00a0/g, " ");
}

function modeKey(item) {
  const n = item.name || "";
  if (item.categoryName === "ทัอปปิ้ง" || item.categoryName === "ท็อปปิ้ง") return "topping";
  if (/ร้อน/.test(n) && !/เย็น/.test(n)) return "hot";
  if (/มะนาว/.test(n)) return "lime";
  if (/เย็น\/ปั่น|\(เย็น\/ปั่น\)/.test(n)) return "iced-blend";
  if (/เย็น|ปั่น|16\s*ออนซ์/.test(n)) return "cold";
  return "other";
}

function micros(baht) {
  return Math.max(0, Math.round(Number(baht) || 0)) * MICROS;
}

function bahtFromMicros(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n >= 1000) return Math.round(n / MICROS);
  return Math.round(n);
}

function tab() {
  return findShopeeTab();
}

function js(code) {
  const { windowIndex, tabIndex } = tab();
  return chromeJsJsonOnTab(tabIndex, code, { windowIndex });
}

function go(url) {
  const { windowIndex, tabIndex } = tab();
  return chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`,
    { windowIndex },
  );
}

function xhr(method, url, body) {
  return js(`(() => {
    const here = location.href;
    if (!here.includes('partner.shopee') && !here.includes('foody.shopee')) {
      return JSON.stringify({ error: 'wrong-tab', url: here });
    }
    try {
      const x = new XMLHttpRequest();
      x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(${body != null ? JSON.stringify(JSON.stringify(body)) : "null"});
      return JSON.stringify({ status: x.status, body: x.responseText });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  })()`);
}

function xhrJson(method, url, body) {
  const raw = xhr(method, url, body);
  if (raw?.error) return raw;
  try {
    return { status: raw.status, json: JSON.parse(raw.body) };
  } catch {
    return { status: raw?.status, raw: String(raw?.body || "").slice(0, 2000) };
  }
}

function ensureShopeeTab() {
  const st = js(`JSON.stringify({ url: location.href })`);
  const url = String(st?.url || "");
  if (!url.includes("partner.shopee") && !url.includes("foody.shopee")) {
    throw new Error("Chrome tab is not Shopee Partner: " + url);
  }
}

async function loadContext() {
  const db = await getSeedDb();
  const [settingsSnap, itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const shopeeRule = settings.channels?.shopee || { mode: "gp", value: 22 };
  const cats = new Map();
  for (const d of catsSnap.docs) cats.set(d.id, d.data()?.name || d.id);
  const groups = new Map();
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    groups.set(d.id, { id: d.id, name: g.name || "", active: g.active !== false });
  }
  const items = itemsSnap.docs.map((d) => {
    const data = d.data() || {};
    const categoryName = cats.get(data.categoryId) || "";
    const optionGroupIds = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
    return {
      id: d.id,
      name: data.name || "",
      nameEn: data.nameEn || "",
      price: Number(data.price) || 0,
      active: data.active !== false,
      storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
      categoryId: data.categoryId || "",
      categoryName,
      optionGroupIds,
      optionNames: optionGroupIds.map((id) => groups.get(id)?.name).filter(Boolean),
      imageUrl: data.imageUrl || "",
      description: data.description || "",
      hubNote: data.hubNote || "",
    };
  });
  if (!existsSync(SCAN)) throw new Error("Missing shopee-live-scan.json");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const live = xhrJson("GET", API, null);
  const catalogs = live.json?.data?.catalogs || [];
  const shopeeItems = [];
  for (const c of catalogs) {
    for (const d of c.dishes || []) {
      shopeeItems.push({
        id: String(d.id),
        name: d.name || "",
        price: bahtFromMicros(d.price ?? d.list_price),
        picture: d.picture || "",
        description: d.description || "",
        catalogId: String(c.id),
        catalogName: c.name || "",
        optionGroupCount: d.option_group_count ?? null,
      });
    }
  }
  const og = xhrJson("GET", "https://foody.shopee.co.th/api/seller/store/option-groups", null);
  const optionGroups = (og.json?.data?.groups || []).map((g) => ({
    id: String(g.group_id),
    name: g.group_name || "",
  }));
  return {
    shopeeRule,
    items,
    scanItems: scan.items || [],
    shopeeItems,
    catalogs: catalogs.map((c) => ({ id: String(c.id), name: c.name || "", n: (c.dishes || []).length })),
    optionGroups,
  };
}

function pickSibling(pos, onShopee) {
  const sameCat = onShopee.filter((s) => namesEqual(s.pos.categoryName, pos.categoryName));
  const sameMode = sameCat.filter((s) => modeKey(s.pos) === modeKey(pos));
  const pool = sameMode.length ? sameMode : sameCat;
  const want = [...pos.optionNames].map(fold).sort().join("|");
  const hit =
    pool.find((s) => [...s.pos.optionNames].map(fold).sort().join("|") === want) ||
    pool[0] ||
    null;
  if (hit) return hit;
  // Empty Shopee category (e.g. hot / fusion): borrow picture from same mode elsewhere.
  const modePool = onShopee.filter((s) => modeKey(s.pos) === modeKey(pos) && s.shopee.picture);
  return modePool[0] || onShopee.find((s) => s.shopee.picture) || null;
}

function mapOptionGroupIds(optionNames, shopeeGroups) {
  const out = [];
  for (const name of optionNames) {
    const hit = shopeeGroups.find((g) => namesEqual(g.name, name));
    if (hit) out.push({ name, id: hit.id });
    else out.push({ name, id: null });
  }
  return out;
}

function buildPlan(ctx) {
  const { shopeeRule, items, shopeeItems, catalogs, optionGroups } = ctx;
  const byName = new Map(shopeeItems.map((x) => [fold(x.name), x]));
  const posById = new Map(items.map((i) => [i.id, i]));
  const eligible = items.filter((i) => i.active && !i.storeOnly);
  const onShopee = [];
  const missing = [];
  for (const it of eligible) {
    const hit = byName.get(fold(it.name));
    if (hit) onShopee.push({ pos: it, shopee: hit });
    else missing.push(it);
  }
  const rows = missing.map((pos) => {
    const sibling = pickSibling(pos, onShopee);
    const cat = catalogs.find((c) => namesEqual(c.name, pos.categoryName)) || null;
    const mapped = mapOptionGroupIds(pos.optionNames, optionGroups);
    return {
      posId: pos.id,
      name: pos.name,
      category: pos.categoryName,
      mode: modeKey(pos),
      storePrice: pos.price,
      target: applyChannelRule(pos.price, shopeeRule),
      description: (pos.description || "").trim() || sibling?.shopee.description || pos.name,
      imageUrl: pos.imageUrl || "",
      picture: sibling?.shopee.picture || "",
      catalogId: cat?.id || sibling?.shopee.catalogId || "",
      catalogName: cat?.name || pos.categoryName,
      optionNames: pos.optionNames,
      optionGroupIds: mapped.filter((m) => m.id).map((m) => m.id),
      missingGroups: mapped.filter((m) => !m.id).map((m) => m.name),
      siblingName: sibling?.pos.name || "",
      siblingId: sibling?.shopee.id || "",
      hubNote: pos.hubNote || "",
    };
  });
  rows.sort((a, b) => a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th"));
  return {
    at: new Date().toISOString(),
    shopeeRule,
    shopeeCount: shopeeItems.length,
    posDelivery: eligible.length,
    matchedExact: onShopee.length,
    missing: rows.length,
    rows,
    posById,
  };
}

function quotaMessage(json, raw) {
  const msg = String(json?.msg || json?.message || raw || "");
  if (QUOTA_RE.test(msg)) return msg.slice(0, 400);
  return null;
}

function createDish(row) {
  const body = {
    dish: {
      catalog_id: row.catalogId,
      name: row.name,
      description: row.description || row.name,
      available: true,
      price: String(micros(row.target)),
      list_price: micros(row.target),
      listing_status: 1,
      sale_week_bit: 127,
      sale_start_time: 0,
      sale_end_time: 86399,
      time_for_sales: [{ sale_start_time: 0, sale_end_time: 86399 }],
      stock_type: 0,
      picture: row.picture || undefined,
      picture_type: row.picture ? 0 : undefined,
    },
  };
  return xhrJson("POST", API, body);
}

function bindOptionsPut(dishId, row, liveDish) {
  const dish = {
    ...(liveDish || {}),
    id: String(dishId),
    catalog_id: row.catalogId,
    name: row.name,
    description: row.description || row.name,
    available: true,
    price: String(micros(row.target)),
    list_price: micros(row.target),
    listing_status: 1,
    sale_week_bit: 127,
    option_group_ids: row.optionGroupIds,
  };
  return xhrJson("PUT", `${API}/${dishId}`, { dish });
}

async function waitEditReady(dishId, minCbs = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const st = js(`(() => {
      const crop = document.querySelector('[class*=crop_modal]');
      if (crop) {
        const btn = [...crop.querySelectorAll('button')].find((b) => /ยกเลิก|Cancel/i.test((b.innerText||'').trim()));
        if (btn) btn.click();
      }
      return JSON.stringify({
        onEdit: location.href.includes('/dish/edit') && location.href.includes('${dishId}'),
        cbs: document.querySelectorAll('input[type="checkbox"]').length,
        crop: !!crop,
      });
    })()`);
    const need = Number(minCbs) <= 0 ? 0 : Number(minCbs);
    if (st?.onEdit && !st?.crop && (need <= 0 || Number(st.cbs) >= need)) return st;
    await sleep(400);
  }
  return null;
}

function confirmOverwriteIfNeeded() {
  return js(`(() => {
    const dialog = [...document.querySelectorAll('[class*=modal], [class*=dialog], [class*=confirm]')]
      .find((e) => /บันทึกแทนที่|อัปเดตข้อมูล/i.test(e.innerText || ''));
    if (!dialog) return JSON.stringify({ ok: true, confirmed: false });
    const ok = [...dialog.querySelectorAll('button')].find((b) => /ตกลง|OK|ยืนยัน/i.test((b.innerText || '').trim()));
    if (ok) ok.click();
    return JSON.stringify({ ok: !!ok, confirmed: true });
  })()`);
}

async function bindOptionsUi(dishId, optionNames) {
  go(editUrl(dishId));
  await sleep(1500);
  const wantN = (optionNames || []).length;
  const minCbs = wantN <= 0 ? 0 : wantN >= 4 ? 8 : 2;
  const ready = await waitEditReady(dishId, minCbs);
  if (!ready?.onEdit) return { ok: false, reason: "edit-not-ready", ready };
  js(`(() => {
    const names = ${JSON.stringify(optionNames)};
    const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim().toLowerCase()
      .replace(/ท้อปปิ้ง/g, 'ท็อปปิ้ง');
    for (const name of names) {
      for (const tr of document.querySelectorAll('tr')) {
        const first = (tr.innerText || '').trim().split('\\n')[0].trim();
        if (fold(first) !== fold(name)) continue;
        const label = tr.querySelector('label.shopee-pos-checkbox-wrapper') || tr.querySelector('label');
        const cb = tr.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) (label || cb).click();
        break;
      }
    }
    return 'ticked';
  })()`);
  await sleep(700);
  const ticked = js(`(() => {
    const names = ${JSON.stringify(optionNames)};
    const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim().toLowerCase()
      .replace(/ท้อปปิ้ง/g, 'ท็อปปิ้ง');
    const done = [];
    const missed = [];
    for (const name of names) {
      let hit = false;
      for (const tr of document.querySelectorAll('tr')) {
        const first = (tr.innerText || '').trim().split('\\n')[0].trim();
        if (fold(first) !== fold(name)) continue;
        const cb = tr.querySelector('input[type="checkbox"]');
        const wrap = tr.querySelector('.shopee-pos-checkbox');
        const checked = !!cb?.checked || /checked/i.test(wrap?.className || '');
        hit = checked;
        done.push({ name, checked });
        break;
      }
      if (!hit) missed.push(name);
    }
    return JSON.stringify({ done, missed });
  })()`);
  if ((ticked?.missed || []).length) {
    return { ok: false, reason: "missed-groups", ticked };
  }
  const save = js(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'บันทึก');
    if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
    btn.click();
    return JSON.stringify({ ok: true });
  })()`);
  await sleep(800);
  const overwrite = confirmOverwriteIfNeeded();
  await sleep(3500);
  return { ok: !!save?.ok && !(ticked?.missed || []).length, ticked, save, overwrite };
}

function readDishGroups(dishId) {
  const got = xhrJson("GET", `${API}/${dishId}`, null);
  const live = got.json?.data?.dish || null;
  return {
    ok: got.json?.code === 0 && live?.id != null,
    option_group_count: live?.option_group_count ?? null,
    picture: live?.picture || "",
    available: live?.available,
    listing_status: live?.listing_status,
    live,
  };
}

function appendScan(row, dishId, price) {
  if (!existsSync(SCAN) || !dishId) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const items = Array.isArray(scan.items) ? scan.items : [];
  const next = {
    name: row.name,
    listPrice: price,
    displayPrice: price,
    prices: [price],
    dishId: String(dishId),
    category: row.catalogName || row.category,
    visible: "แสดงเมนู",
    stock: "พร้อมจำหน่าย",
  };
  const i = items.findIndex((x) => String(x.dishId) === String(dishId) || fold(x.name) === fold(row.name));
  if (i >= 0) items[i] = { ...items[i], ...next };
  else items.push(next);
  scan.items = items;
  scan.count = items.length;
  scan.scannedAt = new Date().toISOString();
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

function keepNote(prev, price) {
  const base = String(prev || "").trim();
  const stamp = `S:สร้างแล้ว ${price} ✓`;
  if (!base) return stamp;
  if (base.includes("S:สร้างแล้ว")) return base;
  return `${base} · ${stamp}`;
}

async function main() {
  ensureShopeeTab();
  const here = js(`JSON.stringify({ url: location.href })`);
  if (!String(here?.url || "").includes("/shopee-pos")) {
    go(LIST_URL);
    await sleep(2500);
    ensureShopeeTab();
  }

  const ctx = await loadContext();
  const plan = buildPlan(ctx);
  let rows = plan.rows;
  if (only) rows = rows.filter((r) => fold(r.name).includes(fold(only)));
  if (exclude) {
    const ex = fold(exclude);
    rows = rows.filter((r) => !fold(r.name).includes(ex) && !fold(r.category).includes(ex));
  }
  // Prefer sales-ranked create list when present
  const preferPath = preferFile
    ? preferFile
    : join(DATA, "shopee-create-from-delivery-sales.json");
  if (existsSync(preferPath)) {
    try {
      const pref = JSON.parse(readFileSync(preferPath, "utf8"));
      const order = [
        ...(pref.recommendTop16 || []),
        ...(pref.allMissing || []),
      ]
        .map((r) => fold(r.name || ""))
        .filter(Boolean);
      const rank = new Map(order.map((n, i) => [n, i]));
      rows.sort((a, b) => {
        const ra = rank.has(fold(a.name)) ? rank.get(fold(a.name)) : 9999;
        const rb = rank.has(fold(b.name)) ? rank.get(fold(b.name)) : 9999;
        return ra - rb || a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th");
      });
    } catch {
      /* ignore prefer file */
    }
  }
  if (limit > 0) rows = rows.slice(0, limit);
  writeFileSync(PLAN, JSON.stringify({ ...plan, selected: rows.length, exclude, preferPath }, null, 2) + "\n");

  console.log(
    `Shopee ${plan.shopeeCount} · POS delivery ${plan.posDelivery} · exact ${plan.matchedExact} · missing ${plan.missing} · selected ${rows.length} dryRun=${dryRun}` +
      (exclude ? ` · exclude=${exclude}` : ""),
  );
  for (const r of rows) {
    console.log(
      `  [${r.category} / ${r.mode}] ${r.name}  store ${r.storePrice} → S ${r.target}` +
        ` · opts ${r.optionNames.join(" | ") || "(none)"}` +
        ` · sibling ${r.siblingName || "—"}` +
        (r.missingGroups.length ? ` · missingOG ${r.missingGroups.join(",")}` : ""),
    );
  }
  if (!rows.length) {
    console.log("Nothing to create.");
    process.exit(0);
  }
  if (dryRun) {
    console.log("Dry run — pass --apply to create.");
    process.exit(0);
  }

  const log = { at: new Date().toISOString(), results: [] };
  for (const row of rows) {
    console.log(`\n=== ${row.name} ===`);
    if (!row.catalogId) {
      console.log("skip — no catalog id");
      log.results.push({ name: row.name, status: "no_catalog" });
      continue;
    }
    const created = createDish(row);
    const quota = quotaMessage(created.json, created.raw);
    if (quota) {
      console.log("QUOTA", quota);
      log.results.push({ name: row.name, status: "quota", quota, created });
      writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
      break;
    }
    const dish =
      created.json?.data?.dish ||
      created.json?.data ||
      null;
    const dishId = String(dish?.id || dish?.dish_id || "");
    if (created.status !== 200 || created.json?.code !== 0 || !dishId) {
      console.log("create fail", created.status, created.json?.msg || created.raw);
      log.results.push({ name: row.name, status: "create_fail", created });
      writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
      if (QUOTA_RE.test(String(created.json?.msg || created.raw || ""))) break;
      continue;
    }
    const livePrice = bahtFromMicros(dish.price ?? dish.list_price) || row.target;
    console.log(`created ${dishId} price ${livePrice}`);

    const expectOg = (row.optionNames || []).length;
    let bind = { skipped: true };
    let ogCount = null;
    if (expectOg > 0) {
      // Never rely on PUT option_group_ids — it reports success but does not persist.
      bind = await bindOptionsUi(dishId, row.optionNames);
      if (!bind.ok) {
        console.log("UI bind retry", bind.reason || bind.ticked?.missed || "");
        bind = { ...bind, retry: await bindOptionsUi(dishId, row.optionNames) };
        bind.ok = !!bind.retry?.ok;
      }
      let liveCheck = readDishGroups(dishId);
      ogCount = liveCheck.option_group_count;
      if (ogCount !== expectOg) {
        console.log(`⚠ option count ${ogCount} != POS ${expectOg} — rebind UI`);
        const again = await bindOptionsUi(dishId, row.optionNames);
        bind = { ...bind, rebind: again };
        liveCheck = readDishGroups(dishId);
        ogCount = liveCheck.option_group_count;
      }
      if (ogCount !== expectOg) {
        console.log(`FAIL options still ${ogCount}/${expectOg} — leave dish for manual fix`);
        log.results.push({
          name: row.name,
          posId: row.posId,
          dishId,
          price: livePrice,
          target: row.target,
          optionGroupCount: ogCount,
          expectOg,
          bind,
          status: "created_options_mismatch",
        });
        writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
        appendScan(row, dishId, livePrice);
        go(LIST_URL);
        await sleep(1200);
        continue;
      }
      console.log(`options OK ${ogCount}/${expectOg}`);
    } else {
      ogCount = 0;
    }

    appendScan(row, dishId, livePrice);
    await writeHubChannelLiveRow({
      posId: row.posId,
      channel: "shopee",
      name: row.name,
      price: livePrice,
      externalId: dishId,
      source: "create",
      targetPrice: row.target,
      applyStatus: livePrice === row.target ? "match" : "created",
    });
    await writeMenuItemHubNote(row.posId, keepNote(row.hubNote, livePrice));

    const entry = {
      name: row.name,
      posId: row.posId,
      dishId,
      price: livePrice,
      target: row.target,
      optionGroupCount: ogCount,
      expectOg,
      bind,
      status: "created",
    };
    log.results.push(entry);
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log(`hub wrote ${row.name} S=${livePrice} opts=${ogCount}`);
    go(LIST_URL);
    await sleep(1000);
  }

  const ok = log.results.filter((r) => r.status === "created").length;
  const badOg = log.results.filter((r) => r.status === "created_options_mismatch").length;
  const quota = log.results.find((r) => r.status === "quota");
  console.log(
    `\nDone created ${ok}/${rows.length}` +
      (badOg ? ` · options-mismatch ${badOg}` : "") +
      (quota ? " · hit quota" : ""),
  );
  process.exit(badOg || quota ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
