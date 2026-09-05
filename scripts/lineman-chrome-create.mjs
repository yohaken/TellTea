#!/usr/bin/env node
/**
 * Create missing LINE MAN (Wongnai) menus by cloning same-category sibling settings.
 * Only name / photo / price change. Option groups + category come from POS, checked
 * against an exact-matched sibling already on LINE MAN in the same category+mode.
 *
 *   node scripts/lineman-chrome-create.mjs --dry-run
 *   node scripts/lineman-chrome-create.mjs --dry-run --notes-only
 *   node scripts/lineman-chrome-create.mjs --apply --limit=1
 *   node scripts/lineman-chrome-create.mjs --apply --limit=1 --only=ไข่มุก
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
  findWongnaiTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  MENU_URL,
  editUrl,
  listWongnaiMenuItems,
  readWongnaiMenuItem,
  setDeliveryOnlyOnTab,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const SCAN = join(DATA, "lineman-live-scan.json");
const PLAN = join(DATA, "lineman-create-plan.json");
const LOG = join(DATA, "lineman-create-log.json");
const CREATE_URL = "https://merchant.wongnai.com/businesses/2688343/menu/create";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply || args.includes("--dry-run");
const notesOnly = args.includes("--notes-only");
const noPhoto = args.includes("--no-photo") || !args.includes("--photo");
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();

/** Always re-find Wongnai — Chrome window numbers change when focus moves. */
function tab() {
  return findWongnaiTab();
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

function fold(s) {
  return normName(s).replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง");
}

function isCreateNote(s) {
  return /สร้างเมนู\s*(lineman|ไลน์แมน)/i.test(s || "");
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

async function loadContext() {
  const db = await getSeedDb();
  const [settingsSnap, itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const linemanRule = settings.channels?.lineman || { mode: "gp", value: 30 };
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
      optionNames: optionGroupIds
        .map((id) => groups.get(id)?.name)
        .filter(Boolean),
      imageUrl: data.imageUrl || "",
      hubNote: data.hubNote || "",
      recommended: !!data.recommended,
    };
  });
  if (!existsSync(SCAN)) throw new Error("Missing lineman-live-scan.json — สแกน LINE MAN ก่อน");
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const lmItems = (scan.items || []).filter((x) => x.name && x.id);
  const lmByName = new Map(lmItems.map((x) => [normName(x.name), x]));
  try {
    const live = await listWongnaiMenuItems();
    for (const it of live) {
      const key = normName(it.name);
      if (!key) continue;
      lmByName.set(key, { ...(lmByName.get(key) || {}), ...it });
    }
    console.log(`Wongnai API menus ${live.length} · scan file ${lmItems.length}`);
  } catch (e) {
    console.warn("Wongnai API list skip:", e.message || e);
  }
  return { linemanRule, items, lmItems: [...lmByName.values()], lmByName };
}

function planRow(pos, linemanRule, sibling, lm) {
  const target = applyChannelRule(pos.price, linemanRule);
  return {
    posId: pos.id,
    name: pos.name,
    nameEn: pos.nameEn || "",
    category: pos.categoryName,
    mode: modeKey(pos),
    storePrice: pos.price,
    onlinePrice: target,
    pickupPrice: target,
    offlinePrice: pos.price,
    optionNames: pos.optionNames,
    imageUrl: pos.imageUrl || "",
    recommended: false,
    hubNote: pos.hubNote || "",
    fromNote: isCreateNote(pos.hubNote),
    lmId: lm?.id || "",
    siblingName: sibling?.pos.name || "",
    siblingLmId: sibling?.lm.id || "",
    siblingOptions: sibling?.pos.optionNames || [],
  };
}

function pickSibling(pos, siblingsByKey) {
  const key = `${pos.categoryName}::${modeKey(pos)}`;
  const siblings = siblingsByKey.get(key) || [];
  return (
    siblings.find((s) => {
      const a = [...s.pos.optionNames].map(normName).sort().join("|");
      const b = [...pos.optionNames].map(normName).sort().join("|");
      return a === b;
    }) ||
    siblings[0] ||
    null
  );
}

