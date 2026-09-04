/**
 * Multi-tab Chrome control for Grab Merchant Food menu.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GRAB_STORE_ID = "3-C6J1BCNXTYKTLX";
const URL_PART = "merchant.grab.com";
const LIST_URL = `https://merchant.grab.com/food/inventory/${GRAB_STORE_ID}`;
const MENU_URL = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}`;
const BULK_URL = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/bulkUploadMenu`;

/** Grab download artifacts in ~/Downloads — wipe before each fresh export. */
const GRAB_DOWNLOAD_RE =
  /^(ดาวน์โหลดเมนู_|3-C6J1BCNXTYKTLX_|grab-hub-|grab-jasmine-|grab-rename)/;

let cachedWindowIndex = null;

function runAppleScript(script, timeoutMs = 180_000) {
  try {
    return execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (e) {
    throw new Error(e.stderr?.toString() || e.message || String(e));
  }
}

function b64Js(js) {
  return Buffer.from(js, "utf8").toString("base64");
}

export function findGrabTab() {
  const script = `
tell application "Google Chrome"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with tb in tabs of w
      set ti to ti + 1
      if URL of tb as string contains "${URL_PART}" then
        return (wi as string) & "," & (ti as string)
      end if
    end repeat
  end repeat
  error "NO_GRAB_TAB"
end tell
`;
  const out = runAppleScript(script);
  const [w, t] = out.split(",").map(Number);
  cachedWindowIndex = w;
  return { windowIndex: w, tabIndex: t };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Delete prior Grab zips/CSVs/error reports from Downloads so the next file is unambiguous. */
export function clearGrabDownloads({ downloadsDir } = {}) {
  const dir = downloadsDir || join(homedir(), "Downloads");
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    if (!GRAB_DOWNLOAD_RE.test(name) && !name.endsWith(".crdownload")) continue;
    // Only Grab-related crdownloads
    if (name.endsWith(".crdownload") && !GRAB_DOWNLOAD_RE.test(name.replace(/\.crdownload$/, ""))) {
      continue;
    }
    const p = join(dir, name);
    try {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* ignore locked */
    }
  }
  return removed;
}

/**
 * Download current Grab menu catalog (bulk template ZIP).
 * Always clears prior Grab downloads first.
 * @param {{ timeoutMs?: number, fields?: 'price' | 'options' | 'price+options' | 'all' }} [opts]
 *   fields=price → ราคาและบริการ only (no OptionGroup rewrite)
 *   fields=options → ตัวเลือกเสริม only
 *   fields=price+options → ราคาและบริการ + ตัวเลือกเสริม (keep item prices, patch option prices)
 *   fields=all → ข้อมูลทั้งหมด (can spawn duplicate THMOG groups — avoid)
 * @returns {Promise<string>} absolute path to the new zip
 */
export async function downloadCurrentGrabMenuZip({ timeoutMs = 180_000, fields = "price" } = {}) {
  const dir = join(homedir(), "Downloads");
  const removed = clearGrabDownloads();
  console.log(`cleared Grab downloads (${removed.length}):`, removed.slice(0, 8).join(", ") || "(none)");

  const { windowIndex, tabIndex } = findGrabTab();
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href='${BULK_URL}'; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(4000);

  chromeJsOnTab(
    tabIndex,
    `(() => {
      const b=[...document.querySelectorAll('button')].find(el => (el.innerText||'').trim()==='ดาวน์โหลดเมนูปัจจุบัน');
      if (b) { b.click(); return 'opened'; }
      return 'miss';
    })()`,
    { windowIndex },
  );
  await sleep(2000);

  const fieldKeepList =
    fields === "all"
      ? ["ข้อมูลทั้งหมด"]
      : fields === "options"
        ? ["ตัวเลือกเสริม"]
        : fields === "price+options" || fields === "options+price"
          ? ["ราคาและบริการ", "ตัวเลือกเสริม"]
          : ["ราคาและบริการ"];
  const fieldSkip = ["ข้อมูลทั้งหมด", "รายละเอียดเบื้องต้น", "หมวดหมู่", "ตัวเลือกเสริม", "ราคาและบริการ"];
  const pick = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const drawer = [...document.querySelectorAll('.dui-drawer-open')].find((el) =>
        (el.innerText || "").includes("ดาวน์โหลดแค็ตตาล็อก"),
      );
      if (!drawer) return JSON.stringify({ err: "no-drawer" });
      const labs = [...drawer.querySelectorAll("label.dui-checkbox-wrapper")];
      const keep = ${JSON.stringify(fieldKeepList)};
      const isField = (t) => ${JSON.stringify(fieldSkip)}.some((s) => t.startsWith(s));
      let cats = 0;
      for (const lab of labs) {
        const t = (lab.innerText || "").trim().split("\\n")[0].trim();
        if (!t || t.includes("ทั้งหมดในแค็ตตาล็อก") || isField(t)) continue;
        if (!lab.className.includes("checked")) {
          lab.click();
          cats++;
        }
      }
      let fieldFlips = 0;
      const fieldLabs = labs.filter((lab) => {
        const t = (lab.innerText || "").trim().split("\\n")[0].trim();
        return isField(t);
      });
      fieldLabs.sort((a, b) => {
        const ta = (a.innerText || "").trim();
        const tb = (b.innerText || "").trim();
        const rank = (t) => (t.startsWith("ข้อมูลทั้งหมด") ? 0 : 1);
        return rank(ta) - rank(tb);
      });
      for (const lab of fieldLabs) {
        const t = (lab.innerText || "").trim().split("\\n")[0].trim();
        const want = keep.some((s) => t.startsWith(s));
        const checked = lab.className.includes("checked");
        if (want !== checked) {
          lab.click();
          fieldFlips++;
        }
      }
      const dl = [...drawer.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "ดาวน์โหลด");
      let confirm = null;
      if (dl && !dl.disabled) {
        dl.click();
        confirm = "ดาวน์โหลด";
      }
      return JSON.stringify({ cats, fieldFlips, confirm, dlDisabled: !dl || dl.disabled, field: keep });
    })()`,
    { windowIndex },
  );
  console.log("catalog download:", pick);
  if (!pick || pick.confirm !== "ดาวน์โหลด") {
    await sleep(800);
    const retry = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const drawer = [...document.querySelectorAll('.dui-drawer-open')].find((el) =>
          (el.innerText || "").includes("ดาวน์โหลดแค็ตตาล็อก"),
        );
        const dl = drawer && [...drawer.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "ดาวน์โหลด");
        if (dl && !dl.disabled) { dl.click(); return JSON.stringify({ confirm: "ดาวน์โหลด" }); }
        return JSON.stringify({ confirm: null, dlDisabled: !dl || dl.disabled });
      })()`,
      { windowIndex },
    );
    console.log("catalog download retry:", retry);
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    const hits = readdirSync(dir)
      .filter((n) => {
        if (n.endsWith(".crdownload")) return false;
        if (!n.endsWith(".zip")) return false;
        return (
          n.startsWith("3-C6J1BCNXTYKTLX_") ||
          n.startsWith("ดาวน์โหลดเมนู_") ||
          /C6J1BCNXTYKTLX/.test(n)
        );
      })
      .map((n) => {
        const p = join(dir, n);
        return { p, m: statSync(p).mtimeMs, n };
      })
      .filter((x) => x.m >= started - 2000)
      .sort((a, b) => b.m - a.m);
    if (hits[0]) {
      console.log("fresh Grab menu zip:", hits[0].n);
      return hits[0].p;
    }
  }
  throw new Error("Timed out waiting for Grab menu zip after clear+download");
}

