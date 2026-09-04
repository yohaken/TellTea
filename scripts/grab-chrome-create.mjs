#!/usr/bin/env node
/**
 * Align / create Grab menus from POS.
 * POS option groups are the source of truth; Grab siblings in the same
 * category+mode decide whether a topping SKU may receive drink groups.
 *
 * Existing near-name variants are renamed (not created) so we do not burn
 * the item-count quota. True missing items try the create form.
 *
 *   node scripts/grab-chrome-create.mjs --dry-run
 *   node scripts/grab-chrome-create.mjs --dry-run --notes-only
 *   node scripts/grab-chrome-create.mjs --apply --notes-only
 *   node scripts/grab-chrome-create.mjs --apply --limit=1
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/grab-csv.mjs";
import { applyChannelRule } from "./lib/hub-channel-targets.mjs";
import { writeHubChannelLiveRow, writeMenuItemHubNote } from "./lib/hub-live-write.mjs";
import {
  fetchGrabMenuApi,
  findGrabTab,
  openEditItem,
  saveNameAndRead,
  sleep,
} from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const PLAN = join(DATA, "grab-create-plan.json");
const LOG = join(DATA, "grab-create-log.json");
const API = join(DATA, "grab-api-menu-v2.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const notesOnly = args.includes("--notes-only");
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();

function fold(s) {
  return normName(s)
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง")
    .replace(/\u00a0/g, " ");
}

function coreName(s) {
  return fold(s)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCreateNote(s) {
  return /สร้างเมนู\s*(grab|แกร็บ)/i.test(s || "");
}

function modeKey(item) {
  const n = item.name || "";
  if (item.categoryName === "ทัอปปิ้ง") return "topping";
  if (/ร้อน/.test(n) && !/เย็น/.test(n)) return "hot";
  if (/มะนาว/.test(n)) return "lime";
  if (/เย็น\/ปั่น|\(เย็น\/ปั่น\)/.test(n)) return "iced-blend";
  if (/เย็น|ปั่น|16\s*ออนซ์/.test(n)) return "cold";
  return "other";
}

function isToppingCategory(name) {
  return /ทัอปปิ้ง|ท็อปปิ้ง/.test(name || "");
}

function drinkGroupName(name) {
  return /ความหวาน|ท้อปปิ้ง|ท็อปปิ้ง|ช็อตกาแฟ|ช็อตมะนาว|ช็อตมัทฉะ|ประเภท/.test(name || "");
}

function flattenGrab(menu) {
  const groups = menu.modifierGroups || [];
  const items = (menu.categories || []).flatMap((c) =>
    (c.items || []).map((it) => ({
      ...it,
      category: c.categoryName || c.name || "",
      categoryID: c.categoryID,
    })),
  );
  const canon = new Map();
  for (const g of groups) {
    if (!(g.relatedItemIDs || []).length) continue;
    const k = fold(g.modifierGroupName);
    const prev = canon.get(k);
    if (!prev || (g.relatedItemIDs || []).length > (prev.relatedItemIDs || []).length) {
      canon.set(k, g);
    }
  }
  return { items, groups, canon };
}

function findGrabItem(pos, grabItems) {
  const exact = grabItems.find((g) => fold(g.itemName) === fold(pos.name));
  if (exact) return { item: exact, how: "exact" };
  const core = coreName(pos.name);
  const hits = grabItems.filter((g) => coreName(g.itemName) === core);
  if (hits.length === 1) return { item: hits[0], how: "core" };
  const coldHits = hits.filter((g) => modeKey({ name: g.itemName, categoryName: pos.categoryName }) === modeKey(pos));
  if (coldHits.length === 1) return { item: coldHits[0], how: "core-mode" };
  return { item: null, how: "missing" };
}

async function loadContext(menu) {
  const db = await getSeedDb();
  const [settingsSnap, itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const rule = settings.channels?.grab || { mode: "gp", value: 30 };
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
      price: Number(data.price) || 0,
      active: data.active !== false,
      storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
      categoryId: data.categoryId || "",
      categoryName,
      optionGroupIds,
      optionNames: optionGroupIds.map((id) => groups.get(id)?.name).filter(Boolean),
      imageUrl: data.imageUrl || "",
      hubNote: data.hubNote || "",
    };
  });
  return { grabRule: rule, items, menu };
}

function wantedGrabGroups(pos, canon, siblingGrab) {
  const mapped = pos.optionNames
    .map((n) => canon.get(fold(n)))
    .filter(Boolean);
  const siblingIds = new Set(siblingGrab?.linkedModifierGroupIDs || []);
  const topping = isToppingCategory(pos.categoryName);
  return mapped.filter((g) => {
    if (topping && drinkGroupName(g.modifierGroupName) && !siblingIds.has(g.modifierGroupID)) {
      return false;
    }
    return true;
  });
}

function pickSibling(pos, onGrab) {
  const key = `${pos.categoryName}::${modeKey(pos)}`;
  const siblings = onGrab.filter(
    (row) => row.pos.id !== pos.id && `${row.pos.categoryName}::${modeKey(row.pos)}` === key,
  );
  return (
    siblings.find((s) => {
      const a = [...s.pos.optionNames].map(fold).sort().join("|");
      const b = [...pos.optionNames].map(fold).sort().join("|");
      return a === b;
    }) ||
    siblings[0] ||
    null
  );
}

function baht(priceInMin) {
  const n = Number(priceInMin);
  if (!Number.isFinite(n)) return null;
  return n >= 100 ? Math.round(n / 100) : n;
}

function buildPlan(ctx, grab) {
  const eligible = ctx.items.filter((i) => i.active && !i.storeOnly);
  const onGrab = [];
  const missing = [];
  for (const pos of eligible) {
    const hit = findGrabItem(pos, grab.items);
    if (hit.item) onGrab.push({ pos, grab: hit.item, how: hit.how });
    else missing.push(pos);
  }
  const rows = [];
  const consider = notesOnly
    ? [...missing.filter((p) => isCreateNote(p.hubNote)), ...onGrab.filter((r) => isCreateNote(r.pos.hubNote) || r.how !== "exact")]
    : [...missing.map((pos) => ({ pos, grab: null, how: "missing" })), ...onGrab.filter((r) => r.how !== "exact")];

  const unique = [];
  const seen = new Set();
  for (const row of consider) {
    const pos = row.pos || row;
    if (seen.has(pos.id)) continue;
    if (only && !pos.name.includes(only)) continue;
    seen.add(pos.id);
    unique.push(row.pos ? row : { pos, grab: null, how: "missing" });
  }

  for (const row of unique) {
    const sibling = pickSibling(row.pos, onGrab);
    const want = wantedGrabGroups(row.pos, grab.canon, sibling?.grab);
    const linked = new Set(row.grab?.linkedModifierGroupIDs || []);
    const attach = want.filter((g) => !linked.has(g.modifierGroupID)).map((g) => g.modifierGroupName);
    const target = applyChannelRule(row.pos.price, ctx.grabRule);
    rows.push({
      posId: row.pos.id,
      name: row.pos.name,
      category: row.pos.categoryName,
      mode: modeKey(row.pos),
      fromNote: isCreateNote(row.pos.hubNote),
      how: row.how,
      grabId: row.grab?.itemID || "",
      grabName: row.grab?.itemName || "",
      storePrice: row.pos.price,
      target,
      live: baht(row.grab?.priceInMin),
      optionNames: row.pos.optionNames,
      attach,
      siblingName: sibling?.pos.name || "",
      siblingGrabId: sibling?.grab?.itemID || "",
    });
  }
  rows.sort((a, b) => {
    if (a.fromNote !== b.fromNote) return a.fromNote ? -1 : 1;
    if ((a.how === "missing") !== (b.how === "missing")) return a.how === "missing" ? -1 : 1;
    return a.name.localeCompare(b.name, "th");
  });
  return {
    at: new Date().toISOString(),
    grabRule: ctx.grabRule,
    grabCount: grab.items.length,
    posDelivery: eligible.length,
    matchedExact: onGrab.filter((r) => r.how === "exact").length,
    renameOrAlign: rows.filter((r) => r.how !== "missing").length,
    missing: rows.filter((r) => r.how === "missing").length,
    rows,
  };
}

async function attachGroups(tabIndex, windowIndex, names) {
  if (!names.length) return { skipped: true };
  const payload = JSON.stringify(names);
  return (await import("./lib/grab-chrome.mjs")).chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const want = ${payload};
      const fold = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const out = [];
      for (const name of want) {
        let hit = null;
        for (const lab of document.querySelectorAll('label, div, span')) {
          const t = fold(lab.innerText || '').split('\\n')[0];
          if (t === fold(name)) { hit = lab; break; }
        }
        if (!hit) { out.push({ name, ok: false, why: 'no-label' }); continue; }
        const inp = hit.querySelector('input[type=checkbox]') || hit.closest('label')?.querySelector('input[type=checkbox]');
        if (inp) {
          if (!inp.checked) inp.click();
          out.push({ name, ok: true, checked: true });
        } else {
          hit.click();
          out.push({ name, ok: true, clicked: true });
        }
      }
      const save = [...document.querySelectorAll('button')].find((b) => /^บันทึก/.test((b.innerText || '').trim()));
      if (save && !save.disabled) save.click();
      return JSON.stringify({ ticks: out, saved: !!save });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const { windowIndex, tabIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  writeFileSync(API, JSON.stringify(menu) + "\n");
  const grab = flattenGrab(menu);
  const ctx = await loadContext(menu);
  const plan = buildPlan(ctx, grab);
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + "\n");

  let queue = plan.rows;
  if (notesOnly) queue = queue.filter((r) => r.fromNote || r.how !== "exact");
  if (limit) queue = queue.slice(0, limit);

  console.log(
    `Grab ${plan.grabCount} · POS ${plan.posDelivery} · exact ${plan.matchedExact} · rename ${plan.renameOrAlign} · missing ${plan.missing} · selected ${queue.length}`,
  );
  for (const r of queue) {
    console.log(
      `${r.fromNote ? "NOTE" : "    "} [${r.how}] ${r.grabName || "(ไม่มี)"} → ${r.name}  ${r.live ?? "-"}→${r.target}  attach ${r.attach.join(" | ") || "-"}  sib ${r.siblingName || "-"}`,
    );
  }
  if (!apply) {
    console.log(`dry-run → ${PLAN}`);
    return;
  }

  const log = { at: new Date().toISOString(), apply: true, items: [] };
  for (const row of queue) {
    console.log(`\nALIGN ${row.name} ${row.grabId || "CREATE"}`);
    if (!row.grabId) {
      const rec = { ...row, status: "missing_try_create_blocked", error: "true-missing — open create UI next; not auto-created this pass" };
      console.log("  missing on Grab — จะลองสร้างทีละชิ้นหลังยืนยันฟอร์ม (กันโควตา)");
      log.items.push(rec);
      writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
      continue;
    }
    const page = await openEditItem(tabIndex, row.grabId, row.grabName, windowIndex, row.category);
    if (!page?.onEdit && page?.nameEditable === false && !page?.name) {
      log.items.push({ ...row, status: "edit_fail", page });
      continue;
    }
    const renamed = await saveNameAndRead(tabIndex, row.name, true, windowIndex);
    console.log("  rename", renamed);
    let ticks = { skipped: true };
    if (row.attach.length) {
      await sleep(1500);
      ticks = await attachGroups(tabIndex, windowIndex, row.attach);
      console.log("  attach", ticks);
      await sleep(2000);
    }
    const liveMenu = flattenGrab(fetchGrabMenuApi(tabIndex, windowIndex));
    const live = liveMenu.items.find((it) => it.itemID === row.grabId);
    const liveName = live?.itemName || renamed?.afterName || "";
    const nameOk = fold(liveName) === fold(row.name);
    const livePrice = baht(live?.priceInMin);
    const scannedAt = new Date().toISOString();
    const hubNote = nameOk
      ? `G:ตรงแล้ว ${livePrice ?? row.target} ✓`
      : `G:ปรับชื่อ ${row.grabName}→${row.name}`.slice(0, 180);
    await writeHubChannelLiveRow({
      posId: row.posId,
      channel: "grab",
      name: liveName || row.name,
      price: livePrice,
      scannedAt,
      externalId: row.grabId,
      source: "apply",
      targetPrice: row.target,
      applyStatus: nameOk ? "aligned_match" : "aligned_mismatch",
      applyNote: hubNote,
    });
    await writeMenuItemHubNote(row.posId, hubNote);
    log.items.push({
      ...row,
      renamed,
      ticks,
      liveName,
      livePrice,
      status: nameOk ? "aligned_match" : "aligned_mismatch",
    });
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  }
  console.log(`→ ${LOG}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message || e);
    process.exit(1);
  });
