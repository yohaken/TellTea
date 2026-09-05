#!/usr/bin/env node
/**
 * Reorder Shopee / Grab / LINE MAN categories to match POS หลังร้าน
 * (applyFixedCategorySortOrder — เบเกอรี่เป็นหมวด 1 ไม่ใช่แค่ Firestore sortOrder).
 * Does not create missing POS categories. Platform-only leftover cats stay at the end.
 *
 *   node scripts/channel-reorder-categories-to-pos.mjs --dry-run
 *   node scripts/channel-reorder-categories-to-pos.mjs --apply --channel=shopee
 *   node scripts/channel-reorder-categories-to-pos.mjs --apply --channel=all
 *   node scripts/channel-reorder-categories-to-pos.mjs --apply --bakery-last --channel=all
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { findShopeeTab, chromeJsOnTab as shopeeGo } from "./lib/shopee-chrome.mjs";
import {
  findGrabTab,
  fetchGrabMenuApi,
  chromeJsOnTab as grabGo,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";
import { wongnaiGql, BUSINESS } from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/channel-reorder-categories-to-pos-log.json");

const LM_HASH = {
  menuGroups: "ff7ef868c7cfef64385853803821b442f16093ee4d3e2484e9b799aa79ccf54a",
  sortMenuGroup: "79f91d87973996a032af03f553d9c4a3ebfeab9ecd7de3046f8718a5face5683",
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const bakeryLastFlag = args.includes("--bakery-last");
const channelArg = (args.find((a) => a.startsWith("--channel=")) || "--channel=all").slice(10);
const channels =
  channelArg === "all" ? ["shopee", "grab", "lineman"] : channelArg.split(",").map((s) => s.trim());

/** Same list as src/lib/pos-fixed-category-order.ts — hub / เมนูหลังร้าน. */
const POS_FIXED_CATEGORY_ORDER = [
  "เบเกอรี่ & ไอศครีม",
  "Signature Drinks (เย็น, ปั่น)",
  "ชานมสดคราฟต์ (เย็น, ปั่น)",
  "ชา",
  "ชานม (เย็น, ปั่น)",
  "มัจฉะแท้",
  "ผลไม้ปั่น & สมูทตี้",
  "ชาผลไม้",
  "กาแฟ (เย็น, ปั่น)",
  "นม (เย็น, ปั่น)",
  "เบาเบากับน้ำเต้าหู้ (เย็น, ปั่น)",
  "อิตาเลียน โซดา",
  "0% แคล ชาเพื่อสุขภาพ",
  "0% แคล โซดาซ่าเพื่อสุขภาพ",
  "* กาแฟสดเข้มข้น",
  "* กาแฟสดนมนุ่มละมุน",
  "* กาแฟสดฟิวชันสดชื่น",
  "น้ำเปล่า",
];

function applyFixedCategoryOrder(cats) {
  const byName = new Map();
  for (const c of cats) {
    const k = normName(c.name);
    if (k && !byName.has(k)) byName.set(k, c);
  }
  const used = new Set();
  const ordered = [];
  for (const label of POS_FIXED_CATEGORY_ORDER) {
    if (normName(label) === normName("น้ำเปล่า")) continue;
    const hit = byName.get(normName(label));
    if (!hit || used.has(hit.id)) continue;
    ordered.push(hit);
    used.add(hit.id);
  }
  const extras = cats
    .filter((c) => !used.has(c.id) && normName(c.name) !== normName("น้ำเปล่า"))
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name || "").localeCompare(b.name || "", "th"),
    );
  for (const c of extras) {
    ordered.push(c);
    used.add(c.id);
  }
  for (const c of cats) {
    if (used.has(c.id)) continue;
    ordered.push(c);
    used.add(c.id);
  }
  return ordered;
}

function liveNames(list) {
  return list.map((c) => c.name);
}

function isBakeryCat(name) {
  return /เบเกอรี่|เบเกอรี/.test(name || "");
}

function isPosOnlyTail(name) {
  const n = name || "";
  return /\*\*\s*ไอศครีม/.test(n) || /น้ำเปล่า/.test(n);
}