export function chromeJsOnTab(tabIndex, js, { windowIndex } = {}) {
  let wi = windowIndex ?? cachedWindowIndex;
  let ti = tabIndex;
  if (wi == null) {
    const found = findGrabTab();
    wi = found.windowIndex;
    ti = found.tabIndex;
  }
  const b64 = b64Js(js);
  const script = `
tell application "Google Chrome"
  tell window ${wi}
    set js to do shell script "echo ${b64} | base64 -D"
    return execute tab ${ti} javascript js
  end tell
end tell
`;
  try {
    const out = runAppleScript(script);
    if (out === "missing value" || out === "") return null;
    return out;
  } catch (e) {
    const msg = String(e.message || e);
    if (!/Invalid index|Can’t get tab|Can't get tab/i.test(msg)) throw e;
    const found = findGrabTab();
    const retry = `
tell application "Google Chrome"
  tell window ${found.windowIndex}
    set js to do shell script "echo ${b64} | base64 -D"
    return execute tab ${found.tabIndex} javascript js
  end tell
end tell
`;
    const out = runAppleScript(retry);
    if (out === "missing value" || out === "") return null;
    return out;
  }
}

export function chromeJsJsonOnTab(tabIndex, js, opts) {
  const raw = chromeJsOnTab(tabIndex, js, opts);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** GET https://api.grab.com/food/merchant/v2/menu from the logged-in merchant tab. */
export function fetchGrabMenuApi(tabIndex, windowIndex) {
  const raw = chromeJsOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', 'https://api.grab.com/food/merchant/v2/menu', false);
      x.withCredentials = true;
      x.send(null);
      return x.status + '\\n' + (x.responseText || '');
    })()`,
    { windowIndex },
  );
  const text = String(raw || "");
  const nl = text.indexOf("\n");
  const status = Number(text.slice(0, nl));
  const body = nl >= 0 ? text.slice(nl + 1) : text;
  if (status !== 200 || body.length < 1000) {
    throw new Error(`Grab menu API ${status || "empty"} len=${body.length}`);
  }
  return JSON.parse(body);
}

export function openTab(url, { windowIndex } = {}) {
  const wi = windowIndex ?? cachedWindowIndex ?? findGrabTab().windowIndex;
  const script = `
tell application "Google Chrome"
  tell window ${wi}
    make new tab with properties {URL:"${url}"}
    return count of tabs
  end tell
end tell
`;
  return Number(runAppleScript(script));
}

export function ensureWorkerTabs(workers) {
  const found = findGrabTab();
  const { windowIndex, tabIndex } = found;
  cachedWindowIndex = windowIndex;

  // Single-worker: stick to the live Grab tab — opening extras races the menu UI.
  if (workers <= 1) {
    chromeJsOnTab(tabIndex, `(() => { location.href='${MENU_URL}'; return 'ok'; })()`, { windowIndex });
    return { windowIndex, tabIndices: [tabIndex] };
  }

  const listScript = `
tell application "Google Chrome"
  set wi to ${windowIndex}
  set out to ""
  set ti to 0
  repeat with tb in tabs of window wi
    set ti to ti + 1
    set u to URL of tb as string
    if u contains "${URL_PART}" then
      set out to out & (ti as string) & ","
    end if
  end repeat
  return out
end tell
`;
  const raw = runAppleScript(listScript);
  let indices = [...new Set(raw.split(",").filter(Boolean).map(Number))];

  // Prefer dedicated Grab menu tabs (price edits need menu overview, not inventory).
  while (indices.length < workers) {
    const newIdx = openTab(MENU_URL, { windowIndex });
    indices.push(newIdx);
  }

  const tabIndices = indices.slice(0, workers);
  for (const ti of tabIndices) {
    chromeJsOnTab(ti, `(() => { location.href='${MENU_URL}'; return 'ok'; })()`, { windowIndex });
  }

  return { windowIndex, tabIndices };
}

export function editUrl(itemId) {
  return `https://merchant.grab.com/food/inventory/${GRAB_STORE_ID}/items/${itemId}`;
}

