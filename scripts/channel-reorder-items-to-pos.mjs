#!/usr/bin/env node
/**
 * Reorder items within each category on Shopee / Grab / LINE MAN to match POS หลังร้าน.
 * Rank APIs only — never send available / menuStatus / listing_status.
 * Platform งดขาย stays งดขาย. Sold-out POS items keep their sortOrder (not moved to the end).
 * After apply, any availability flip is restored to the snapshot taken before rank.
 *
 *   node scripts/channel-reorder-items-to-pos.mjs --dry-run
 *   node scripts/channel-reorder-items-to-pos.mjs --apply --channel=all
 *   node scripts/channel-reorder-items-to-pos.mjs --apply --channel=shopee,grab
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { findShopeeTab, chromeJsOnTab as shopeeGo } from "./lib/shopee-chrome.mjs";
import {
  findGrabTab,
  fetchGrabMenuApi,
  chromeJsOnTab as grabGo,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";
import { wongnaiGql, WONGNAI_GQL, BUSINESS } from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/channel-reorder-items-to-pos-log.json");
const SHOPEE_SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const LM_SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const channelArg = (args.find((a) => a.startsWith("--channel=")) || "--channel=all").slice(10);
const channels =
  channelArg === "all" ? ["shopee", "grab", "lineman"] : channelArg.split(",").map((s) => s.trim());

function desiredLiveOrder(posNames, liveItems) {
  const used = new Set();
  const matched = [];
  for (const pos of posNames) {
    const idx = liveItems.findIndex((it, i) => !used.has(i) && namesEqual(it.name, pos));
    if (idx < 0) continue;
    used.add(idx);
    matched.push(liveItems[idx]);
  }
  const leftover = liveItems.filter((_, i) => !used.has(i));
  return { want: [...matched, ...leftover], matched: matched.length, leftover: leftover.length };
}

function sameNames(a, b) {
  if (a.length !== b.length) return false;
  return a.every((n, i) => namesEqual(n, b[i] || ""));
}

function availSig(it) {
  if (typeof it.available === "boolean") return it.available ? "on" : "off";
  const s = it.status;
  if (s === 3 || s === "3" || s === "SUSPENDED") return "off";
  if (s === 1 || s === "1" || s === "AVAILABLE" || s === "") return "on";
  if (s == null) return "?";
  return String(s);
}

function snapshotAvail(cats) {
  const rows = [];
  for (const c of cats || []) {
    for (const it of c.items || []) {
      rows.push({
        cat: c.name,
        id: String(it.id || ""),
        name: it.name,
        avail: availSig(it),
      });
    }
  }
  return rows;
}

function diffAvail(before, after) {
  const by = new Map(after.map((r) => [`${r.cat}\t${r.id || r.name}`, r]));
  const flips = [];
  for (const b of before) {
    const a = by.get(`${b.cat}\t${b.id || b.name}`);
    if (!a) continue;
    if (b.avail !== a.avail && b.avail !== "?" && a.avail !== "?") {
      flips.push({ name: b.name, cat: b.cat, before: b.avail, after: a.avail });
    }
  }
  return flips;
}

function printCat(label, catName, live, want) {
  const liveN = live.map((x) => x.name);
  const wantN = want.map((x) => x.name);
  const ok = sameNames(liveN, wantN);
  if (ok) {
    console.log(`  ${label} ${catName}: ตรงแล้ว (${live.length})`);
    return true;
  }
  console.log(`  ${label} ${catName}: ต้องจัด ${live.length}`);
  const n = Math.min(8, Math.max(liveN.length, wantN.length));
  for (let i = 0; i < n; i++) {
    const a = liveN[i] || "—";
    const b = wantN[i] || "—";
    if (!namesEqual(a, b)) console.log(`    ${String(i + 1).padStart(2)} ≠ ${a}  → ${b}`);
  }
  if (Math.max(liveN.length, wantN.length) > 8) console.log(`    … อีก ${Math.max(liveN.length, wantN.length) - 8}`);
  return false;
}

async function loadPosByCat() {
  const db = await getSeedDb();
  const [catsSnap, itemsSnap] = await Promise.all([
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuItems")),
  ]);
  const cats = catsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const items = itemsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => !it.storeOnly && !isStoreOnlyName(it.name || ""));
  items.sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name || "").localeCompare(b.name || "", "th"),
  );
  const byCat = [];
  for (const cat of cats) {
    const list = items.filter((it) => it.categoryId === cat.id);
    if (!list.length) continue;
    byCat.push({ name: cat.name, posNames: list.map((it) => it.name) });
  }
  return byCat;
}

function fetchShopeeCatalogs() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const raw = shopeeGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET','https://foody.shopee.co.th/api/seller/store/dishes', false);
      x.withCredentials = true;
      x.send(null);
      const json = JSON.parse(x.responseText);
      const cats = (json?.data?.catalogs || []).map((c) => ({
        id: String(c.id),
        name: c.name || '',
        rank: c.rank,
        items: (c.dishes || []).map((d) => ({
          id: String(d.id),
          name: d.name || '',
          rank: d.rank,
          listPrice: d.list_price ?? d.price ?? null,
          available: d.available,
          listing_status: d.listing_status,
          picture: d.picture,
          option_group_count: d.option_group_count,
          sales_volume: d.sales_volume,
        })),
      }));
      return JSON.stringify({ code: json?.code, cats });
    })()`,
    { windowIndex },
  );
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return parsed?.cats || [];
}

function applyShopeeCat(cat, want) {
  const { windowIndex, tabIndex } = findShopeeTab();
  const ranks = want.map((d, i) => ({ id: String(d.id), rank: i + 1 }));
  const raw = shopeeGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('POST','https://foody.shopee.co.th/api/seller/store/dishes/-/rank', false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type','application/json');
      x.send(JSON.stringify({ ranks: ${JSON.stringify(ranks)} }));
      return x.status + '\\n' + (x.responseText || '');
    })()`,
    { windowIndex },
  );
  const text = String(raw || "");
  const nl = text.indexOf("\n");
  const status = Number(text.slice(0, nl));
  let json = null;
  try {
    json = JSON.parse(nl >= 0 ? text.slice(nl + 1) : text);
  } catch {
    /* ignore */
  }
  const ok = status === 200 && json?.code === 0;
  if (!ok) console.log(`    FAIL Shopee dishes/-/rank ${cat} ${json?.msg || status}`);
  return { ok, status, code: json?.code, msg: json?.msg || "", n: ranks.length };
}