/** Delivery: bakery last among platform cats. POS-only tail stays after. */
function bakeryLast(cats) {
  const bak = cats.filter((c) => isBakeryCat(c.name));
  const rest = cats.filter((c) => !isBakeryCat(c.name));
  const tail = rest.filter((c) => isPosOnlyTail(c.name));
  const mid = rest.filter((c) => !isPosOnlyTail(c.name));
  return [...mid, ...bak, ...tail];
}

function desiredOrder(posCats, live) {
  const liveByNorm = new Map();
  for (const c of live) {
    const k = normName(c.name);
    if (k && !liveByNorm.has(k)) liveByNorm.set(k, c);
  }
  const matched = [];
  const used = new Set();
  for (const p of posCats) {
    const hit = liveByNorm.get(normName(p.name));
    if (!hit) continue;
    matched.push(hit);
    used.add(normName(hit.name));
  }
  const leftover = live.filter((c) => !used.has(normName(c.name)));
  return { matched, leftover, want: [...matched, ...leftover] };
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false;
  return a.every((n, i) => namesEqual(n, b[i] || ""));
}

async function loadPosCats() {
  const db = await getSeedDb();
  const snap = await getDocs(collection(db, "menuCategories"));
  const cats = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => c.active !== false)
    .map((c) => ({ id: c.id, name: c.name || "", sortOrder: c.sortOrder ?? 0 }));
  return applyFixedCategoryOrder(cats);
}

function fetchShopeeCatalogs() {
  const { windowIndex, tabIndex } = findShopeeTab();
  const raw = shopeeGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET','https://foody.shopee.co.th/api/seller/store/catalogs', false);
      x.withCredentials = true;
      x.send(null);
      const json = JSON.parse(x.responseText);
      const cats = (json?.data?.catalogs || [])
        .map((c) => ({ id: String(c.id), name: c.name || '', rank: c.rank }))
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      return JSON.stringify({ code: json?.code, cats });
    })()`,
    { windowIndex },
  );
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return parsed?.cats || [];
}

function applyShopeeRanks(want) {
  const { windowIndex, tabIndex } = findShopeeTab();
  const ranks = want.map((c, i) => ({ id: String(c.id), rank: i + 1 }));
  const raw = shopeeGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('POST','https://foody.shopee.co.th/api/seller/store/catalogs/-/rank', false);
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
  if (!ok) console.log(`FAIL Shopee catalogs/-/rank ${json?.msg || status}`);
  return { ok, status, code: json?.code, msg: json?.msg || "", n: ranks.length };
}

function fetchGrabCats() {
  const { windowIndex, tabIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  return (menu.categories || []).map((c, i) => ({
    id: c.categoryID,
    name: c.categoryName || c.name || "",
    sortOrder: c.sortOrder,
    i,
  }));
}

function applyGrabSort(want) {
  const { windowIndex, tabIndex } = findGrabTab();
  const sorts = want.map((c, i) => ({ resourceID: c.id, sortOrder: i }));
  const raw = grabGo(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('PUT', 'https://api.grab.com/food/merchant/categories-sort', false);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type','application/json');
      x.setRequestHeader('merchantID', ${JSON.stringify(GRAB_STORE_ID)});
      x.send(JSON.stringify({ sectionSorts: [{ sectionID: '', sorts: ${JSON.stringify(sorts)} }] }));
      return x.status + '\\n' + (x.responseText || '');
    })()`,
    { windowIndex },
  );
  const text = String(raw || "");
  const status = Number(text.split("\n")[0]);
  const ok = status === 204 || status === 200;
  if (!ok) console.log(`FAIL Grab categories-sort ${text.slice(0, 200)}`);
  return { ok, status, n: sorts.length };
}

async function fetchLinemanCats() {
  const json = await wongnaiGql("menuGroups", LM_HASH.menuGroups, { businessId: Number(BUSINESS) });
  const groups = json?.data?.my?.menu?.groups?.data || [];
  return [...groups]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((g) => ({
      id: g.id,
      name: g.name?.primary || "",
      seq: g.seq,
      recommended: g.recommended === true,
      forbidWmaAddItem: g.forbidWmaAddItem === true,
      useSellingTime: g.useSellingTime === true,
      startSellingTime: g.startSellingTime ?? 0,
      endSellingTime: g.endSellingTime ?? 0,
    }));
}