export function menuOverviewUrl(itemId) {
  return `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/menuOverview/${itemId}`;
}

export function escJsString(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}

export function readEditPage(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = document.querySelector('#priceInMin') || [...document.querySelectorAll('input')].find(i => (i.placeholder||'') === '0.0' || (i.id||'').toLowerCase().includes('price'));
      const nameInput = document.querySelector('#itemName') || [...document.querySelectorAll('input[type="text"]')].find(i => i.id !== 'priceInMin' && i.placeholder === 'ชื่อเมนู');
      const nameEl = nameInput || [...document.querySelectorAll('input[type="text"]')].find(i => i.id !== 'priceInMin' && i.value && i.value.length > 1 && !/^[0-9.]+$/.test(i.value));
      const m = location.href.match(/\\/(?:items|menuOverview)\\/(THITE[A-Z0-9]+)/i);
      const text = document.body.innerText || '';
      const hasPrice = !!(priceInput && priceInput.value !== '');
      const nameEditable = !!(nameEl && !nameEl.disabled && !nameEl.readOnly);
      return JSON.stringify({
        onEdit: hasPrice || !!nameEl || (/แก้ไขรายการ|รายการสินค้า|รายละเอียดรายการ/.test(text) && (!!nameEl || hasPrice)),
        listPrice: hasPrice ? Number(priceInput.value) : null,
        name: nameEl?.value || '',
        nameEditable,
        inventoryBlocked: /ไปที่หน้าเมนู/.test(text) && !nameEditable,
        itemId: m ? m[1] : null,
        url: location.href,
      });
    })()`,
    { windowIndex },
  );
}

function pageLooksEditable(page) {
  if (!page) return false;
  const url = page.url || "";
  if (/menuOverview/.test(url) && page.listPrice != null) return true;
  if (page.nameEditable && /menuOverview|menu\//.test(url)) return true;
  return !!(page.onEdit && page.nameEditable);
}

async function waitEditable(tabIndex, windowIndex, tries = 8, gapMs = 700) {
  for (let i = 0; i < tries; i++) {
    await sleep(gapMs);
    const page = readEditPage(tabIndex, windowIndex);
    if (pageLooksEditable(page)) return page;
  }
  return readEditPage(tabIndex, windowIndex);
}

/** Open editable item on Grab menu overview (inventory is read-only for price). */
export async function openEditItem(tabIndex, itemId, name, windowIndex, category = "") {
  const esc = escJsString(name || "");
  const rawCat = escJsString(category || "");
  const plainCat = escJsString(String(category || "").replace(/^\*\s*/, "").trim());
  const clickCatalogJs = `(() => {
    const target = "${esc}";
    const inSelect = (el) => el.closest(".dui-select-item, [class*='select-item-option']");
    const hit = [...document.querySelectorAll("div.name, .name, [class*='ItemName']")].find(
      (el) => (el.innerText || "").trim() === target && !inSelect(el),
    );
    if (!hit) return JSON.stringify({ via: "none" });
    const row =
      hit.closest(".sortable-item-row, [class*='sortable-item'], .dui-row") || hit.parentElement;
    hit.click();
    if (row && row !== hit) row.click();
    return JSON.stringify({ via: "catalog-name" });
  })()`;

  chromeJsOnTab(
    tabIndex,
    `(() => { location.href='https://merchant.grab.com/food/menu/${GRAB_STORE_ID}'; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(2500);

  if (rawCat || plainCat) {
    chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const wants = ["${rawCat}", "${plainCat}"].filter(Boolean);
        const boxes = [...document.querySelectorAll("div")].filter((el) => {
          const st = getComputedStyle(el);
          return (
            (st.overflowY === "auto" || st.overflowY === "scroll") &&
            el.scrollHeight > el.clientHeight + 20
          );
        });
        for (const box of boxes) {
          for (let step = 0; step <= 30; step++) {
            box.scrollTop = Math.floor((box.scrollHeight * step) / 30);
            for (const want of wants) {
              for (const el of box.querySelectorAll("*")) {
                if ((el.innerText || "").trim() === want) {
                  el.click();
                  return JSON.stringify({ clicked: want, step });
                }
              }
            }
          }
        }
        for (const want of wants) {
          for (const el of document.querySelectorAll("*")) {
            if ((el.innerText || "").trim() === want && el.children.length < 8) {
              el.click();
              return JSON.stringify({ clicked: want, step: -1 });
            }
          }
        }
        return JSON.stringify({ clicked: null });
      })()`,
      { windowIndex },
    );
    await sleep(1600);
  }

  chromeJsJsonOnTab(tabIndex, clickCatalogJs, { windowIndex });
  let page = await waitEditable(tabIndex, windowIndex, 8, 700);
  if (pageLooksEditable(page)) return page;

  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const search = document.querySelector('#search') || document.querySelector('input[placeholder*="ค้นหา"]');
      if (!search) return JSON.stringify({ error: 'no-search' });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      search.focus();
      setter.call(search, "${esc}");
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
  await sleep(1600);
  chromeJsJsonOnTab(tabIndex, clickCatalogJs, { windowIndex });
  page = await waitEditable(tabIndex, windowIndex, 10, 700);
  if (pageLooksEditable(page)) return page;

  return page;
}

export function setNameOnTab(tabIndex, newName, apply, windowIndex) {
  const esc = escJsString(newName);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const nameInput = document.querySelector('#itemName') || [...document.querySelectorAll('input[type="text"]')].find(i => i.placeholder === 'ชื่อเมนู' || (i.id !== 'priceInMin' && i.value && !/^[0-9.]+$/.test(i.value)));
      if (!nameInput) return JSON.stringify({ error: 'no name input' });
      if (nameInput.disabled || nameInput.readOnly) {
        return JSON.stringify({ error: 'name input locked — use menu UI', before: nameInput.value, locked: true });
      }
      const before = nameInput.value;
      if (before === "${esc}") return JSON.stringify({ skip: true, before, after: before });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nameInput.focus();
      setter.call(nameInput, "${esc}");
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (!${apply ? "true" : "false"}) {
        return JSON.stringify({ dryRun: true, before, after: nameInput.value });
      }
      const buttons = [...document.querySelectorAll('button')];
      const prefer = buttons.find(b => (b.innerText||'').trim() === 'บันทึกและเพิ่มข้อมูลหมวดหมู่');
      const any = buttons.find(b => /^บันทึก/.test((b.innerText||'').trim()) || (b.innerText||'').trim() === 'Save');
      const btn = prefer || any;
      if (btn) {
        btn.click();
        return JSON.stringify({ saved: true, before, after: nameInput.value, saveLabel: (btn.innerText||'').trim() });
      }
      return JSON.stringify({ error: 'no save btn', before, after: nameInput.value });
    })()`,
    { windowIndex },
  );
}