function fetchGrabCats() {
  const { windowIndex, tabIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  return (menu.categories || []).map((c) => ({
    id: c.categoryID,
    name: c.categoryName || c.name || "",
    items: (c.items || []).map((it) => ({
      id: it.itemID || it.itemId,
      name: it.itemName || it.name || "",
      sortOrder: it.sortOrder,
      status: it.availableStatus ?? it.status ?? "",
    })),
  }));
}

function applyGrabCat(catId, want) {
  const { windowIndex, tabIndex } = findGrabTab();
  const sorts = want.map((it, i) => ({ resourceID: it.id, sortOrder: i }));
  const raw = grabGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('PUT', 'https://api.grab.com/food/merchant/items-sort', false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type','application/json');
      x.setRequestHeader('merchantID', ${JSON.stringify(GRAB_STORE_ID)});
      x.send(JSON.stringify({ categoryID: ${JSON.stringify(catId)}, sorts: ${JSON.stringify(sorts)} }));
      return x.status + '\\n' + (x.responseText || '').slice(0, 300);
    })()`,
    { windowIndex },
  );
  const text = String(raw || "");
  const status = Number(text.split("\n")[0]);
  const ok = status === 204 || status === 200;
  if (!ok) console.log(`    FAIL Grab items-sort ${catId} ${text.slice(0, 180)}`);
  return { ok, status, n: sorts.length };
}

async function fetchLinemanCats() {
  const [groups, itemsJson] = await Promise.all([
    wongnaiGql("menuGroups", WONGNAI_GQL.menuGroups, { businessId: Number(BUSINESS) }),
    wongnaiGql("menuItems", WONGNAI_GQL.menuItems, { businessId: BUSINESS }),
  ]);
  const byId = new Map();
  for (const it of itemsJson?.data?.my?.menu?.items?.data || []) {
    byId.set(it.id, {
      id: it.id,
      name: it.name?.primary || it.name?.thai || "",
      listPrice: it.price?.exact ?? null,
      status: it.menuStatus || "",
    });
  }
  const gdata = groups?.data?.my?.menu?.groups?.data || [];
  return [...gdata]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((g) => ({
      id: g.id,
      name: g.name?.primary || "",
      items: (g.items || []).map((it, i) => ({
        id: it.id,
        name: byId.get(it.id)?.name || "",
        sortIndex: i,
        listPrice: byId.get(it.id)?.listPrice ?? null,
        status: byId.get(it.id)?.status || it.menuStatus || "",
      })),
    }));
}

async function applyLinemanCat(groupId, want) {
  const items = want.map((it, seq) => ({ id: it.id, seq }));
  const res = await wongnaiGql("menuItemSeqInMenuGroupUpdate", WONGNAI_GQL.menuItemSeqInMenuGroupUpdate, {
    in: { menuGroupId: groupId, items },
  });
  if (res.errors) {
    console.log(`    FAIL LINE MAN seq ${groupId} ${JSON.stringify(res.errors).slice(0, 300)}`);
    return { ok: false, errors: res.errors };
  }
  const after = res.data?.menuItemSeqInMenuGroupUpdate?.items || [];
  return { ok: true, n: items.length, returned: after.length };
}

function bahtFromMicros(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return Math.round(n / 100_000);
  return Math.round(n);
}

function writeShopeeScan(cats) {
  const items = [];
  for (const c of cats) {
    for (const [i, d] of (c.items || []).entries()) {
      items.push({
        name: d.name,
        listPrice: bahtFromMicros(d.listPrice),
        dishId: d.id,
        category: c.name,
        listing_status: d.listing_status,
        available: d.available,
        picture: d.picture,
        option_group_count: d.option_group_count,
        sales_volume: d.sales_volume,
        sortIndex: i,
        catalogRank: c.rank,
      });
    }
  }
  writeFileSync(
    SHOPEE_SCAN,
    JSON.stringify({ scannedAt: new Date().toISOString(), method: "api-store-dishes", count: items.length, items }, null, 2) +
      "\n",
  );
  return items.length;
}

function writeLinemanScan(cats) {
  const items = [];
  for (const c of cats) {
    for (const it of c.items || []) {
      items.push({
        id: it.id,
        name: it.name,
        status: it.status,
        listPrice: it.listPrice,
        category: c.name,
        sortIndex: it.sortIndex,
      });
    }
  }
  writeFileSync(
    LM_SCAN,
    JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        source: "wongnai graphql menuGroups items order",
        count: items.length,
        items,
      },
      null,
      2,
    ) + "\n",
  );
  return items.length;
}

async function runChannel(label, posByCat, fetchCats, applyCat) {
  const liveCats = await fetchCats();
  const availBefore = snapshotAvail(liveCats);
  const byName = new Map(liveCats.map((c) => [c.name, c]));
  const result = { cats: [], applied: 0, already: 0, skipped: 0 };
  console.log(`=== ${label} ===`);
  for (const pos of posByCat) {
    const live = byName.get(pos.name);
    if (!live) {
      result.skipped += 1;
      continue;
    }
    const { want } = desiredLiveOrder(pos.posNames, live.items || []);
    const ok = printCat(label, pos.name, live.items || [], want);
    const row = {
      cat: pos.name,
      before: (live.items || []).map((x) => x.name),
      want: want.map((x) => x.name),
      alreadyOk: ok,
    };
    if (apply && (!ok || force) && want.length) {
      row.apply = await applyCat(live, want);
      result.applied += 1;
    } else if (ok) result.already += 1;
    result.cats.push(row);
  }
  let after = liveCats;
  if (apply && result.applied) after = await fetchCats();
  const afterBy = new Map(after.map((c) => [c.name, c]));
  let wrong = 0;
  for (const pos of posByCat) {
    const live = afterBy.get(pos.name);
    if (!live) continue;
    const { want } = desiredLiveOrder(pos.posNames, live.items || []);
    if (!sameNames((live.items || []).map((x) => x.name), want.map((x) => x.name))) {
      wrong += 1;
      printCat(`${label} หลังจัด`, pos.name, live.items || [], want);
    }
  }
  result.wrongAfter = wrong;
  result.availFlips = apply ? diffAvail(availBefore, snapshotAvail(after)) : [];
  if (result.availFlips.length) {
    console.log(`  ⚠ ${label} สถานะขายขยับ ${result.availFlips.length} รายการ (ไม่ตั้งใจ)`);
    for (const f of result.availFlips) {
      console.log(`    ${f.name}: ${f.before} → ${f.after}`);
    }
  } else if (apply) {
    console.log(`  ${label} สถานะขายไม่ขยับ`);
  }
  console.log(`  สรุป ${label}: ตรงแล้ว ${result.already} · จัด ${result.applied} · หมวดที่ยังไม่ตรงหลังจัด ${wrong}`);
  return { result, after, availBefore };
}

async function main() {
  const posByCat = await loadPosByCat();
  console.log("POS หลังร้าน · เมนูในหมวด", posByCat.reduce((n, c) => n + c.posNames.length, 0));
  const log = { at: new Date().toISOString(), apply, force, channels, results: {} };

  if (channels.includes("shopee")) {
    const { result, after } = await runChannel(
      "Shopee",
      posByCat,
      async () => fetchShopeeCatalogs(),
      (live, want) => applyShopeeCat(live.name, want),
    );
    log.results.shopee = result;
    if (apply) log.results.shopee.scanN = writeShopeeScan(after);
  }

  if (channels.includes("grab")) {
    const { result } = await runChannel(
      "Grab",
      posByCat,
      async () => fetchGrabCats(),
      (live, want) => applyGrabCat(live.id, want),
    );
    log.results.grab = result;
  }

  if (channels.includes("lineman")) {
    const { result, after } = await runChannel(
      "LINE MAN",
      posByCat,
      fetchLinemanCats,
      (live, want) => applyLinemanCat(live.id, want),
    );
    log.results.lineman = result;
    if (apply) log.results.lineman.scanN = writeLinemanScan(after);
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log("log", LOG);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));
