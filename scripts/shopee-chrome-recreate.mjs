#!/usr/bin/env node
/**
 * Recreate a Shopee dish that cannot be price-edited (phantom promo).
 *
 * Quota is full: CREATE-then-DELETE will fail. Order is always:
 *   1. Snapshot (catalog + POS photo + POS option groups) — abort if incomplete
 *   2. DELETE the old dish
 *   3. CREATE the same dish at the hub target price
 *   4. Bind the same option groups (POS names → existing Shopee groups)
 *
 * Promo option groups (ชื่อขึ้นต้นด้วย «โปรโมชั่น») are NOT copied — that is
 * the lock we are escaping. If create fails after delete, retry from the
 * snapshot file; do not invent a second delete.
 *
 *   node scripts/shopee-chrome-recreate.mjs
 *   node scripts/shopee-chrome-recreate.mjs --dish=2035950934172160
 *   node scripts/shopee-chrome-recreate.mjs --apply --dish=2035950934172160
 *   node scripts/shopee-chrome-recreate.mjs --apply --dish=ID --hide-old --free-slot
 *   node scripts/shopee-chrome-recreate.mjs --delay --no-ui
 *   node scripts/shopee-chrome-recreate.mjs --delay --apply --no-ui
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";
import { normName } from "./lib/grab-csv.mjs";
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
const CLASSIFY = join(DATA, "shopee-block-classify.json");
const SCAN = join(DATA, "shopee-live-scan.json");
const TRACKER = join(DATA, "shopee-price-tracker.json");
const DISH_IDS = join(DATA, "shopee-dish-ids.json");
const PLAN = join(DATA, "shopee-recreate-plan.json");
const LOG = join(DATA, "shopee-recreate-log.json");
const SNAP_DIR = join(DATA, "shopee-recreate-snapshots");
const API = "https://foody.shopee.co.th/api/seller/store/dishes";
const OG_API = "https://foody.shopee.co.th/api/seller/store/option-groups";
const MICROS = 100_000;
const STORE_QS = "storeId=10212109&defaultTab=sf";
const LIST_URL = `https://partner.shopee.co.th/shopee-pos/menu-management?${STORE_QS}`;
const PROMO_RE = /^โปรโมชั่น/;
const QUOTA_RE =
  /limit|quota|สูงสุด|เต็ม|ไม่สามารถสร้าง|exceed|too many|จำนวน.*(เต็ม|สูงสุด)|reach|maximum/i;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply || args.includes("--dry-run");
const skipUi = args.includes("--no-ui");
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).trim();
const retryId = (args.find((a) => a.startsWith("--retry=")) || "").slice(8).trim();
const hideOld = args.includes("--hide-old");
const freeSlot = args.includes("--free-slot");
const fromDelay = args.includes("--delay");
const slotArgs = (args.find((a) => a.startsWith("--slots=")) || "")
  .slice(8)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const usedSlotIds = new Set();
const HIDDEN_PREFIX = "ลบไม่ได้ ";
const SLOT_CAT_RE = /^\* กาแฟสด/;
const SLOT_SKIP_NAME_RE = /นมร้อน/;
const dishArgs = args
  .filter((a) => a.startsWith("--dish="))
  .flatMap((a) => a.slice(7).split(","))
  .map((s) => s.trim())
  .filter(Boolean);

function fold(s) {
  return normName(s)
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง")
    .replace(/\u00a0/g, " ");
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

function isPromoName(name) {
  return PROMO_RE.test(String(name || "").trim());
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
  const hasBody = body != null;
  return js(`(() => {
    const here = location.href;
    if (!here.includes('partner.shopee') && !here.includes('foody.shopee')) {
      return JSON.stringify({ error: 'wrong-tab', url: here });
    }
    try {
      const x = new XMLHttpRequest();
      x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      ${hasBody ? `x.setRequestHeader('Content-Type', 'application/json');
      x.send(${JSON.stringify(JSON.stringify(body))});` : "x.send(null);"}
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

function snapPath(dishId) {
  return join(SNAP_DIR, `${dishId}.json`);
}

function mapOptionGroupIds(optionNames, shopeeGroups) {
  const out = [];
  for (const name of optionNames) {
    const hit = shopeeGroups.find((g) => fold(g.name) === fold(name));
    out.push(hit ? { name, id: hit.id } : { name, id: null });
  }
  return out;
}

async function scrapeCheckedGroups(dishId) {
  go(editUrl(dishId));
  await sleep(2800);
  const ready = js(`JSON.stringify({
    url: location.href,
    onEdit: location.href.includes('/dish/edit')
  })`);
  if (!ready?.onEdit) {
    return { ok: false, reason: "edit-not-ready", url: ready?.url, ticked: [] };
  }
  const ticked = js(`(() => {
    const names = [];
    for (const tr of document.querySelectorAll('tr')) {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!cb || !cb.checked) continue;
      const tx = (tr.innerText || '').trim();
      if (!tx) continue;
      const first = tx.split('\\n')[0].trim();
      if (!first || first === 'ชื่อกลุ่มตัวเลือก' || /^เลือก/.test(first)) continue;
      names.push(first);
    }
    return JSON.stringify({ names });
  })()`);
  return { ok: true, ticked: ticked?.names || [] };
}

function completenessIssues(row) {
  const issues = [];
  if (!row.catalogId) issues.push("ไม่มี catalog_id");
  if (!row.catalogName) issues.push("ไม่มี catalog_name");
  if (!row.posImageUrl) issues.push("ไม่มีรูปจากเมนูหลังร้าน");
  if (!row.posImageOk) issues.push("ดึงรูปเมนูหลังร้านไม่ได้");
  if (row.missingGroups.length) {
    issues.push("แมปตัวเลือกไม่ครบ: " + row.missingGroups.join(", "));
  }
  if (row.liveExtraNonPromo.length) {
    issues.push("บน Shopee มีตัวเลือกที่ POS ไม่มี: " + row.liveExtraNonPromo.join(", "));
  }
  if (row.posMissingOnLive.length) {
    issues.push("บน Shopee ไม่ได้ติ๊กตาม POS: " + row.posMissingOnLive.join(", "));
  }
  if (row.uiCheck && !row.uiCheck.ok) {
    issues.push("อ่านหน้าแก้ตัวเลือกไม่สำเร็จ: " + (row.uiCheck.reason || "unknown"));
  }
  if (
    row.liveOptionGroupCount != null &&
    row.optionGroupIds.length &&
    row.liveNonPromoTicked.length &&
    row.liveNonPromoTicked.length !== row.optionGroupIds.length
  ) {
    issues.push(
      `จำนวนตัวเลือกไม่ตรง POS ${row.optionGroupIds.length} vs live ติ๊ก (ไม่นับโปร) ${row.liveNonPromoTicked.length}`,
    );
  }
  return issues;
}

async function loadPosAndHub() {
  const db = await getSeedDb();
  const [settingsSnap, itemsSnap, catsSnap, groupsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuItems")),
    getDocs(collection(db, "menuCategories")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const shopeeRule = settings.channels?.shopee || { mode: "offset", value: 0 };
  const itemOverrides = settings.itemOverrides || {};
  const cats = new Map();
  for (const d of catsSnap.docs) cats.set(d.id, d.data()?.name || d.id);
  const groups = new Map();
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    groups.set(d.id, { id: d.id, name: g.name || "", active: g.active !== false });
  }
  const items = itemsSnap.docs.map((d) => {
    const data = d.data() || {};
    const optionGroupIds = Array.isArray(data.optionGroupIds) ? data.optionGroupIds : [];
    return {
      id: d.id,
      name: data.name || "",
      price: Number(data.price) || 0,
      active: data.active !== false,
      storeOnly: data.storeOnly === true || isStoreOnlyName(data.name || ""),
      categoryName: cats.get(data.categoryId) || "",
      optionNames: optionGroupIds.map((id) => groups.get(id)?.name).filter(Boolean),
      description: data.description || "",
      imageUrl: String(data.imageUrl || "").trim(),
      hubNote: data.hubNote || "",
    };
  });
  return { shopeeRule, itemOverrides, items };
}

function hubTarget(pos, shopeeRule, itemOverrides) {
  const override = itemOverrides[pos.id]?.shopee;
  const rule = override || shopeeRule;
  return applyChannelRule(Math.max(0, Number(pos.price) || 0), rule);
}

function loadCandidates() {
  if (!existsSync(CLASSIFY)) throw new Error("Missing shopee-block-classify.json");
  const classify = JSON.parse(readFileSync(CLASSIFY, "utf8"));
  if (fromDelay) return classify.delayUnknown || [];
  return classify.recreateCandidates || [];
}

function selectCandidates(candidates) {
  let rows = candidates;
  if (retryId) {
    rows = rows.filter((r) => String(r.dishId) === retryId);
    if (!rows.length) {
      throw new Error("retry dishId not in recreateCandidates: " + retryId);
    }
  }
  if (dishArgs.length) {
    const want = new Set(dishArgs.map(String));
    rows = rows.filter((r) => want.has(String(r.dishId)));
  }
  if (only) {
    const needle = fold(only);
    const exact = rows.filter((r) => fold(r.name) === needle);
    const matched = exact.length === 1 ? exact : rows.filter((r) => fold(r.name).includes(needle));
    if (matched.length !== 1) {
      throw new Error(
        `--only=${only} ตรง ${matched.length} รายการ — ใช้ --dish=ID หรือชื่อเต็ม: ` +
          matched.map((m) => `${m.name} (${m.dishId})`).join(" · "),
      );
    }
    rows = matched;
  }
  if (limit > 0) rows = rows.slice(0, limit);
  return rows;
}

function createDish(row, picture) {
  const pic = picture || undefined;
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
      picture: pic,
      picture_type: pic ? 0 : undefined,
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
  return xhrJson("POST", `${API}/${dishId}`, { dish });
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
  await sleep(2800);
  const ready = js(`JSON.stringify({
    url: location.href,
    onEdit: location.href.includes('/dish/edit')
  })`);
  if (!ready?.onEdit) return { ok: false, reason: "edit-not-ready", url: ready?.url };
  js(`(() => {
    const names = ${JSON.stringify(optionNames)};
    const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim().toLowerCase();
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
  await sleep(800);
  const ticked = js(`(() => {
    const names = ${JSON.stringify(optionNames)};
    const fold = (s) => String(s || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim().toLowerCase();
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
  const save = clickPageSave();
  await sleep(800);
  const overwrite = confirmOverwriteIfNeeded();
  await sleep(4000);
  return { ok: !!save?.ok && !(ticked?.missed || []).length, ticked, save, overwrite };
}

async function fetchPosImageMeta(imageUrl) {
  if (!imageUrl) return { ok: false, bytes: 0, file: "" };
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return { ok: false, bytes: 0, file: imageUrl.split("/").pop() || "", status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: buf.length > 1000,
      bytes: buf.length,
      file: imageUrl.split("/").pop() || "",
      contentType: res.headers.get("content-type") || "",
    };
  } catch (e) {
    return { ok: false, bytes: 0, file: "", error: String(e?.message || e) };
  }
}

function photoPageState() {
  return js(`(() => {
    if (!location.href.includes('partner.shopee')) return JSON.stringify({ error: 'wrong-tab', url: location.href });
    const crop = document.querySelector('[class*=crop_modal]');
    const preview = [...document.querySelectorAll('img')]
      .map((i) => i.src)
      .filter((s) => /susercontent|th-11134505|image_preview|preview_image|image_upload|data:image/i.test(s || ''));
    return JSON.stringify({
      url: location.href,
      crop: !!crop,
      preview,
      files: document.querySelector('#imgFileInput')?.files?.length || 0,
    });
  })()`);
}

function cancelCropIfOpen() {
  return js(`(() => {
    const modal = document.querySelector('[class*=crop_modal]');
    if (!modal) return JSON.stringify({ ok: true, cancelled: false });
    const btn = [...modal.querySelectorAll('button')].find((b) => /ยกเลิก|Cancel/i.test((b.innerText || '').trim()));
    if (btn) btn.click();
    return JSON.stringify({ ok: !!btn, cancelled: true });
  })()`);
}

async function posImageToJpegB64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) return { ok: false, reason: "fetch", status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(tmpdir(), "telltea-shopee");
  mkdirSync(dir, { recursive: true });
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  if (!jpeg && !png) return { ok: false, reason: "not-image", magic: [buf[0], buf[1]] };
  let out = join(dir, "pos.jpg");
  if (jpeg) {
    writeFileSync(out, buf);
  } else {
    const pngPath = join(dir, "pos.png");
    writeFileSync(pngPath, buf);
    execFileSync("sips", ["-s", "format", "jpeg", pngPath, "--out", out], { stdio: "pipe" });
  }
  execFileSync("sips", ["-Z", "800", "-s", "format", "jpeg", out, "--out", out], { stdio: "pipe" });
  const jpegBuf = readFileSync(out);
  return { ok: jpegBuf.length > 1000, b64: jpegBuf.toString("base64"), bytes: jpegBuf.length };
}

function setJpegOnEdit(b64) {
  return js(`(() => {
    if (!location.href.includes('partner.shopee')) return JSON.stringify({ error: 'wrong-tab', url: location.href });
    try {
      const input = document.querySelector('#imgFileInput');
      if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
      const bin = atob(${JSON.stringify(b64)});
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'pos.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      return JSON.stringify({ ok: input.files.length === 1, files: input.files.length, size: file.size });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  })()`);
}

function clickCropSave() {
  return js(`(() => {
    if (!location.href.includes('partner.shopee')) return JSON.stringify({ error: 'wrong-tab', url: location.href });
    const modal = document.querySelector('[class*=crop_modal]');
    if (!modal) return JSON.stringify({ ok: false, reason: 'no-crop' });
    const btn = [...modal.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'บันทึก');
    if (!btn) return JSON.stringify({ ok: false, reason: 'no-crop-save' });
    btn.click();
    return JSON.stringify({ ok: true });
  })()`);
}

function clickPageSave() {
  return js(`(() => {
    if (!location.href.includes('partner.shopee')) return JSON.stringify({ error: 'wrong-tab', url: location.href });
    if (document.querySelector('[class*=crop_modal]')) return JSON.stringify({ ok: false, reason: 'crop-still-open' });
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === 'บันทึก');
    const btn = btns[btns.length - 1];
    if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
    btn.click();
    return JSON.stringify({ ok: true, n: btns.length });
  })()`);
}

function pictureIdFromPreview(preview) {
  for (const src of preview || []) {
    const m = String(src).match(/(th-11134505-[a-z0-9-]+)/i);
    if (m) return m[1].replace(/\.webp$/i, "");
  }
  return "";
}

async function waitEditReady(dishId) {
  const t0 = Date.now();
  while (Date.now() - t0 < 18000) {
    const st = js(`JSON.stringify({
      url: location.href,
      ok: location.href.includes('/dish/edit') && location.href.includes(${JSON.stringify(dishId)}) && !!document.querySelector('#imgFileInput')
    })`);
    if (st?.ok) return true;
    await sleep(400);
  }
  return false;
}

async function uploadPosPhoto(dishId, imageUrl, oldPicture, optionGroupIds = []) {
  if (!imageUrl) return { ok: false, reason: "no-pos-image" };
  const jpeg = await posImageToJpegB64(imageUrl);
  if (!jpeg?.ok) return { ok: false, reason: "jpeg", jpeg };
  go(editUrl(dishId));
  await sleep(2800);
  if (!(await waitEditReady(dishId))) return { ok: false, reason: "edit-not-ready" };
  const leftover = photoPageState();
  if (leftover?.crop) {
    cancelCropIfOpen();
    await sleep(700);
  }
  const set = setJpegOnEdit(jpeg.b64);
  if (!set?.ok || set.files !== 1) return { ok: false, reason: "set-photo", set };
  js(`(() => {
    document.querySelector('#imgFileInput')?.dispatchEvent(new Event('change', { bubbles: true }));
    return 'changed';
  })()`);
  let st = photoPageState();
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    st = photoPageState();
    if (st?.crop) break;
    await sleep(300);
  }
  if (!st?.crop) return { ok: false, reason: "no-crop", set, preview: st?.preview };
  clickCropSave();
  const t1 = Date.now();
  let fromPreview = "";
  while (Date.now() - t1 < 14000) {
    st = photoPageState();
    fromPreview = pictureIdFromPreview(st?.preview);
    if (!st?.crop && fromPreview && fromPreview !== oldPicture) break;
    await sleep(400);
  }
  if (fromPreview && fromPreview !== oldPicture) {
    const got = xhrJson("GET", `${API}/${dishId}`, null);
    const liveDish = got.json?.data?.dish || {};
    const listPrice = Number(liveDish.list_price || liveDish.price || 0);
    const put = xhrJson("POST", `${API}/${dishId}`, {
      dish: {
        ...liveDish,
        id: String(dishId),
        picture: fromPreview,
        picture_type: 0,
        list_price: listPrice,
        price: String(liveDish.price || listPrice),
        ...(optionGroupIds?.length ? { option_group_ids: optionGroupIds } : {}),
      },
    });
    if (put.json?.code === 0) {
      return { ok: true, picture: fromPreview, via: "put", preview: st?.preview };
    }
    return { ok: false, reason: "put", picture: fromPreview, put: put.json };
  }
  return { ok: false, reason: "no-cdn-preview", preview: st?.preview, crop: st?.crop };
}

function slotCandidates(catalogs, skipIds = new Set()) {
  const rows = [];
  for (const cat of catalogs || []) {
    if (!SLOT_CAT_RE.test(cat.name || "")) continue;
    for (const d of cat.dishes || []) {
      const name = d.name || "";
      const id = String(d.id);
      if (skipIds.has(id) || name.startsWith(HIDDEN_PREFIX.trim()) || SLOT_SKIP_NAME_RE.test(name)) continue;
      rows.push({
        id,
        name,
        salesVolume: Number(d.sales_volume || 0),
        catalogName: cat.name || "",
      });
    }
  }
  return rows.sort((a, b) => a.salesVolume - b.salesVolume);
}

function pickFreeSlotDish(catalogs) {
  return slotCandidates(catalogs)[0] || null;
}

function hideLockedDish(liveDish) {
  const name = String(liveDish?.name || "");
  const hiddenName = name.startsWith(HIDDEN_PREFIX.trim()) ? name : HIDDEN_PREFIX + name;
  const listPrice = Number(liveDish.list_price || liveDish.price || 0);
  const dish = {
    ...liveDish,
    name: hiddenName,
    available: false,
    listing_status: 0,
    list_price: listPrice,
    price: String(liveDish.price || listPrice),
  };
  return { hiddenName, put: xhrJson("POST", `${API}/${liveDish.id}`, { dish }) };
}

function remapLocalFiles(oldId, newId, name, price, catalogName, { keepOld = false } = {}) {
  if (existsSync(SCAN)) {
    const scan = JSON.parse(readFileSync(SCAN, "utf8"));
    const items = Array.isArray(scan.items) ? scan.items : [];
    const next = {
      name,
      listPrice: price,
      displayPrice: price,
      prices: [price],
      dishId: String(newId),
      category: catalogName,
      visible: "แสดงเมนู",
      stock: "พร้อมจำหน่าย",
    };
    const byNew = items.findIndex((x) => String(x.dishId) === String(newId));
    const byOld = items.findIndex((x) => String(x.dishId) === String(oldId));
    const byName = items.findIndex((x) => fold(x.name) === fold(name) && String(x.dishId) !== String(oldId));
    if (keepOld) {
      const i = byNew >= 0 ? byNew : byName;
      if (i >= 0) items[i] = { ...items[i], ...next };
      else items.push(next);
    } else {
      const i = byOld >= 0 ? byOld : byName >= 0 ? byName : byNew;
      if (i >= 0) items[i] = { ...items[i], ...next };
      else items.push(next);
    }
    scan.items = items;
    scan.count = items.length;
    scan.scannedAt = new Date().toISOString();
    writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
  }
  if (existsSync(TRACKER)) {
    const tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
    const items = tracker.items || {};
    const prev = items[String(oldId)] || items[name] || {};
    if (!keepOld) delete items[String(oldId)];
    items[String(newId)] = {
      ...prev,
      name,
      dishId: String(newId),
      targetPrice: price,
      currentLive: price,
      cooldownUntil: null,
      lastVerifiedChangeAt: new Date().toISOString(),
      previousDishId: String(oldId),
    };
    tracker.items = items;
    tracker.updatedAt = new Date().toISOString();
    writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
  }
  if (existsSync(DISH_IDS)) {
    const ids = JSON.parse(readFileSync(DISH_IDS, "utf8"));
    if (ids.byName && typeof ids.byName === "object") ids.byName[name] = String(newId);
    ids.updatedAt = new Date().toISOString();
    writeFileSync(DISH_IDS, JSON.stringify(ids, null, 2) + "\n");
  }
}

async function snapshotRow(cand, ctx) {
  const { items, shopeeRule, itemOverrides, optionGroups } = ctx;
  const pos = items.find((i) => i.id === cand.posId) || items.find((i) => fold(i.name) === fold(cand.name));
  if (!pos) {
    return {
      ...cand,
      ready: false,
      issues: ["ไม่เจอเมนูใน POS"],
    };
  }
  const got = xhrJson("GET", `${API}/${cand.dishId}`, null);
  const dish = got.json?.data?.dish;
  if (got.json?.code !== 0 || !dish) {
    return {
      ...cand,
      posId: pos.id,
      ready: false,
      issues: [`GET dish ล้มเหลว: ${got.json?.msg || got.raw || got.status}`],
    };
  }
  const mapped = mapOptionGroupIds(pos.optionNames, optionGroups);
  const optionGroupIds = mapped.filter((m) => m.id).map((m) => m.id);
  const missingGroups = mapped.filter((m) => !m.id).map((m) => m.name);
  let uiCheck = { ok: true, skipped: true, ticked: [] };
  if (!skipUi) {
    uiCheck = await scrapeCheckedGroups(cand.dishId);
  }
  const ticked = uiCheck.ticked || [];
  const livePromoTicked = ticked.filter(isPromoName);
  const liveNonPromoTicked = ticked.filter((n) => !isPromoName(n));
  const posFold = new Set(pos.optionNames.map(fold));
  const liveNonPromoFold = new Set(liveNonPromoTicked.map(fold));
  const liveExtraNonPromo = skipUi
    ? []
    : liveNonPromoTicked.filter((n) => !posFold.has(fold(n)));
  const posMissingOnLive = skipUi
    ? []
    : pos.optionNames.filter((n) => !liveNonPromoFold.has(fold(n)));
  const target = cand.target ?? hubTarget(pos, shopeeRule, itemOverrides);
  const posImage = await fetchPosImageMeta(pos.imageUrl);
  const row = {
    name: dish.name || cand.name,
    dishId: String(dish.id || cand.dishId),
    posId: pos.id,
    posName: pos.name,
    posCategory: pos.categoryName,
    live: bahtFromMicros(dish.price ?? dish.list_price),
    target,
    catalogId: String(dish.catalog_id || ""),
    catalogName: dish.catalog_name || "",
    oldPicture: dish.picture || "",
    picture: "",
    posImageUrl: pos.imageUrl || "",
    posImageFile: posImage.file || "",
    posImageBytes: posImage.bytes || 0,
    posImageOk: !!posImage.ok,
    description: dish.description || pos.description || dish.name,
    liveOptionGroupCount: dish.option_group_count ?? null,
    optionNames: pos.optionNames,
    optionGroupIds,
    mapped,
    missingGroups,
    uiCheck,
    livePromoTicked,
    liveNonPromoTicked,
    liveExtraNonPromo,
    posMissingOnLive,
    hubNote: pos.hubNote || "",
  };
  row.issues = completenessIssues(row);
  row.ready = row.issues.length === 0;
  return row;
}

function dishOptionGroups(dishId) {
  const bound = xhrJson("GET", `https://foody.shopee.co.th/api/seller/dishes/${dishId}/option-groups`, null);
  const boundGroups = bound.json?.data?.groups || bound.json?.data?.option_groups || [];
  return Array.isArray(boundGroups) ? boundGroups : [];
}

async function hubWriteSafe(row, note) {
  try {
    await Promise.race([
      writeHubChannelLiveRow(row),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hub-live-timeout")), 15000)),
    ]);
  } catch (e) {
    console.log("hub live skip", e?.message || e);
  }
  try {
    await Promise.race([
      writeMenuItemHubNote(row.posId, note),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hub-note-timeout")), 12000)),
    ]);
  } catch (e) {
    console.log("hub note skip", e?.message || e);
  }
}

async function recreateFromSnapshot(snap) {
  let created = createDish(snap, "");
  if (created.json?.code !== 0) {
    const msg = String(created.json?.msg || created.raw || "");
    if (/picture|รูป|image/i.test(msg) && snap.oldPicture) {
      console.log("create without photo rejected — placeholder then replace with POS photo");
      created = createDish(snap, snap.oldPicture);
    }
  }
  const quota = String(created.json?.msg || created.raw || "");
  if (QUOTA_RE.test(quota) || created.json?.code !== 0) {
    return { status: "create_fail", created };
  }
  const dish = created.json?.data?.dish || created.json?.data || null;
  const dishId = String(dish?.id || dish?.dish_id || "");
  if (!dishId) return { status: "create_fail", created };
  const photo = await uploadPosPhoto(
    dishId,
    snap.posImageUrl,
    snap.oldPicture || "",
    snap.optionGroupIds || [],
  );
  let bind = { skipped: true };
  if (snap.optionNames?.length) {
    bind = await bindOptionsUi(dishId, snap.optionNames);
    if ((dishOptionGroups(dishId).length || 0) !== (snap.optionGroupIds || []).length) {
      bind = { ...bind, retry: await bindOptionsUi(dishId, snap.optionNames) };
    }
  }
  const got = xhrJson("GET", `${API}/${dishId}`, null);
  const live = got.json?.data?.dish || dish;
  const livePrice = bahtFromMicros(live?.price ?? live?.list_price) || snap.target;
  const boundGroups = dishOptionGroups(dishId);
  const ogCount = boundGroups.length;
  const catalogOk = String(live?.catalog_id || "") === String(snap.catalogId);
  const priceOk = livePrice === snap.target;
  const optsOk = ogCount === (snap.optionGroupIds || []).length;
  const picture = live?.picture || photo.picture || "";
  const photoOk = !!picture && picture !== (snap.oldPicture || "") && !!photo.ok;
  return {
    status: catalogOk && priceOk && optsOk && photoOk ? "created" : "created_incomplete",
    dishId,
    livePrice,
    ogCount,
    catalogOk,
    priceOk,
    optsOk,
    photoOk,
    picture,
    oldPicture: snap.oldPicture || "",
    photo,
    bind,
    created,
    live,
  };
}

async function main() {
  mkdirSync(SNAP_DIR, { recursive: true });
  if (hideOld && apply && !freeSlot) {
    throw new Error("--hide-old ต้องใช้กับ --free-slot (ลบ 1 จานในหมวดกาแฟร้อนอื่นๆ ก่อนสร้าง 1 จาน)");
  }
  ensureShopeeTab();
  const here = js(`JSON.stringify({ url: location.href })`);
  if (!String(here?.url || "").includes("/shopee-pos")) {
    go(LIST_URL);
    await sleep(2500);
    ensureShopeeTab();
  }

  if (retryId && apply) {
    const file = snapPath(retryId);
    if (!existsSync(file)) throw new Error("no snapshot for retry: " + file);
    const snap = JSON.parse(readFileSync(file, "utf8"));
    if (!snap.deletedAt && !snap.freedSlot) {
      throw new Error("snapshot ยังไม่มีช่องโควต้า — อย่า --retry ถ้ายังไม่ได้ลบจานอื่นหรือจานเก่า");
    }
    if (snap.newDishId) {
      throw new Error("snapshot มี newDishId แล้ว: " + snap.newDishId);
    }
    console.log(`Retry create ${snap.name} from snapshot (old ${snap.dishId} already deleted)`);
    const result = await recreateFromSnapshot(snap);
    snap.retryAt = new Date().toISOString();
    snap.retry = result;
    if (result.dishId) {
      snap.newDishId = result.dishId;
      remapLocalFiles(snap.dishId, result.dishId, snap.name, result.livePrice, snap.catalogName, {
        keepOld: !!snap.hiddenAt,
      });
      await hubWriteSafe(
        {
          posId: snap.posId,
          channel: "shopee",
          name: snap.name,
          price: result.livePrice,
          externalId: result.dishId,
          source: "recreate",
          targetPrice: snap.target,
          applyStatus: result.status === "created" ? "recreated" : "recreated_incomplete",
        },
        `S recreate ${result.status === "created" ? "✓" : "⚠"} new ${result.dishId} เป้า ${snap.target} · หมวด ${snap.catalogName} · ตัวเลือก ${result.ogCount} · รูป POS`,
      );
    }
    writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
    writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), retry: result }, null, 2) + "\n");
    console.log(result.status, result.dishId, "price", result.livePrice, "opts", result.ogCount, "photo", result.photoOk, result.picture);
    process.exit(result.status === "created" ? 0 : 1);
  }

  const candidates = selectCandidates(loadCandidates()).filter((r) => {
    const file = snapPath(r.dishId);
    if (!existsSync(file)) return true;
    try {
      return !JSON.parse(readFileSync(file, "utf8")).newDishId;
    } catch {
      return true;
    }
  });
  const { shopeeRule, itemOverrides, items } = await loadPosAndHub();
  const optionGroups = js(`(() => {
    const x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(OG_API)}, false);
    x.withCredentials = true;
    x.send(null);
    const json = JSON.parse(x.responseText);
    return JSON.stringify((json?.data?.groups || []).map((g) => ({
      id: String(g.group_id),
      name: g.group_name || '',
    })));
  })()`) || [];
  const liveList = js(`(() => {
    const x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(API)}, false);
    x.withCredentials = true;
    x.send(null);
    const json = JSON.parse(x.responseText);
    const catalogs = json?.data?.catalogs || [];
    return JSON.stringify({
      code: json?.code,
      catalogs: catalogs.map((c) => ({
        name: c.name,
        dishes: (c.dishes || []).map((d) => ({
          id: String(d.id),
          name: d.name,
          sales_volume: d.sales_volume,
        })),
      })),
    });
  })()`);
  const catalogs = liveList?.catalogs || [];
  let shopeeCount = 0;
  for (const c of catalogs) shopeeCount += (c.dishes || []).length;

  const ctx = { items, shopeeRule, itemOverrides, optionGroups };
  const rows = [];
  for (const cand of candidates) {
    console.log(`\n--- snapshot ${cand.name} ---`);
    const row = await snapshotRow(cand, ctx);
    rows.push(row);
    writeFileSync(snapPath(row.dishId || cand.dishId), JSON.stringify({ ...row, snapAt: new Date().toISOString() }, null, 2) + "\n");
    const mark = row.ready ? "READY" : "BLOCK";
    console.log(
      `  ${mark} ${row.name}  ${row.live}→${row.target}` +
        ` · หมวด ${row.catalogName || "—"}` +
        ` · POS ตัวเลือก [${(row.optionNames || []).join(" | ")}]` +
        ` · live count ${row.liveOptionGroupCount ?? "?"}` +
        ` · รูปหลังร้าน ${row.posImageFile || "—"} ${row.posImageBytes || 0}B` +
        (row.livePromoTicked?.length ? ` · โปรที่ติ๊ก ${row.livePromoTicked.join(",")}` : ""),
    );
    if (row.issues?.length) {
      for (const issue of row.issues) console.log("    ! " + issue);
    }
    if (!skipUi) {
      go(LIST_URL);
      await sleep(1200);
    }
  }

  const plan = {
    at: new Date().toISOString(),
    dryRun,
    skipUi,
    shopeeCount,
    selected: rows.length,
    ready: rows.filter((r) => r.ready).length,
    blocked: rows.filter((r) => !r.ready).length,
    rows: rows.map((r) => ({
      name: r.name,
      dishId: r.dishId,
      posId: r.posId,
      live: r.live,
      target: r.target,
      catalogId: r.catalogId,
      catalogName: r.catalogName,
      posCategory: r.posCategory,
      oldPicture: r.oldPicture,
      posImageUrl: r.posImageUrl,
      posImageFile: r.posImageFile,
      posImageBytes: r.posImageBytes,
      optionNames: r.optionNames,
      optionGroupIds: r.optionGroupIds,
      liveOptionGroupCount: r.liveOptionGroupCount,
      livePromoTicked: r.livePromoTicked,
      liveNonPromoTicked: r.liveNonPromoTicked,
      ready: r.ready,
      issues: r.issues,
    })),
  };
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + "\n");
  console.log(
    `\nShopee ${shopeeCount} จาน · snapshot ${rows.length} · พร้อมลบแล้วสร้าง ${plan.ready} · ยังไม่ครบ ${plan.blocked}`,
  );
  console.log(
    hideOld
      ? "ลำดับ: -1 จานกาแฟสด (ข้ามนมร้อน) → ซ่อนจานเก่า (ลบไม่ได้) → สร้างจานใหม่ 1 จาน"
      : "ลำดับ: snapshot → DELETE ของเก่า → CREATE ของใหม่ที่ราคาเป้า (ห้ามสร้างก่อนลบ — โควต้าเต็ม)",
  );

  if (dryRun) {
    console.log("Dry run — ยังไม่ลบ ไม่สร้าง  ส่ง --apply --dish=<id> ทีละจานเมื่อ snapshot READY");
    process.exit(plan.blocked ? 1 : 0);
  }

  const ready = rows.filter((r) => r.ready);
  if (!ready.length) {
    console.log("ไม่มีจานที่ snapshot ครบ — ไม่ลบอะไร");
    process.exit(1);
  }
  if (ready.length > 1 && !dishArgs.length && !only && !limit) {
    console.log("ปฏิเสธ --apply ทั้งชุด — ต้องระบุ --dish= หรือ --limit=1 เพื่อลบทีละจาน");
    process.exit(1);
  }

  const log = { at: new Date().toISOString(), hideOld, freeSlot, results: [] };
  for (const row of ready) {
    console.log(`\n=== ${hideOld ? "HIDE old + CREATE" : "DELETE then CREATE"} ${row.name} ===`);
    const file = snapPath(row.dishId);
    const snap = {
      ...row,
      snapAt: new Date().toISOString(),
    };
    writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");

    if (hideOld) {
      if (freeSlot) {
        const liveNow = js(`(() => {
          const x = new XMLHttpRequest();
          x.open('GET', ${JSON.stringify(API)}, false);
          x.withCredentials = true;
          x.send(null);
          const json = JSON.parse(x.responseText);
          const catalogs = json?.data?.catalogs || [];
          return JSON.stringify({
            catalogs: catalogs.map((c) => ({
              name: c.name,
              dishes: (c.dishes || []).map((d) => ({
                id: String(d.id),
                name: d.name,
                sales_volume: d.sales_volume,
              })),
            })),
          });
        })()`);
        const skipIds = new Set(
          (loadCandidates() || []).map((c) => String(c.dishId)).concat(row.dishId),
        );
        const ranked = slotArgs.length
          ? slotArgs
              .filter((id) => !usedSlotIds.has(id) && !skipIds.has(id))
              .map((id) => ({ id, name: id, salesVolume: 0, catalogName: "slot-list" }))
          : slotCandidates(liveNow?.catalogs || catalogs, skipIds);
        let slot = null;
        let del = null;
        for (const candidate of ranked) {
          let pick = candidate;
          if (slotArgs.length) {
            const got = xhrJson("GET", `${API}/${candidate.id}`, null);
            const d = got.json?.data?.dish;
            if (!d) {
              console.log(`slot already gone ${candidate.id}`);
              usedSlotIds.add(candidate.id);
              continue;
            }
            pick = {
              id: String(d.id),
              name: d.name || "",
              salesVolume: Number(d.sales_volume || 0),
              catalogName: d.catalog_name || "",
            };
          }
          console.log(`try -1 ${pick.name} · sales ${pick.salesVolume} · ${pick.catalogName}`);
          del = xhrJson("DELETE", `${API}/${pick.id}`, null);
          if (del.status === 200 && del.json?.code === 0) {
            slot = pick;
            usedSlotIds.add(pick.id);
            break;
          }
          console.log("  skip", del.json?.msg || del.raw);
          if (slotArgs.length) usedSlotIds.add(candidate.id);
        }
        if (!slot) {
          console.log("ลบช่องโควต้าไม่สำเร็จในหมวดกาแฟสด");
          log.results.push({ name: row.name, status: "slot_delete_fail", del });
          writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
          break;
        }
        await sleep(1200);
        const gone = xhrJson("GET", `${API}/${slot.id}`, null);
        if (gone.json?.code === 0) {
          console.log("ลบช่องแล้วแต่ GET ยังเจอ — หยุด");
          log.results.push({ name: row.name, status: "slot_delete_unconfirmed", slot, gone });
          writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
          break;
        }
        snap.freedSlot = slot;
        snap.freedAt = new Date().toISOString();
        writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
        console.log("slot deleted");
      }
      const liveOld = xhrJson("GET", `${API}/${row.dishId}`, null);
      const oldDish = liveOld.json?.data?.dish;
      if (!oldDish) {
        console.log("GET จานเก่าไม่เจอ — หยุดก่อนสร้าง");
        log.results.push({ name: row.name, status: "old_missing", liveOld });
        writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
        break;
      }
      const hidden = hideLockedDish(oldDish);
      snap.hiddenName = hidden.hiddenName;
      snap.hide = hidden.put;
      if (hidden.put.json?.code === 0) {
        snap.hiddenAt = new Date().toISOString();
        console.log("hid old as", hidden.hiddenName);
        if (existsSync(SCAN)) {
          const scan = JSON.parse(readFileSync(SCAN, "utf8"));
          const items = Array.isArray(scan.items) ? scan.items : [];
          const i = items.findIndex((x) => String(x.dishId) === String(row.dishId));
          if (i >= 0) {
            items[i] = {
              ...items[i],
              name: hidden.hiddenName,
              visible: "ไม่แสดงเมนู",
              stock: "ไม่มีจำหน่าย",
            };
            scan.items = items;
            writeFileSync(SCAN, JSON.stringify(scan, null, 2) + "\n");
          }
        }
      } else {
        console.log("ซ่อนจานเก่าไม่สำเร็จ (ยังสร้างต่อ)", hidden.put.json?.msg || hidden.put.raw);
      }
      writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
    } else {
      const del = xhrJson("DELETE", `${API}/${row.dishId}`, null);
      const delOk = del.status === 200 && (del.json?.code === 0 || del.json?.code === 1100000);
      if (!delOk && del.json?.code !== 0) {
        console.log("DELETE fail", del.status, del.json?.msg || del.raw);
        log.results.push({ name: row.name, oldId: row.dishId, status: "delete_fail", del });
        writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
        go(LIST_URL);
        await sleep(800);
        continue;
      }
      await sleep(1500);
      const gone = xhrJson("GET", `${API}/${row.dishId}`, null);
      const reallyGone = gone.json?.code === 1100000 || gone.json?.code !== 0;
      if (!reallyGone) {
        console.log("DELETE ไม่ยืนยัน — จานเก่ายัง GET ได้ ข้ามจานนี้");
        log.results.push({ name: row.name, oldId: row.dishId, status: "delete_unconfirmed", del, gone });
        writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
        go(LIST_URL);
        await sleep(800);
        continue;
      }
      snap.deletedAt = new Date().toISOString();
      writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
      console.log("deleted", row.dishId);
    }

    const result = await recreateFromSnapshot(snap);
    snap.createAt = new Date().toISOString();
    snap.create = result;
    if (result.dishId) {
      snap.newDishId = result.dishId;
      remapLocalFiles(row.dishId, result.dishId, row.name, result.livePrice, row.catalogName, {
        keepOld: hideOld,
      });
      await hubWriteSafe(
        {
          posId: row.posId,
          channel: "shopee",
          name: row.name,
          price: result.livePrice,
          externalId: result.dishId,
          source: "recreate",
          targetPrice: row.target,
          applyStatus: result.status === "created" ? "recreated" : "recreated_incomplete",
        },
        `S recreate ${result.status === "created" ? "✓" : "⚠"} new ${result.dishId} เป้า ${row.target} · หมวด ${row.catalogName} · ตัวเลือก ${result.ogCount} · รูป POS`,
      );
      console.log(
        `${result.status} new ${result.dishId} price ${result.livePrice} catalog ${result.catalogOk} opts ${result.ogCount}/${row.optionGroupIds.length} photo ${result.photoOk} ${result.picture}`,
      );
    } else {
      console.log(hideOld ? "CREATE FAIL after freeing slot — retry with:" : "CREATE FAIL after delete — retry with:");
      console.log(`  node scripts/shopee-chrome-recreate.mjs --retry=${row.dishId} --apply`);
    }
    writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
    log.results.push({ name: row.name, oldId: row.dishId, ...result });
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    go(LIST_URL);
    await sleep(1500);
    if (result.status === "create_fail") break;
  }

  go(LIST_URL);
  const ok = log.results.filter((r) => r.status === "created").length;
  console.log(`\nDone created ${ok}/${ready.length}`);
  process.exit(ok === ready.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