export async function saveNameAndRead(tabIndex, newName, apply, windowIndex) {
  const attempt = setNameOnTab(tabIndex, newName, apply, windowIndex);
  if (!apply || attempt?.error || attempt?.skip || attempt?.dryRun) return attempt;
  await sleep(1800);

  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      for (const btn of document.querySelectorAll('button')) {
        if ((btn.innerText||'').trim() === 'ตรวจสอบรายการ') { btn.click(); return 'review'; }
      }
      return 'none';
    })()`,
    { windowIndex },
  );
  await sleep(1800);

  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      for (const btn of document.querySelectorAll('button')) {
        if ((btn.innerText||'').trim() === 'บันทึกการเปลี่ยนแปลง') { btn.click(); return 'confirm'; }
      }
      return 'none';
    })()`,
    { windowIndex },
  );
  await sleep(2800);

  const after = readEditPage(tabIndex, windowIndex);
  return {
    ...attempt,
    afterName: after?.name ?? null,
    nameEditable: after?.nameEditable,
    url: after?.url,
  };
}

export function setPriceOnTab(tabIndex, price, apply, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = document.querySelector('#priceInMin') || [...document.querySelectorAll('input')].find(i => (i.placeholder||'') === '0.0' || (i.id||'').toLowerCase().includes('price'));
      if (!priceInput) return JSON.stringify({ error: 'no price input' });
      const before = priceInput.value;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      priceInput.focus();
      setter.call(priceInput, String(${price}));
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (!${apply ? "true" : "false"}) {
        return JSON.stringify({ dryRun: true, before, after: priceInput.value });
      }
      const buttons = [...document.querySelectorAll('button')];
      const prefer = buttons.find(b => (b.innerText||'').trim() === 'บันทึกและเพิ่มข้อมูลหมวดหมู่');
      const any = buttons.find(b => /^บันทึก/.test((b.innerText||'').trim()) || (b.innerText||'').trim() === 'Save');
      const btn = prefer || any;
      if (btn) {
        btn.click();
        return JSON.stringify({ saved: true, before, after: priceInput.value, saveLabel: (btn.innerText||'').trim() });
      }
      return JSON.stringify({ error: 'no save btn', before, after: priceInput.value });
    })()`,
    { windowIndex },
  );
}

export async function savePriceAndRead(tabIndex, price, apply, windowIndex) {
  const attempt = setPriceOnTab(tabIndex, price, apply, windowIndex);
  if (!apply) return attempt;
  await sleep(1800);

  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      for (const btn of document.querySelectorAll('button')) {
        if ((btn.innerText||'').trim() === 'ตรวจสอบรายการ') { btn.click(); return 'review'; }
      }
      return 'none';
    })()`,
    { windowIndex },
  );
  await sleep(1800);

  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      for (const btn of document.querySelectorAll('button')) {
        if ((btn.innerText||'').trim() === 'บันทึกการเปลี่ยนแปลง') { btn.click(); return 'confirm'; }
      }
      return 'none';
    })()`,
    { windowIndex },
  );
  await sleep(2800);

  const after = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = document.querySelector('#priceInMin');
      const body = document.body.innerText || '';
      const popupBits = [];
      for (const el of document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="toast"], [class*="Toast"]')) {
        const t = (el.innerText||'').trim();
        if (t && t.length < 800) popupBits.push(t);
      }
      const popupText = popupBits.join(' | ').slice(0, 500);
      const blocked = /ไม่สามารถ|error|failed|เกิน|invalid/i.test(popupText);
      return JSON.stringify({
        afterInput: priceInput && priceInput.value !== '' ? Number(priceInput.value) : null,
        onEdit: !!priceInput,
        popupText,
        blocked,
      });
    })()`,
    { windowIndex },
  );
  return { ...attempt, ...after, after: after?.afterInput ?? null };
}