function buildPlan(ctx) {
  const { linemanRule, items, lmByName } = ctx;
  const eligible = items.filter((i) => i.active && !i.storeOnly);
  const onLm = [];
  const missing = [];
  for (const it of eligible) {
    const hit = lmByName.get(normName(it.name));
    if (hit?.id) onLm.push({ pos: it, lm: hit });
    else missing.push(it);
  }

  const siblingsByKey = new Map();
  for (const row of onLm) {
    const key = `${row.pos.categoryName}::${modeKey(row.pos)}`;
    if (!siblingsByKey.has(key)) siblingsByKey.set(key, []);
    siblingsByKey.get(key).push(row);
  }

  const rows = missing.map((pos) => planRow(pos, linemanRule, pickSibling(pos, siblingsByKey), null));
  const noteExisting = onLm
    .filter(({ pos }) => isCreateNote(pos.hubNote))
    .map(({ pos, lm }) => planRow(pos, linemanRule, pickSibling(pos, siblingsByKey), lm));

  rows.sort((a, b) => {
    if (a.fromNote !== b.fromNote) return a.fromNote ? -1 : 1;
    return a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th");
  });
  noteExisting.sort((a, b) => a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th"));
  return {
    at: new Date().toISOString(),
    linemanRule,
    lmCount: ctx.lmItems.length,
    posDelivery: eligible.length,
    matchedExact: onLm.length,
    missing: rows.length,
    noteExisting: noteExisting.length,
    noteExistingRows: noteExisting,
    rows,
  };
}

function tickCheckbox(label, want) {
  return `
    const want = ${JSON.stringify(want)};
    const label = ${JSON.stringify(label)};
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    const box = boxes.find((el) => {
      const t = (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim().split('\\n')[0];
      return t === label;
    });
    if (!box) return { label, ok: false, error: 'checkbox not found' };
    if (!!box.checked !== !!want) box.click();
    return { label, ok: true, checked: !!box.checked };
  `;
}

async function fillCreateForm(row) {
  const names = js(`(() => {
    const setVal = (el, v) => {
      if (!el) return false;
      el.focus();
      el.select?.();
      const okInsert = document.execCommand('insertText', false, String(v));
      if (!okInsert) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(v) }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      el.blur();
      return true;
    };
    const name = document.querySelector('#name, input[name="name"]');
    const nameTh = document.querySelector('#nameTh, input[name="nameTh"]');
    const nameEn = document.querySelector('#nameEn, input[name="nameEn"]');
    const online = document.querySelector('#onlinePrice');
    const pickup = document.querySelector('#selfPickUpPrice');
    const offline = document.querySelector('#offlinePrice');
    const okName = setVal(name, ${JSON.stringify(row.name)});
    setVal(nameTh, ${JSON.stringify(row.name)});
    if (${JSON.stringify(row.nameEn)}) setVal(nameEn, ${JSON.stringify(row.nameEn)});
    const okOnline = setVal(online, ${JSON.stringify(String(row.onlinePrice))});
    setVal(pickup, ${JSON.stringify(String(row.pickupPrice))});
    setVal(offline, ${JSON.stringify(String(row.offlinePrice))});
    return JSON.stringify({
      okName, okOnline,
      name: name?.value || '',
      online: online?.value || '',
      pickup: pickup?.value || '',
      offline: offline?.value || '',
    });
  })()`);

  const ticks = [];
  for (const opt of row.optionNames) {
    ticks.push(js(`(() => { ${tickCheckbox(opt, true)} return JSON.stringify({ label, ok, checked, error }); })()`));
  }
  ticks.push(js(`(() => { ${tickCheckbox(row.category, true)} return JSON.stringify({ label, ok, checked, error }); })()`));
  const { windowIndex, tabIndex } = tab();
  const channels = setDeliveryOnlyOnTab(tabIndex, windowIndex);
  return { names, ticks, channels };
}

function readFormState() {
  return js(`(() => {
    const parse = (el) => Number(String(el?.value || '').replace(/[฿,\\s]/g, ''));
    const name = document.querySelector('#name, input[name="name"]')?.value || '';
    const nameEn = document.querySelector('#nameEn, input[name="nameEn"]')?.value || '';
    const online = parse(document.querySelector('#onlinePrice'));
    const pickup = parse(document.querySelector('#selfPickUpPrice'));
    const offline = parse(document.querySelector('#offlinePrice'));
    const checked = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((el) => el.checked)
      .map((el) => (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim().split('\\n')[0])
      .filter((t) => t && !['เดลิเวอรี', 'รับที่ร้าน', 'หน้าร้าน', 'เลือกสินค้านี้เป็นสินค้าแนะนำของร้าน'].includes(t) && t.length < 60);
    const imgs = [...document.querySelectorAll('img')]
      .map((i) => i.src)
      .filter((s) => s && /lmwn-img|line-scdn|blob:/.test(s));
    const m = location.href.match(/menu\\/(0[a-zA-Z0-9]+)\\/edit/);
    return JSON.stringify({
      url: location.href,
      id: m ? m[1] : null,
      name,
      nameEn,
      online,
      pickup,
      offline,
      checked,
      hasPhoto: imgs.length > 0,
      photoSrc: imgs[0] || '',
    });
  })()`);
}

async function findCreatedOnList(name, category) {
  go(MENU_URL);
  await sleep(3500);
  if (category) {
    js(`(() => {
      const want = ${JSON.stringify(category)};
      const fold = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const nodes = [...document.querySelectorAll('[class*="MuiAccordionSummary"], button, [role="button"]')];
      const hit = nodes.find((el) => fold(el.innerText).split('\\n')[0] === want);
      if (hit) hit.click();
      return hit ? 'clicked' : 'no-cat';
    })()`);
    await sleep(900);
  }
  return js(`(() => {
    const want = ${JSON.stringify(normName(name))};
    const fold = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    for (const a of document.querySelectorAll('a')) {
      if (!/\\/menu\\/0[a-zA-Z0-9]+/.test(a.href || '')) continue;
      if (fold(a.innerText).split('\\n')[0] !== want) continue;
      const m = a.href.match(/menu\\/(0[a-zA-Z0-9]+)/);
      return JSON.stringify({ id: m ? m[1] : null, href: a.href, text: fold(a.innerText).split('\\n')[0] });
    }
    return JSON.stringify({ id: null });
  })()`);
}

function appendScanItem(item) {
  if (!existsSync(SCAN) || !item?.id) return;
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const items = Array.isArray(scan.items) ? scan.items : [];
  const i = items.findIndex((x) => x.id === item.id || normName(x.name) === normName(item.name));
  const row = {
    id: item.id,
    name: item.name,
    href: item.href || editUrl(item.id),
    listPrice: item.listPrice,
    category: item.category || "",
    offlinePrice: item.offlinePrice ?? null,
    prices: item.prices || [],
  };
  if (i >= 0) items[i] = { ...items[i], ...row };
  else items.push(row);
  scan.items = items;
  scan.count = items.length;
  scan.scannedAt = new Date().toISOString();
  writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
}

function compareLive(row, live) {
  const optWant = new Set(row.optionNames.map(fold));
  const checked = (live.checked || live.optionNames || []).map(fold);
  const optGot = checked.filter((t) => optWant.has(t) || t === normName(row.category));
  const missingOpts = [...optWant].filter((t) => !checked.includes(t));
  const catOk = live.checked
    ? (live.checked || []).some((t) => namesEqual(t, row.category))
    : true;
  const nameOk = normName(live.name) === normName(row.name);
  const priceOk = Number(live.online) === Number(row.onlinePrice);
  const pickupOff = live.selfPickupAvailable === false;
  const offlineOff = live.offlineAvailable === false;
  const mismatches = [];
  if (!nameOk) mismatches.push(`ชื่อ ${live.name || "—"}`);
  if (!priceOk) mismatches.push(`เดลิเวอรี ${live.online}≠${row.onlinePrice}`);
  if (live.selfPickupAvailable === true) mismatches.push("ยังเปิดรับที่ร้าน");
  if (live.offlineAvailable === true) mismatches.push("ยังเปิดหน้าร้าน");
  if (!catOk) mismatches.push(`หมวดไม่มี ${row.category}`);
  if (missingOpts.length) mismatches.push(`ตัวเลือกขาด ${missingOpts.join(",")}`);
  return {
    nameOk,
    priceOk,
    pickupOff,
    offlineOff,
    catOk,
    missingOpts,
    match: mismatches.length === 0,
    mismatches,
  };
}

function fillPrices(row) {
  return js(`(() => {
    const setVal = (el, v) => {
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.focus();
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    };
    const parse = (el) => Number(String(el?.value || '').replace(/[฿,\\s]/g, ''));
    const online = document.querySelector('#onlinePrice');
    const pickup = document.querySelector('#selfPickUpPrice');
    const offline = document.querySelector('#offlinePrice');
    setVal(online, ${JSON.stringify(String(row.onlinePrice))});
    setVal(pickup, ${JSON.stringify(String(row.pickupPrice))});
    setVal(offline, ${JSON.stringify(String(row.offlinePrice))});
    return JSON.stringify({
      online: parse(online),
      pickup: parse(pickup),
      offline: parse(offline),
      url: location.href,
    });
  })()`);
}

async function alignExisting(row, existing) {
  console.log(`  already on LM ${existing.id} — align prices`);
  go(editUrl(existing.id));
  await sleep(3500);
  const page = js(`(() => JSON.stringify({
    url: location.href,
    onEdit: /\\/menu\\/0[a-zA-Z0-9]+\\/edit/.test(location.href),
  }))()`);
  if (!page?.onEdit) return { status: "edit_fail", createdId: existing.id, live: null };
  const filled = fillPrices(row);
  console.log("  prices", JSON.stringify(filled));
  const ticks = [];
  for (const opt of row.optionNames) {
    ticks.push(js(`(() => { ${tickCheckbox(opt, true)} return JSON.stringify({ label, ok, checked, error }); })()`));
  }
  if (row.category) {
    ticks.push(js(`(() => { ${tickCheckbox(row.category, true)} return JSON.stringify({ label, ok, checked, error }); })()`));
  }
  const { windowIndex, tabIndex } = tab();
  const channels = setDeliveryOnlyOnTab(tabIndex, windowIndex);
  console.log("  channels", JSON.stringify(channels));
  const saved = await saveCreate();
  console.log("  ticks", JSON.stringify(ticks));
  console.log("  save", JSON.stringify(saved.after));
  if (saved.after?.onEdit || saved.after?.stillCreate) {
    await sleep(1200);
    const again = await saveCreate();
    console.log("  save-retry", JSON.stringify(again.after));
  }
  await sleep(4000);
  let live = null;
  try {
    live = await readWongnaiMenuItem(existing.id);
  } catch (e) {
    live = readFormState();
    live = { ...(live || {}), error: e.message };
  }
  return { status: "aligned", createdId: existing.id, filled: { names: filled, ticks }, saved, live };
}

async function saveCreate() {
  const clicked = js(`(() => {
    const url = location.href;
    if (!url.includes('merchant.wongnai.com')) return JSON.stringify({ error: 'wrong tab', url });
    const buttons = [...document.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === 'บันทึก' && !b.disabled);
    const btn = buttons.find((b) => b.type === 'submit') || buttons[0];
    if (!btn) return JSON.stringify({ error: 'no save' });
    btn.click();
    return JSON.stringify({ saved: true, n: buttons.length });
  })()`);
  await sleep(5000);
  for (let i = 0; i < 3; i++) {
    const extra = js(`(() => {
      if (!location.href.includes('merchant.wongnai.com')) return 'wrong-tab';
      for (const btn of document.querySelectorAll('button')) {
        const t = (btn.innerText || '').trim();
        if (t === 'ยืนยัน' || t === 'ตกลง' || t === 'OK') { btn.click(); return t; }
      }
      return 'none';
    })()`);
    if (extra === "none" || extra === "wrong-tab") break;
    await sleep(1200);
  }
  await sleep(2500);
  const after = js(`(() => {
    const url = location.href;
    const text = document.body.innerText || '';
    const onWn = url.includes('merchant.wongnai.com');
    const genericErr = /เกิดข้อผิดพลาดบางอย่าง/.test(text);
    const blocked = onWn && /ไม่สามารถสร้าง|โควตาเต็ม|จำนวนเมนูสูงสุด|เมนูเต็ม/.test(text);
    const m = url.match(/menu\\/(0[a-zA-Z0-9]+)\\/edit/);
    return JSON.stringify({
      url,
      createdId: m ? m[1] : null,
      onEdit: onWn && /\\/edit/.test(url),
      backOnList: onWn && /\\/menu\\/?$/.test(url) && !/create/.test(url),
      stillCreate: onWn && /\\/create/.test(url),
      blocked,
      genericErr,
      popup: [...document.querySelectorAll('[role="dialog"]')].map((el) => (el.innerText || '').trim()).join(' | ').slice(0, 400),
    });
  })()`);
  return { clicked, after };
}

async function main() {
  const ctx = await loadContext();
  const plan = buildPlan(ctx);
  let rows = plan.rows;
  if (notesOnly) {
    rows = [...(plan.noteExistingRows || []), ...plan.rows.filter((r) => r.fromNote)];
  }
  if (only) {
    const pool = [...(plan.noteExistingRows || []), ...plan.rows, ...rows];
    const seen = new Set();
    const extra = [];
    for (const it of ctx.items) {
      if (!fold(it.name).includes(fold(only))) continue;
      const lm = ctx.lmByName.get(normName(it.name));
      extra.push(
        planRow(it, plan.linemanRule, null, lm?.id ? lm : null),
      );
    }
    rows = [...pool, ...extra].filter((r) => {
      if (!fold(r.name).includes(fold(only))) return false;
      if (seen.has(r.posId)) return false;
      seen.add(r.posId);
      return true;
    });
  }
  if (limit > 0) rows = rows.slice(0, limit);

  writeFileSync(PLAN, JSON.stringify({ ...plan, selected: rows.length, rows: plan.rows }, null, 2) + "\n");
  console.log(
    `LM ${plan.lmCount} · POS delivery ${plan.posDelivery} · exact ${plan.matchedExact} · missing ${plan.missing} · note-existing ${plan.noteExisting || 0} · selected ${rows.length}`,
  );
  for (const r of rows) {
    console.log(
      `${r.fromNote ? "NOTE" : "    "} [${r.category} / ${r.mode}] ${r.name}  store ${r.storePrice} → L ${r.onlinePrice}` +
        ` · opts ${r.optionNames.join(" | ") || "(none)"}` +
        ` · ${r.lmId ? "ALIGN" : "CREATE"}` +
        ` · sibling ${r.siblingName || "—"}`,
    );
  }

  if (dryRun && !apply) {
    console.log("dry-run — ไม่สร้างบน Wongnai");
    return;
  }
  if (!rows.length) {
    console.log("ไม่มีรายการให้สร้าง");
    return;
  }

  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { items: [] };
  for (const row of rows) {
    const existingId = row.lmId || ctx.lmByName.get(normName(row.name))?.id || "";
    let filled = null;
    let saved = { after: null };
    let createdId = existingId || null;
    let live = null;
    let aligned = false;

    if (existingId) {
      console.log(`\nALIGN ${row.name} ${existingId}`);
      const result = await alignExisting(row, { id: existingId });
      filled = result.filled;
      saved = result.saved || { after: result.status };
      createdId = result.createdId || existingId;
      live = result.live;
      aligned = true;
    } else {
      console.log(`\nCREATE ${row.name}`);
      go(CREATE_URL);
      await sleep(4000);
      const page = js(`(() => JSON.stringify({ url: location.href, create: location.href.includes('/create') }))()`);
      if (!page?.create) {
        go(MENU_URL);
        await sleep(2500);
        js(`(() => {
          const btn = [...document.querySelectorAll('a, button')].find((el) => (el.innerText || '').trim() === 'สร้างสินค้า');
          if (btn) btn.click();
          return 'ok';
        })()`);
        await sleep(3500);
      }
      filled = await fillCreateForm(row);
      console.log("  fill", JSON.stringify(filled.names));
      console.log("  ticks", JSON.stringify(filled.ticks));
      saved = await saveCreate();
      console.log("  save", JSON.stringify(saved.after));

      createdId = saved.after?.createdId || null;
      if (!createdId && !saved.after?.blocked) {
        await sleep(1500);
        const found = await findCreatedOnList(row.name, row.category);
        createdId = found?.id || null;
        console.log("  list lookup", JSON.stringify(found));
      }

      if (createdId) {
        try {
          live = await readWongnaiMenuItem(createdId);
        } catch {
          go(editUrl(createdId));
          await sleep(3500);
          live = readFormState();
        }
      } else if (saved.after?.onEdit) {
        live = readFormState();
        createdId = live?.id || createdId;
      }
    }

    const cmp = live ? compareLive(row, live) : { match: false, mismatches: ["ไม่เจอหน้าแก้ไข"] };
    const blocked = !!saved.after?.blocked;
    const status = blocked
      ? "quota_or_blocked"
      : createdId
        ? cmp.match
          ? aligned
            ? "aligned_match"
            : "created_match"
          : aligned
            ? "aligned_mismatch"
            : "created_mismatch"
        : saved.after?.genericErr
          ? "save_error"
          : "unknown";

    console.log("  live", JSON.stringify(live));
    console.log("  verify", cmp.match ? "MATCH" : `DIFF ${cmp.mismatches.join(" · ")}`);

    const scannedAt = new Date().toISOString();
    const hubNote = cmp.match
      ? `L:ตรงแล้ว ${row.onlinePrice} ✓`
      : `L:${aligned ? "มีแล้ว" : "สร้างแล้ว"} ${live?.online ?? "?"} · ไม่ตรง ${cmp.mismatches.join(" · ")}`.slice(0, 180);

    if (createdId) {
      appendScanItem({
        id: createdId,
        name: live?.name || row.name,
        listPrice: Number.isFinite(live?.online) ? live.online : row.onlinePrice,
        category: row.category,
        offlinePrice: Number.isFinite(live?.offline) ? live.offline : row.offlinePrice,
        prices: [live?.online, live?.pickup, live?.offline],
      });
      await writeHubChannelLiveRow({
        posId: row.posId,
        channel: "lineman",
        name: live?.name || row.name,
        price: Number.isFinite(live?.online) ? live.online : null,
        scannedAt,
        externalId: createdId,
        source: "apply",
        targetPrice: row.onlinePrice,
        applyStatus: status,
        applyNote: hubNote,
      });
      await writeMenuItemHubNote(row.posId, hubNote);
    }

    const entry = {
      at: scannedAt,
      ...row,
      filled,
      saved,
      createdId,
      live,
      cmp,
      status,
    };
    log.items.push(entry);
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");

    if (status === "quota_or_blocked") {
      console.log("หยุด — โควตาหรือบล็อกจาก Wongnai");
      break;
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
