#!/usr/bin/env node
/**
 * Pilot: push confirmed POS main photos for 2 Signature drinks.
 * Does not flip มีจำหน่าย / listing_status.
 * Hub photo_match is written only after live display verify (API id + page <img> + CDN + aHash vs POS).
 *
 *   node scripts/channel-photo-pilot.mjs --shopee
 *   node scripts/channel-photo-pilot.mjs --grab
 *   node scripts/channel-photo-pilot.mjs --lineman
 *   node scripts/channel-photo-pilot.mjs --remaining --all
 *   node scripts/channel-photo-pilot.mjs --tea --all --workers=3
 *   node scripts/channel-photo-pilot.mjs --fruit --all --workers=3
 *   node scripts/channel-photo-pilot.mjs --milk --all --workers=3
 *   node scripts/channel-photo-pilot.mjs --smoothie --all --workers=3
 *   node scripts/channel-photo-pilot.mjs --light --all
 *   node scripts/channel-photo-pilot.mjs --fresh --all
 *   node scripts/channel-photo-pilot.mjs --fusion --all
 *   node scripts/channel-photo-pilot.mjs --hot --all
 *   node scripts/channel-photo-pilot.mjs --matcha --all
 *   node scripts/channel-photo-pilot.mjs --bakery --all
 *   node scripts/channel-photo-pilot.mjs --bakery --shopee --workers=1
 *   node scripts/channel-photo-pilot.mjs --bakery --grab --lineman --only=Ice Cream --force --workers=1
 *   node scripts/channel-photo-pilot.mjs --pilot --all
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { confirmDisplayedPhotoMatch, posBufFromItem } from "./lib/channel-photo-confirm.mjs";
import { writeMenuItemHubNote } from "./lib/hub-live-write.mjs";
import { bahtFromMicros } from "./lib/shopee-money.mjs";
import {
  isPhotoChannelVerified,
  loadFruitCoffeePhotoRows,
  loadMilkPhotoRows,
  loadSignatureDrinkPhotoRows,
  loadSmoothiePhotoRows,
  loadLightWavePhotoRows,
  loadFreshCoffeePhotoRows,
  loadFusionCoffeePhotoRows,
  loadHotCoffeePhotoRows,
  loadMatchaPhotoRows,
  loadBakeryPhotoRows,
  loadTeaWavePhotoRows,
} from "./lib/channel-photo-targets.mjs";
import {
  assertShopeeLoggedIn,
  chromeJsJsonOnTab,
  chromeJsOnTab,
  editUrl,
  ensureWorkerTabs as ensureShopeeWorkerTabs,
  findShopeeTab,
  mapPool as shopeeMapPool,
  sleep,
} from "./lib/shopee-chrome.mjs";
import {
  chromeJsJsonOnTab as grabJson,
  chromeJsOnTab as grabOn,
  ensureWorkerTabs as ensureGrabWorkerTabs,
  fetchGrabMenuApi,
  mapPool as grabMapPool,
} from "./lib/grab-chrome.mjs";
import {
  chromeJsJsonOnTab as wnJson,
  editUrl as lineEditUrl,
  ensureWorkerTabs as ensureLineWorkerTabs,
  mapPool as lineMapPool,
  openEditItem as openLineEdit,
  readWongnaiMenuItem,
} from "./lib/lineman-chrome.mjs";

const DISH_API = "https://foody.shopee.co.th/api/seller/store/dishes";
const PILOT = [
  {
    posId: "fs_item_33559286",
    name: "โกโก้ (เย็น/ปั่น)",
    dishId: "3246798564131840",
    grabId: "THITE2024040707225137437",
    lineId: "0leDVTV5lvQwH2AOlltbnXPhmz2MLE",
  },
  {
    posId: "fs_item_33559314",
    name: "ชานมไข่มุก (เย็น/ปั่น)",
    dishId: "2035915327775232",
    grabId: "THITE2024040710315731824",
    lineId: "0leDVTbnNIwwOK4o25HjFUvQRWneMh",
  },
];
const GRAB_STORE = "3-C6J1BCNXTYKTLX";
const GRAB_GROUP_FALLBACK = "THMG20240329102133012624";

function menuMainImageHash(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  const payload = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= payload.length;
  return `${(h >>> 0).toString(16).padStart(8, "0")}:${payload.length.toString(16)}`;
}

function jpegB64FromPos(imageUrl, variant = 0) {
  const raw = String(imageUrl || "");
  let buf;
  if (raw.startsWith("data:")) {
    buf = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
  } else {
    throw new Error("expected data URL");
  }
  const dir = join(tmpdir(), "telltea-photo-pilot");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `pos-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  writeFileSync(out, buf);
  const px = String(800 + (Number(variant) || 0) * 17);
  execFileSync("sips", ["-Z", px, "-s", "format", "jpeg", out, "--out", out], { stdio: "pipe" });
  const jpegBuf = readFileSync(out);
  return { ok: jpegBuf.length > 1000, b64: jpegBuf.toString("base64"), bytes: jpegBuf.length };
}

function xhrDish(tabIndex, windowIndex, jsBody) {
  return chromeJsJsonOnTab(tabIndex, jsBody, { windowIndex });
}

function getDish(tabIndex, windowIndex, dishId) {
  return xhrDish(
    tabIndex,
    windowIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', '${DISH_API}/${dishId}', false);
      x.withCredentials = true;
      x.send(null);
      let json = null;
      try { json = JSON.parse(x.responseText); } catch {}
      const d = json?.data?.dish || {};
      return JSON.stringify({
        ok: json?.code === 0 && d.id != null,
        available: d.available,
        listing_status: d.listing_status,
        picture: d.picture || '',
        list_price: d.list_price,
        option_group_count: d.option_group_count ?? 0,
        dish: d,
      });
    })()`,
  );
}

function serveJpeg(b64) {
  const bytes = Buffer.from(b64, "base64");
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": bytes.length });
    res.end(bytes);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}/pos.jpg` });
    });
  });
}

async function waitInput(tabIndex, windowIndex, dishId, minCbs = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < 18000) {
    const st = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const crop = document.querySelector('[class*=crop_modal]');
        if (crop) {
          const btn = [...crop.querySelectorAll('button')].find((b) => /ยกเลิก|Cancel/i.test((b.innerText||'').trim()));
          if (btn) btn.click();
        }
        return JSON.stringify({
          onEdit: location.href.includes('/edit') && location.href.includes('${dishId}'),
          hasInput: !!document.querySelector('#imgFileInput'),
          crop: !!document.querySelector('[class*=crop_modal]'),
          cbs: document.querySelectorAll('input[type="checkbox"]').length,
        });
      })()`,
      { windowIndex },
    );
    const groupsReady = Number(minCbs) <= 0 || Number(st?.cbs) >= Number(minCbs);
    if (st?.onEdit && st?.hasInput && !st?.crop && groupsReady) return st;
    await sleep(400);
  }
  return null;
}

async function setPhotoFromLocalhost(tabIndex, windowIndex, url) {
  const key = `__ttPhoto_${Date.now()}`;
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const key = ${JSON.stringify(key)};
      window[key] = 'pending';
      (async () => {
        const input = document.querySelector('#imgFileInput');
        if (!input) { window[key] = { ok: false, reason: 'no-input' }; return; }
        const res = await fetch(${JSON.stringify(url)});
        const blob = await res.blob();
        const file = new File([blob], 'pos.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        try { input.files = dt.files; } catch (e) {}
        if (input.files.length !== 1) {
          Object.defineProperty(input, 'files', { configurable: true, value: dt.files });
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        window[key] = { ok: input.files.length === 1, size: file.size, status: res.status };
      })().catch((e) => { window[${JSON.stringify(key)}] = { ok: false, error: String(e) }; });
      return 'started';
    })()`,
    { windowIndex },
  );
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await sleep(300);
    const st = chromeJsJsonOnTab(
      tabIndex,
      `(() => JSON.stringify(window[${JSON.stringify(key)}] ?? null))()`,
      { windowIndex },
    );
    if (st && st !== "pending") return st;
  }
  return { ok: false, reason: "set-timeout" };
}

async function uploadShopeePhoto(tabIndex, windowIndex, dishId, imageUrl, pin, optionGroupIds = []) {
  const jpeg = jpegB64FromPos(imageUrl);
  if (!jpeg.ok) return { ok: false, reason: "jpeg" };
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1500);
  const og = Number(pin.option_group_count) || 0;
  const minCbs = og <= 0 ? 0 : og >= 4 ? 8 : 2;
  const ready = await waitInput(tabIndex, windowIndex, dishId, minCbs);
  if (!ready?.onEdit || !ready?.hasInput) return { ok: false, reason: "edit-not-ready", ready };

  const set = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const input = document.querySelector('#imgFileInput');
      if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
      const bin = atob(${JSON.stringify(jpeg.b64)});
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'pos.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      try { input.files = dt.files; } catch (e) {}
      const n = input.files.length;
      if (n !== 1) {
        try { Object.defineProperty(input, 'files', { configurable: true, value: dt.files }); } catch (e) {}
      }
      const assigned = input.files.length;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ ok: assigned === 1, assigned, size: file.size });
    })()`,
    { windowIndex },
  );
  if (!set?.ok) return { ok: false, reason: "set-photo", set };

  let fromPreview = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 16000) {
    const st = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const crop = document.querySelector('[class*=crop_modal]');
        if (crop) {
          const btn = [...crop.querySelectorAll('button')].find((b) => /บันทึก|Save|ตกลง|ยืนยัน/i.test((b.innerText||'').trim()));
          if (btn) btn.click();
        }
        const preview = [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => /susercontent|th-11134505|image_preview|preview_image/i.test(s||''));
        let picture = '';
        for (const src of preview) {
          const m = String(src).match(/(th-11134505-[a-z0-9-]+)/i);
          if (m) { picture = m[1].replace(/\\.webp$/i, ''); break; }
        }
        return JSON.stringify({ crop: !!crop, picture, preview: preview.slice(0, 3) });
      })()`,
      { windowIndex },
    );
    fromPreview = st?.picture || "";
    if (fromPreview && fromPreview !== pin.picture) break;
    await sleep(400);
  }
  if (!fromPreview || fromPreview === pin.picture) {
    return { ok: false, reason: "no-new-picture", fromPreview, old: pin.picture };
  }

  const save = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'บันทึก');
      if (!btn) return JSON.stringify({ ok: false, reason: 'no-save' });
      btn.click();
      return JSON.stringify({ ok: true, picture: ${JSON.stringify(fromPreview)} });
    })()`,
    { windowIndex },
  );
  await sleep(800);
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const dialog = [...document.querySelectorAll('[class*=modal], [class*=dialog], [class*=confirm]')]
        .find((e) => /บันทึกแทนที่|อัปเดตข้อมูล/i.test(e.innerText || ''));
      if (!dialog) return 'none';
      const ok = [...dialog.querySelectorAll('button')].find((b) => /ตกลง|OK|ยืนยัน/i.test((b.innerText || '').trim()));
      if (ok) ok.click();
      return ok ? 'confirmed' : 'dialog';
    })()`,
    { windowIndex },
  );
  await sleep(2500);
  const afterDish = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', '${DISH_API}/${dishId}', false);
      x.withCredentials = true;
      x.send(null);
      let json = null;
      try { json = JSON.parse(x.responseText); } catch {}
      const d = json?.data?.dish || {};
      return JSON.stringify({
        ok: json?.code === 0,
        picture: d.picture,
        available: d.available,
        listing_status: d.listing_status,
        option_group_count: d.option_group_count ?? null,
      });
    })()`,
    { windowIndex },
  );
  return {
    ...save,
    ...afterDish,
    fromPreview,
    oldPicture: pin.picture,
    optionGroupIds,
    groupsBefore: pin.option_group_count ?? 0,
    groupsAfter: afterDish?.option_group_count ?? null,
  };
}

function grabPhotoId(url) {
  const m = String(url || "").match(/menueditor_item_[a-z0-9_]+(?:\.(?:jpe?g|png|webp))?/i);
  return m ? m[0] : String(url || "");
}

function withGrabNameTranslation(item) {
  const cur = item?.nameTranslation?.translation || {};
  const name = String(item?.itemName || "").trim();
  const fill = (v) => String(v || "").trim() || name;
  return {
    ...item,
    nameTranslation: {
      translation: {
        ...cur,
        en: fill(cur.en),
        zh: fill(cur.zh),
        ko: fill(cur.ko),
      },
      originalTranslationFromDS: item?.nameTranslation?.originalTranslationFromDS ?? null,
    },
  };
}

function linePhotoId(url) {
  const m = String(url || "").match(/\/([^/?]+)(?:\?|$)/);
  return m ? m[1] : String(url || "");
}

function grabHeadersJs() {
  return `{
    const merchantID = ${JSON.stringify(GRAB_STORE)};
    let merchantGroupID = ${JSON.stringify(GRAB_GROUP_FALLBACK)};
    try {
      const sel = JSON.parse(localStorage.getItem('merchantSelector') || '[]');
      if (sel[0]?.id) merchantGroupID = sel[0].id;
    } catch {}
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      requestSource: 'troyPortal',
      'x-grabkit-clientid': 'grabmerchant-portal',
      'x-client-id': 'GrabMerchant-Portal',
      merchantID,
      merchantGroupID,
    };
  }`;
}

async function waitWindowKey(readFn, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(350);
    const st = readFn();
    if (st && st !== "pending") return st;
  }
  return { ok: false, reason: "timeout" };
}

let grabMenuGate = Promise.resolve();
function withGrabMenuLock(fn) {
  const run = grabMenuGate.then(fn, fn);
  grabMenuGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pushGrabPhoto(row, item, posHash, tabIndex, windowIndex, variant = 0) {
  const menu = await withGrabMenuLock(() => fetchGrabMenuApi(tabIndex, windowIndex));
  const live = (menu.categories || [])
    .flatMap((c) => (c.items || []).map((it) => ({ ...it, categoryID: it.categoryID || c.categoryID })))
    .find((it) => it.itemID === row.grabId);
  if (!live) return { ok: false, reason: "missing-live" };
  const before = {
    availableStatus: live.availableStatus,
    priceInMin: live.priceInMin,
    imageURL: live.imageURL,
    groups: live.linkedModifierGroupIDs,
  };
  const jpeg = jpegB64FromPos(item.imageUrl, variant);
  if (!jpeg.ok) return { ok: false, reason: "jpeg", before };
  const jpegKey = `__ttJpeg_${row.grabId}`;
  grabOn(tabIndex, `(() => { window[${JSON.stringify(jpegKey)}] = ''; return 'ok'; })()`, { windowIndex });
  const chunk = 24000;
  for (let i = 0; i < jpeg.b64.length; i += chunk) {
    grabOn(
      tabIndex,
      `(() => { window[${JSON.stringify(jpegKey)}] += ${JSON.stringify(jpeg.b64.slice(i, i + chunk))}; return window[${JSON.stringify(jpegKey)}].length; })()`,
      { windowIndex },
    );
  }
  const key = `__ttGrabUp_${Date.now()}_${row.grabId.slice(-6)}`;
  const { attributes, attributeForm, ...rest } = withGrabNameTranslation(live);
  const slimItem = rest;
  const slimKey = `__ttGrabItem_${row.grabId}`;
  const slimJson = JSON.stringify(slimItem);
  grabOn(tabIndex, `(() => { window[${JSON.stringify(slimKey)}] = ''; return 'ok'; })()`, { windowIndex });
  for (let i = 0; i < slimJson.length; i += chunk) {
    grabOn(
      tabIndex,
      `(() => { window[${JSON.stringify(slimKey)}] += ${JSON.stringify(slimJson.slice(i, i + chunk))}; return window[${JSON.stringify(slimKey)}].length; })()`,
      { windowIndex },
    );
  }
  grabOn(
    tabIndex,
    `(() => {
      const key = ${JSON.stringify(key)};
      window[key] = 'pending';
      (async () => {
        const headers = (() => ${grabHeadersJs()})();
        const data = window[${JSON.stringify(jpegKey)}] || '';
        if (data.length < 1000) { window[key] = { ok: false, stage: 'jpeg', len: data.length }; return; }
        const up = await fetch('https://api.grab.com/food/merchant/v2/upload-file', {
          method: 'POST', credentials: 'include', headers,
          body: JSON.stringify({ file: { data, type: 'jpeg' }, category: 'menu_item_img' }),
        });
        const upJson = await up.json();
        const url = upJson?.url || '';
        if (!url) { window[key] = { ok: false, stage: 'upload', status: up.status, upJson }; return; }
        window[key] = { stage: 'upsert', url };
        let base = {};
        try { base = JSON.parse(window[${JSON.stringify(slimKey)}] || '{}'); } catch (e) {
          window[key] = { ok: false, stage: 'item-json', error: String(e) }; return;
        }
        if (!base.nameTranslation?.translation?.en) {
          window[key] = { ok: false, stage: 'nameTranslation', keys: Object.keys(base).slice(0, 20) }; return;
        }
        const item = { ...base, imageURL: url, imageURLs: [url] };
        const upsert = await fetch('https://api.grab.com/food/merchant/v2/upsert-item', {
          method: 'POST', credentials: 'include', headers,
          body: JSON.stringify({ item, categoryID: base.categoryID }),
        });
        window[key] = { ok: upsert.status >= 200 && upsert.status < 300, status: upsert.status, url, text: (await upsert.text()).slice(0, 800) };
      })().catch((e) => { window[${JSON.stringify(key)}] = { error: String(e) }; });
      return 'started';
    })()`,
    { windowIndex },
  );
  const up = await waitWindowKey(
    () => {
      const st = grabJson(tabIndex, `(() => JSON.stringify(window[${JSON.stringify(key)}] ?? null))()`, { windowIndex });
      if (st && st.stage === "upsert") return "pending";
      return st;
    },
  );
  if (up?.status === 409 && variant < 2) {
    console.log(`  G 409 already_exists → retry jpeg variant ${variant + 1}`);
    return pushGrabPhoto(row, item, posHash, tabIndex, windowIndex, variant + 1);
  }
  await sleep(2500);
  const afterMenu = await withGrabMenuLock(() => fetchGrabMenuApi(tabIndex, windowIndex));
  const after = (afterMenu.categories || []).flatMap((c) => c.items || []).find((it) => it.itemID === row.grabId);
  const availOk = after?.availableStatus === before.availableStatus;
  const groupsOk = JSON.stringify(after?.linkedModifierGroupIDs) === JSON.stringify(before.groups);
  const photoOk = after?.imageURL && after.imageURL !== before.imageURL;
  const ok = !!(up?.ok && photoOk && availOk && groupsOk && after?.priceInMin === before.priceInMin);
  return {
    ok,
    before: grabPhotoId(before.imageURL),
    after: grabPhotoId(after?.imageURL),
    availableBefore: before.availableStatus,
    availableAfter: after?.availableStatus,
    groupsOk,
    up,
  };
}

async function pushLinePhoto(row, item, posHash, tabIndex, windowIndex) {
  const tab = { tabIndex, windowIndex };
  const before = await readWongnaiMenuItem(row.lineId, tab);
  if (before?.error) return { ok: false, reason: "read-fail", before };
  const jpeg = jpegB64FromPos(item.imageUrl);
  if (!jpeg.ok) return { ok: false, reason: "jpeg", before };
  const page = await openLineEdit(tabIndex, row.lineId, row.name, windowIndex, lineEditUrl(row.lineId));
  if (!page?.onEdit) return { ok: false, reason: "edit-fail", page, before };
  wnJson(
    tabIndex,
    `(() => {
      let input = document.querySelector('#photos, input[type=file]');
      if (!input) {
        const img = document.querySelector('img[src*="lmwn"], img[src*="line-scdn"]');
        const btn = img?.closest('[draggable="true"]')?.querySelector('button') || img?.parentElement?.querySelector('button');
        if (btn) btn.click();
      }
      return JSON.stringify({ opened: true });
    })()`,
    { windowIndex },
  );
  await sleep(700);
  const set = wnJson(
    tabIndex,
    `(() => {
      const input = document.querySelector('#photos, input[type=file]');
      if (!input) return JSON.stringify({ ok: false, reason: 'no-input' });
      const bin = atob(${JSON.stringify(jpeg.b64)});
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], 'pos.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      try { input.files = dt.files; } catch (e) {}
      const n = input.files.length;
      if (n !== 1) {
        try { Object.defineProperty(input, 'files', { configurable: true, value: dt.files }); } catch (e) {}
      }
      const assigned = input.files.length;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ ok: assigned === 1, assigned, size: file.size });
    })()`,
    { windowIndex },
  );
  if (!set?.ok) return { ok: false, reason: "set-photo", set, before };
  const t0 = Date.now();
  let blobReady = false;
  while (Date.now() - t0 < 8000) {
    const st = wnJson(
      tabIndex,
      `(() => JSON.stringify({ blob: [...document.querySelectorAll('img')].some((i) => (i.src || '').startsWith('blob:')) }))()`,
      { windowIndex },
    );
    if (st?.blob) {
      blobReady = true;
      break;
    }
    await sleep(300);
  }
  const save = wnJson(
    tabIndex,
    `(() => {
      const labels = [...document.querySelectorAll('button, [role="radio"], label')];
      const susp = labels.find((el) => /งดขาย/.test((el.innerText || "").trim()));
      const suspOn = !!(
        susp &&
        (susp.getAttribute("aria-checked") === "true" ||
          /Mui-checked|Mui-selected/.test(String(susp.className || "")) ||
          susp.querySelector?.("input:checked"))
      );
      let pinStatus = "none";
      if (suspOn) pinStatus = "keep-suspended";
      else {
        const avail = labels.find((el) => (el.innerText || "").trim() === "มีจำหน่าย");
        if (avail) { avail.click(); pinStatus = "pinned-available"; }
      }
      const buttons = [...document.querySelectorAll('button')].filter((b) => (b.innerText || "").trim() === "บันทึก" && !b.disabled);
      const btn = buttons.find((b) => b.type === "submit") || buttons[buttons.length - 1] || buttons[0];
      if (!btn) return JSON.stringify({ error: "no save", pinStatus });
      btn.click();
      return JSON.stringify({ saved: true, pinStatus });
    })()`,
    { windowIndex },
  );
  await sleep(2500);
  for (let i = 0; i < 3; i++) {
    const extra = wnJson(
      tabIndex,
      `(() => {
        for (const btn of document.querySelectorAll('button')) {
          const t = (btn.innerText || "").trim();
          if (t === "บันทึกการเปลี่ยนแปลง" || t === "ยืนยัน" || t === "ตกลง" || t === "OK") {
            btn.click();
            return t;
          }
        }
        return "none";
      })()`,
      { windowIndex },
    );
    if (extra === "none") break;
    await sleep(1200);
  }
  await sleep(3500);
  let after = await readWongnaiMenuItem(row.lineId, tab);
  const tAfter = Date.now();
  while (
    after?.photoId &&
    after.photoId === before.photoId &&
    Date.now() - tAfter < 12000
  ) {
    await sleep(1500);
    after = await readWongnaiMenuItem(row.lineId, tab);
  }
  const availOk = after.status === before.status;
  const photoOk = after.photoId && after.photoId !== before.photoId;
  const groupsOk =
    JSON.stringify(after?.optionNames || []) === JSON.stringify(before.optionNames || []);
  const ok = !!(save?.saved && photoOk && availOk && groupsOk && after.online === before.online);
  return {
    ok,
    before: linePhotoId(before.photoId),
    after: linePhotoId(after?.photoId),
    statusBefore: before.status,
    statusAfter: after?.status,
    save,
    blobReady,
    groupsOk,
    groupsBefore: before.optionNames || [],
    groupsAfter: after?.optionNames || [],
  };
}

function argVal(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

function channelId(channel, row) {
  if (channel === "shopee") return row.dishId;
  if (channel === "grab") return row.grabId;
  return row.lineId;
}

function foldGroupName(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง");
}

function attachShopeeOptionIds(todo, items, posGroupName, shopeeGroups) {
  for (const job of todo) {
    const item = job.item || items.get(job.row.posId) || {};
    const names = (item.optionGroupIds || [])
      .map((id) => posGroupName.get(id) || "")
      .filter(Boolean);
    job.optionGroupIds = names
      .map((n) => shopeeGroups.find((g) => foldGroupName(g.name) === foldGroupName(n))?.id)
      .filter(Boolean)
      .map(String);
  }
}

function splitChannelJobs(channel, rows, items, { force = false } = {}) {
  const todo = [];
  const skipped = [];
  for (const row of rows) {
    const item = items.get(row.posId) || {};
    const posHash = item.imageHash || menuMainImageHash(item.imageUrl);
    if (!force && isPhotoChannelVerified(row.live?.[channel], posHash)) {
      skipped.push({ channel, posId: row.posId, name: row.name, status: "already-verified" });
      continue;
    }
    if (!channelId(channel, row)) {
      skipped.push({ channel, posId: row.posId, name: row.name, status: "no-id" });
      continue;
    }
    if (!item.imageUrl || !posHash) {
      skipped.push({ channel, posId: row.posId, name: row.name, status: "no-pos-image" });
      continue;
    }
    todo.push({ row, item, posHash });
  }
  return { todo, skipped };
}

async function runShopeePool(todo, workers, pre, log) {
  if (!todo.length) return;
  await shopeeMapPool(
    todo,
    workers,
    async (tabIndex, job, _i, windowIndex) => {
      const { row, item, posHash } = job;
      const tab = { tabIndex, windowIndex };
      const before = getDish(tabIndex, windowIndex, row.dishId);
      if (!before?.ok) {
        log.push({
          channel: "shopee",
          posId: row.posId,
          name: row.name,
          dishId: row.dishId,
          status: "get-fail",
          before,
        });
        return;
      }
      console.log(`S ${row.name} · live ${before.picture} · available ${before.available} · groups ${before.option_group_count ?? "?"}`);
      const up = await uploadShopeePhoto(
        tabIndex,
        windowIndex,
        row.dishId,
        item.imageUrl,
        before,
        job.optionGroupIds || [],
      );
      const after = getDish(tabIndex, windowIndex, row.dishId);
      const availOk =
        after?.available === before.available && after?.listing_status === before.listing_status;
      const groupsBefore = Number(before.option_group_count) || 0;
      const groupsAfter = Number(after?.option_group_count ?? up?.option_group_count) || 0;
      const groupsOk = after?.ok && groupsAfter === groupsBefore;
      const ok = !!(up?.ok && after?.picture && after.picture !== before.picture && availOk && groupsOk);
      console.log(
        `  S → ${ok ? "ok" : "fail"} picture ${after?.picture || up?.fromPreview} · avail ${after?.available} (was ${before.available}) · groups ${groupsAfter} (was ${groupsBefore})`,
      );
      if (!availOk) console.log("  ⚠ S availability changed — restore skipped, inspect live dish");
      if (!groupsOk) console.log("  ⚠ S option groups dropped — did not mark photo verified");
      let verify = null;
      if (ok) {
        verify = await confirmDisplayedPhotoMatch({
          channel: "shopee",
          row,
          posBuf: posBufFromItem(item),
          posHash,
          price: bahtFromMicros(after.list_price) ?? (Number(item.price) || 0),
          tab,
        });
        console.log(
          `  S verify ${verify.ok ? "ok" : "FAIL"} d=${verify.verify?.distance} ${(verify.verify?.reasons || []).join(",")}`,
        );
        await writeMenuItemHubNote(
          row.posId,
          verify.ok ? `S รูป ✓ · ตรวจไฟล์แล้ว d=${verify.verify.distance}` : `S ดันแล้ว ตรวจไฟล์ไม่ผ่าน`,
        );
      }
      log.push({
        channel: "shopee",
        posId: row.posId,
        name: row.name,
        dishId: row.dishId,
        status: ok ? (verify?.ok ? "verified" : "pushed-unverified") : "fail",
        before: before.picture,
        after: after?.picture || null,
        availableBefore: before.available,
        availableAfter: after?.available,
        up,
        verify: verify?.verify || null,
      });
    },
    pre,
  );
}

async function runGrabPool(todo, workers, pre, log) {
  if (!todo.length) return;
  await grabMapPool(
    todo,
    workers,
    async (tabIndex, job, _i, windowIndex) => {
      const { row, item, posHash } = job;
      const tab = { tabIndex, windowIndex };
      console.log(`G ${row.name}`);
      let up;
      try {
        up = await pushGrabPhoto(row, item, posHash, tabIndex, windowIndex);
      } catch (e) {
        up = {
          ok: false,
          after: "",
          availableAfter: null,
          availableBefore: null,
          error: String(e.message || e),
        };
      }
      console.log(`  G → ${up.ok ? "ok" : "fail"} ${up.after} · avail ${up.availableAfter} (was ${up.availableBefore})${up.groupsOk === false ? " · ⚠ groups changed" : ""}`);
      if (!up.ok) console.log(`  grab-up ${JSON.stringify(up.up || up).slice(0, 400)}`);
      let verify = null;
      if (up.ok) {
        verify = await confirmDisplayedPhotoMatch({
          channel: "grab",
          row,
          posBuf: posBufFromItem(item),
          posHash,
          price: Number(item.price) || null,
          tab,
        });
        console.log(
          `  G verify ${verify.ok ? "ok" : "FAIL"} d=${verify.verify?.distance} ${(verify.verify?.reasons || []).join(",")}`,
        );
      }
      log.push({
        channel: "grab",
        posId: row.posId,
        name: row.name,
        grabId: row.grabId,
        status: up.ok ? (verify?.ok ? "verified" : "pushed-unverified") : "fail",
        ...up,
        verify: verify?.verify || null,
      });
    },
    pre,
  );
}

async function runLinePool(todo, workers, pre, log) {
  if (!todo.length) return;
  await lineMapPool(
    todo,
    workers,
    async (tabIndex, job, _i, windowIndex) => {
      const { row, item, posHash } = job;
      const tab = { tabIndex, windowIndex };
      console.log(`L ${row.name}`);
      let up;
      try {
        up = await pushLinePhoto(row, item, posHash, tabIndex, windowIndex);
      } catch (e) {
        up = { ok: false, after: "", statusAfter: null, statusBefore: null, error: String(e.message || e) };
      }
      console.log(`  L → ${up.ok ? "ok" : "fail"} ${up.after} · ${up.statusAfter} (was ${up.statusBefore})${up.groupsOk === false ? " · ⚠ groups changed" : ""}`);
      let verify = null;
      if (up.ok) {
        verify = await confirmDisplayedPhotoMatch({
          channel: "lineman",
          row,
          posBuf: posBufFromItem(item),
          posHash,
          price: Number(item.price) || null,
          tab,
        });
        console.log(
          `  L verify ${verify.ok ? "ok" : "FAIL"} d=${verify.verify?.distance} ${(verify.verify?.reasons || []).join(",")}`,
        );
      }
      log.push({
        channel: "lineman",
        posId: row.posId,
        name: row.name,
        lineId: row.lineId,
        status: up.ok ? (verify?.ok ? "verified" : "pushed-unverified") : "fail",
        ...up,
        verify: verify?.verify || null,
      });
    },
    pre,
  );
}

async function main() {
  const remaining = process.argv.includes("--remaining");
  const tea = process.argv.includes("--tea");
  const fruit = process.argv.includes("--fruit");
  const milk = process.argv.includes("--milk");
  const smoothie = process.argv.includes("--smoothie");
  const light = process.argv.includes("--light");
  const fresh = process.argv.includes("--fresh");
  const fusion = process.argv.includes("--fusion");
  const hot = process.argv.includes("--hot");
  const matcha = process.argv.includes("--matcha");
  const bakery = process.argv.includes("--bakery");
  const listOnly = process.argv.includes("--list");
  const force = process.argv.includes("--force");
  const only = String(argVal("only") || "").trim();
  const workers = Math.max(1, Math.min(6, Number(argVal("workers") || 3) || 3));
  const lineWorkers = Math.max(1, Math.min(6, Number(argVal("line-workers") || 1) || 1));
  const namedCh =
    process.argv.includes("--shopee") ||
    process.argv.includes("--grab") ||
    process.argv.includes("--lineman");
  const allCh = process.argv.includes("--all") || ((remaining || tea || fruit || milk || smoothie || light || fresh || fusion || hot || matcha || bakery) && !namedCh);
  const shopee = process.argv.includes("--shopee") || allCh;
  const grab = process.argv.includes("--grab") || allCh;
  const lineman = process.argv.includes("--lineman") || allCh;
  if (!shopee && !grab && !lineman) {
    console.log("pass --bakery --all  (or --matcha --all / --hot --all / --fusion --all / --fresh --all / --light --all / --smoothie --all / --milk --all / --fruit --all / --tea --all / --remaining --all / --pilot)");
    return;
  }
  const db = await getSeedDb();
  const wave = bakery
    ? "bakery"
    : matcha
      ? "matcha"
      : hot
        ? "hot-coffee"
        : fusion
          ? "fusion-coffee"
          : fresh
            ? "fresh-coffee"
            : light
              ? "light"
              : smoothie
                ? "smoothie"
                : milk
                  ? "milk"
                  : fruit
                    ? "fruit-coffee"
                    : tea
                      ? "tea"
                      : remaining
                        ? "signature"
                        : "pilot";
  let rows = bakery
    ? await loadBakeryPhotoRows(db)
    : matcha
      ? await loadMatchaPhotoRows(db)
      : hot
        ? await loadHotCoffeePhotoRows(db)
        : fusion
          ? await loadFusionCoffeePhotoRows(db)
          : fresh
            ? await loadFreshCoffeePhotoRows(db)
            : light
              ? await loadLightWavePhotoRows(db)
              : smoothie
                ? await loadSmoothiePhotoRows(db)
                : milk
                  ? await loadMilkPhotoRows(db)
                  : fruit
                    ? await loadFruitCoffeePhotoRows(db)
                    : tea
                      ? await loadTeaWavePhotoRows(db)
                      : remaining
                        ? await loadSignatureDrinkPhotoRows(db)
                        : PILOT;
  if (only) {
    const q = only.toLowerCase();
    rows = rows.filter(
      (r) => String(r.name || "").toLowerCase().includes(q) || String(r.posId || "").includes(only),
    );
    if (!rows.length) {
      console.log(`--only=${only} matched 0 ${wave} rows`);
      return;
    }
  }
  console.log(
    `targets ${rows.length} (${wave}${only ? ` · only=${only}` : ""}${force ? " · force" : ""}) · workers S/G ${workers} L ${lineWorkers} · S${shopee ? "✓" : "–"} G${grab ? "✓" : "–"} L${lineman ? "✓" : "–"}`,
  );
  for (const row of rows) {
    console.log(
      `  ${row.category || ""}\t${row.name}\tS=${row.dishId || "-"}\tG=${row.grabId || "-"}\tL=${row.lineId || "-"}`,
    );
  }
  if (listOnly) {
    process.exit(0);
  }

  const items = new Map();
  await Promise.all(
    rows.map(async (row) => {
      items.set(row.posId, (await getDoc(doc(db, "menuItems", row.posId))).data() || {});
    }),
  );

  const log = [];
  const jobOpts = { force };
  const sJobs = shopee ? splitChannelJobs("shopee", rows, items, jobOpts) : { todo: [], skipped: [] };
  const gJobs = grab ? splitChannelJobs("grab", rows, items, jobOpts) : { todo: [], skipped: [] };
  const lJobs = lineman ? splitChannelJobs("lineman", rows, items, jobOpts) : { todo: [], skipped: [] };
  for (const skip of [...sJobs.skipped, ...gJobs.skipped, ...lJobs.skipped]) {
    console.log(`${skip.channel[0].toUpperCase()} skip ${skip.status} ${skip.name}`);
    log.push(skip);
  }
  console.log(
    `todo S ${sJobs.todo.length} · G ${gJobs.todo.length} · L ${lJobs.todo.length} (skip ${sJobs.skipped.length + gJobs.skipped.length + lJobs.skipped.length})`,
  );

  let sPre;
  let gPre;
  let lPre;
  if (sJobs.todo.length) {
    const found = findShopeeTab();
    assertShopeeLoggedIn(found.tabIndex, found.windowIndex);
    const groupsSnap = await getDocs(collection(db, "menuOptionGroups"));
    const posGroupName = new Map();
    for (const d of groupsSnap.docs) {
      const g = d.data() || {};
      if (g.active === false) continue;
      posGroupName.set(d.id, g.name || "");
    }
    const ogRaw = chromeJsJsonOnTab(
      found.tabIndex,
      `(() => {
        const x = new XMLHttpRequest();
        x.open('GET', 'https://foody.shopee.co.th/api/seller/store/option-groups', false);
        x.withCredentials = true;
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(null);
        return JSON.stringify({ status: x.status, body: x.responseText });
      })()`,
      { windowIndex: found.windowIndex },
    );
    let ogJson = {};
    try {
      ogJson = JSON.parse(ogRaw.body);
    } catch {
      ogJson = {};
    }
    const shopeeGroups = (ogJson.data?.groups || []).map((g) => ({
      id: String(g.group_id),
      name: g.group_name || "",
    }));
    attachShopeeOptionIds(sJobs.todo, items, posGroupName, shopeeGroups);
    sPre = { windowIndex: found.windowIndex, tabIndices: ensureShopeeWorkerTabs(workers) };
  }
  if (gJobs.todo.length) gPre = ensureGrabWorkerTabs(workers);
  if (lJobs.todo.length) lPre = ensureLineWorkerTabs(lineWorkers);
  if (workers > 1 || lineWorkers > 1) await sleep(3500);

  await Promise.all([
    runShopeePool(sJobs.todo, workers, sPre, log),
    runGrabPool(gJobs.todo, workers, gPre, log),
    runLinePool(lJobs.todo, lineWorkers, lPre, log),
  ]);

  const out = join("scripts/data/menu-price-baseline", "channel-photo-pilot-log.json");
  writeFileSync(
    out,
    JSON.stringify({ at: new Date().toISOString(), wave, workers, lineWorkers, remaining, tea, fruit, milk, smoothie, light, fresh, fusion, hot, matcha, bakery, log }, null, 2) + "\n",
  );
  console.log(`→ ${out}`);
  const failed = log.filter((r) => !["verified", "already-verified", "no-id"].includes(r.status));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