export async function verifyPersistedPrice(tabIndex, itemId, name, windowIndex, category = "") {
  const page = await openEditItem(tabIndex, itemId, name, windowIndex, category);
  return page?.listPrice ?? null;
}

export async function mapPool(items, workers, fn) {
  const { windowIndex: baseWindow, tabIndices } = ensureWorkerTabs(workers);
  await sleep(workers > 1 ? 3500 : 2500);

  const results = new Array(items.length);
  let cursor = 0;

  async function worker(assignedTabIndex) {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;

      let windowIndex = baseWindow ?? cachedWindowIndex ?? 1;
      let tabIndex = assignedTabIndex;

      // Single-worker: re-resolve if Chrome closed/reordered the only tab.
      if (workers <= 1) {
        try {
          const found = findGrabTab();
          windowIndex = found.windowIndex;
          tabIndex = found.tabIndex;
        } catch {
          /* keep assigned */
        }
      }

      try {
        results[i] = await fn(tabIndex, items[i], i, windowIndex);
      } catch (e) {
        const msg = String(e.message || e);
        if (!/Invalid index|Can’t get tab|Can't get tab/i.test(msg)) throw e;
        // Recover: rebuild worker tabs once, then retry this item on a stable index.
        const rebuilt = ensureWorkerTabs(workers);
        const fallbackTi =
          rebuilt.tabIndices[tabIndices.indexOf(assignedTabIndex)] ?? rebuilt.tabIndices[0];
        results[i] = await fn(fallbackTi, items[i], i, rebuilt.windowIndex);
      }
    }
  }

  console.log(`Chrome workers: ${tabIndices.length} tabs @ window ${baseWindow} → [${tabIndices.join(",")}]`);
  await Promise.all(tabIndices.map((ti) => worker(ti)));
  return results;
}