async function applyLinemanSort(want) {
  const rid = Number(BUSINESS);
  const menuGroups = want.map((g, i) => ({
    id: g.id,
    seq: i,
    restaurantId: rid,
    recommended: g.recommended === true,
    forbidWmaAddItem: g.forbidWmaAddItem === true,
    useSellingTime: g.useSellingTime === true,
    startSellingTime: g.startSellingTime ?? 0,
    endSellingTime: g.endSellingTime ?? 0,
    name: { primary: g.name || "" },
  }));
  const res = await wongnaiGql("sortMenuGroup", LM_HASH.sortMenuGroup, {
    in: { restaurantId: rid, menuGroups },
  });
  if (res.errors) {
    console.log(`FAIL LINE MAN sortMenuGroup ${JSON.stringify(res.errors).slice(0, 400)}`);
    return { ok: false, errors: res.errors };
  }
  return { ok: true, n: (res.data?.menuGroupUpdateAll?.menuGroups || []).length };
}

function printPlan(label, live, want) {
  const liveN = liveNames(live);
  const wantN = liveNames(want);
  const ok = sameOrder(liveN, wantN);
  console.log(`=== ${label} ${ok ? "ตรง POS แล้ว" : "ต้องจัด"} · ${live.length} หมวด ===`);
  const n = Math.max(liveN.length, wantN.length);
  for (let i = 0; i < n; i++) {
    const a = liveN[i] || "—";
    const b = wantN[i] || "—";
    if (!namesEqual(a, b)) console.log(`  ${String(i + 1).padStart(2)} ≠ ตอนนี้: ${a}  → POS: ${b}`);
  }
  if (ok) console.log("  (ไม่มีบรรทัด ≠)");
  return ok;
}

async function main() {
  const posCats = await loadPosCats();
  const axis = bakeryLastFlag ? bakeryLast(posCats) : posCats;
  console.log(bakeryLastFlag ? "ช่องทาง (เบเกอรี่ท้ายสุด)" : "POS หลังร้าน");
  axis.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)} ${c.name}`));

  const log = {
    at: new Date().toISOString(),
    apply,
    force,
    bakeryLast: bakeryLastFlag,
    channels,
    pos: axis.map((c) => c.name),
    results: {},
  };

  if (channels.includes("shopee")) {
    const live = fetchShopeeCatalogs();
    const { want } = desiredOrder(axis, live);
    const ok = printPlan("Shopee", live, want);
    log.results.shopee = { before: liveNames(live), want: liveNames(want), alreadyOk: ok };
    if (apply && (!ok || force)) {
      log.results.shopee.apply = applyShopeeRanks(want);
      const after = fetchShopeeCatalogs();
      log.results.shopee.after = liveNames(after);
      printPlan("Shopee หลังจัด", after, want);
    }
  }

  if (channels.includes("grab")) {
    const live = fetchGrabCats();
    const { want } = desiredOrder(axis, live);
    const ok = printPlan("Grab", live, want);
    log.results.grab = { before: liveNames(live), want: liveNames(want), alreadyOk: ok };
    if (apply && (!ok || force)) {
      log.results.grab.apply = applyGrabSort(want);
      const after = fetchGrabCats();
      log.results.grab.after = liveNames(after);
      printPlan("Grab หลังจัด", after, want);
    }
  }

  if (channels.includes("lineman")) {
    const live = await fetchLinemanCats();
    const { want } = desiredOrder(axis, live);
    const ok = printPlan("LINE MAN", live, want);
    log.results.lineman = { before: liveNames(live), want: liveNames(want), alreadyOk: ok };
    if (apply && (!ok || force)) {
      log.results.lineman.apply = await applyLinemanSort(want);
      const after = await fetchLinemanCats();
      log.results.lineman.after = liveNames(after);
      printPlan("LINE MAN หลังจัด", after, want);
    }
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`log ${LOG}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
