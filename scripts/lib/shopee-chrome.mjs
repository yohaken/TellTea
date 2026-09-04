/**
 * Multi-tab Chrome control for Shopee Partner (AppleScript).
 */
import { execFileSync } from "node:child_process";

const URL_PART = "partner.shopee";
const LIST_URL = "https://partner.shopee.co.th/shopee-pos";
const STORE_QS = "storeId=10212109&defaultTab=sf";

let cachedWindowIndex = null;
let cachedBaseTabIndex = null;

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

/** Find 1-based window + tab index of first Shopee Partner tab. */
export function findShopeeTab() {
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
  error "NO_SHOPEE_TAB"
end tell
`;
  const out = runAppleScript(script);
  const [w, t] = out.split(",").map(Number);
  cachedWindowIndex = w;
  cachedBaseTabIndex = t;
  return { windowIndex: w, tabIndex: t };
}

export function chromeJsOnTab(tabIndex, js, { windowIndex } = {}) {
  const wi = windowIndex ?? cachedWindowIndex ?? findShopeeTab().windowIndex;
  const b64 = b64Js(js);
  const script = `
tell application "Google Chrome"
  tell window ${wi}
    set js to do shell script "echo ${b64} | base64 -D"
    return execute tab ${tabIndex} javascript js
  end tell
end tell
`;
  const out = runAppleScript(script);
  if (out === "missing value" || out === "") return null;
  return out;
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

/** Legacy single-tab helper (first Shopee tab). */
export function chromeJs(js, opts = {}) {
  const { tabIndex } = findShopeeTab();
  return chromeJsOnTab(tabIndex, js, opts);
}

export function chromeJsJson(js, opts) {
  const raw = chromeJs(js, opts);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function tabCount(windowIndex) {
  const wi = windowIndex ?? cachedWindowIndex ?? findShopeeTab().windowIndex;
  const script = `
tell application "Google Chrome"
  return count of tabs of window ${wi}
end tell
`;
  return Number(runAppleScript(script));
}

export function openTab(url, { windowIndex } = {}) {
  const wi = windowIndex ?? cachedWindowIndex ?? findShopeeTab().windowIndex;
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

export function closeTab(tabIndex, { windowIndex } = {}) {
  const wi = windowIndex ?? cachedWindowIndex ?? findShopeeTab().windowIndex;
  const script = `
tell application "Google Chrome"
  tell window ${wi}
    close tab ${tabIndex}
  end tell
end tell
`;
  runAppleScript(script);
}

/**
 * Ensure `workers` tabs dedicated to Shopee list (reuse Shopee tabs in window first).
 * Returns array of 1-based tab indices.
 */
export function ensureWorkerTabs(workers) {
  const { windowIndex, tabIndex: baseTab } = findShopeeTab();
  cachedWindowIndex = windowIndex;

  // Collect existing shopee-pos tabs in this window
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
  let indices = raw
    .split(",")
    .filter(Boolean)
    .map(Number);

  // Navigate existing shopee tabs to list
  for (const ti of indices) {
    chromeJsOnTab(ti, `(() => { location.href='${LIST_URL}'; return 'ok'; })()`, { windowIndex });
  }

  while (indices.length < workers) {
    openTab(LIST_URL, { windowIndex });
    // re-list after open — tab indices shift when tabs are added/closed
    const raw2 = runAppleScript(listScript);
    indices = raw2
      .split(",")
      .filter(Boolean)
      .map(Number);
  }

  if (indices.length < workers) {
    throw new Error(`need ${workers} Shopee tabs, got ${indices.length}`);
  }

  return indices.slice(0, workers);
}

export function editUrl(dishId) {
  return `https://partner.shopee.co.th/shopee-pos/menu-management/dish/edit?id=${dishId}&${STORE_QS}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseMenuListText(text) {
  const start = text.indexOf("ชื่อเมนู");
  if (start < 0) return [];
  const end = text.indexOf("จำนวนรายการต่อหน้า", start);
  const block = end > start ? text.slice(start, end) : text.slice(start, start + 50_000);
  const parts = block.split("\n\n\n").map((p) => p.trim()).filter(Boolean);
  const items = [];
  for (const p of parts) {
    if (p.startsWith("ชื่อเมนู")) continue;
    const lines = p.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    const name = lines[0];
    const prices = lines
      .filter((l) => l.startsWith("฿"))
      .map((l) => Number(l.replace(/[฿,]/g, "")))
      .filter((n) => Number.isFinite(n));
    if (!name || !prices.length) continue;
    items.push({
      name,
      prices,
      listPrice: prices[0],
      promoPrice: prices.length > 1 ? prices[1] : null,
      displayPrice: prices[prices.length - 1],
      hasPromo: prices.length > 1 && prices[0] !== prices[1],
    });
  }
  return items;
}

export function normName(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escJsString(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}

/** Read price + dish id from edit page on a tab. */
export function readEditPage(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('ราคา') || (i.placeholder||'').includes('ใส่ราคา'));
      const nameInput = [...document.querySelectorAll('input[type="text"]')].find(i => !((i.placeholder||'').includes('ราคา')));
      const m = location.href.match(/id=(\\d+)/);
      return JSON.stringify({
        onEdit: location.href.includes('/edit'),
        listPrice: priceInput ? Number(priceInput.value) : null,
        name: nameInput?.value || '',
        dishId: m ? m[1] : null,
        url: location.href,
      });
    })()`,
    { windowIndex },
  );
}

/** Search + open menu edit by name on a tab. */
export function openEditByName(tabIndex, name, windowIndex) {
  const esc = escJsString(name);
  const searchRes = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const LIST = '${LIST_URL}';
      if (!location.href.includes('/shopee-pos') || location.href.includes('/edit')) {
        location.href = LIST;
        return JSON.stringify({ phase: 'nav' });
      }
      for (const el of document.querySelectorAll('label, span, div')) {
        const t = (el.innerText||'').trim();
        if (t.startsWith('ทั้งหมด (')) { el.click(); break; }
      }
      const input = document.querySelector('input[placeholder*="ชื่อเมนู"], input[placeholder*="เมนู"]');
      if (input) {
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = "${esc}";
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ searched: true });
      }
      return JSON.stringify({ searched: false });
    })()`,
    { windowIndex },
  );
  return searchRes;
}

export function clickMenuName(tabIndex, name, windowIndex) {
  const esc = escJsString(name);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const target = "${esc}";
      for (const el of document.querySelectorAll('a, span, div, p')) {
        if ((el.innerText||'').trim() === target) {
          el.click();
          return JSON.stringify({ clicked: true });
        }
      }
      return JSON.stringify({ clicked: false });
    })()`,
    { windowIndex },
  );
}

export function goList(tabIndex, windowIndex) {
  chromeJsOnTab(
    tabIndex,
    `(() => {
      if (!location.href.includes('/shopee-pos') || location.href.includes('/edit')) {
        location.href = '${LIST_URL}';
        return 'nav';
      }
      for (const el of document.querySelectorAll('label, span, div')) {
        const t = (el.innerText||'').trim();
        if (t.startsWith('ทั้งหมด (')) { el.click(); return 'all'; }
      }
      return 'ok';
    })()`,
    { windowIndex },
  );
}

export function setPriceOnTab(tabIndex, price, apply, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('ราคา') || (i.placeholder||'').includes('ใส่ราคา'));
      if (!priceInput) return JSON.stringify({ error: 'no price input' });
      const before = priceInput.value;
      priceInput.focus();
      priceInput.value = String(${price});
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (!${apply ? "true" : "false"}) {
        return JSON.stringify({ dryRun: true, before, after: priceInput.value });
      }
      for (const btn of document.querySelectorAll('button')) {
        const t = (btn.innerText||'').trim();
        if (t === 'บันทึก' || t === 'Save') {
          btn.click();
          return JSON.stringify({ saved: true, before, after: priceInput.value });
        }
      }
      return JSON.stringify({ error: 'no save btn', before, after: priceInput.value });
    })()`,
    { windowIndex },
  );
}

/** Save price and read popup + field after brief wait. */
export async function savePriceAndRead(tabIndex, price, apply, windowIndex) {
  const attempt = setPriceOnTab(tabIndex, price, apply, windowIndex);
  if (!apply) return attempt;
  await sleep(1500);
  chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      for (const btn of document.querySelectorAll('button')) {
        const t = (btn.innerText||'').trim();
        if (/^(ตกลง|OK|Confirm|ยืนยัน|知道了)$/i.test(t)) { btn.click(); return 'ok'; }
      }
      return 'none';
    })()`,
    { windowIndex },
  );
  await sleep(2500);
  const after = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const priceInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('ราคา') || (i.placeholder||'').includes('ใส่ราคา'));
      const body = document.body.innerText || '';
      const popupBits = [];
      for (const el of document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"]')) {
        const t = (el.innerText||'').trim();
        if (t && t.length < 800) popupBits.push(t);
      }
      const popupText = popupBits.join(' | ').slice(0, 500);
      const blocked = /15%|15 %|เกิน|ไม่สามารถ|ไม่สามาร|ปรับราคา|price change|too (large|much)|โปรโมชัน|promotion/i.test(body + popupText);
      return JSON.stringify({
        afterInput: priceInput ? Number(priceInput.value) : null,
        onEdit: location.href.includes('/edit'),
        popupText,
        blocked,
      });
    })()`,
    { windowIndex },
  );
  return { ...attempt, ...after, after: after?.afterInput ?? null };
}

/** Re-open edit page and read persisted list price. */
export async function verifyPersistedPrice(tabIndex, dishId, windowIndex) {
  chromeJsOnTab(tabIndex, `(() => { location.href='${editUrl(dishId)}'; return 'ok'; })()`, {
    windowIndex,
  });
  await sleep(1800);
  const page = readEditPage(tabIndex, windowIndex);
  return page?.listPrice ?? null;
}

/** Rename menu on edit page (keeps current price). */
export function setNameOnTab(tabIndex, newName, apply, windowIndex) {
  const esc = escJsString(newName);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const nameInput = [...document.querySelectorAll('input[type="text"], input:not([type])')].find(i => !((i.placeholder||'').includes('ราคา')) && !((i.placeholder||'').includes('ใส่ราคา')));
      if (!nameInput) return JSON.stringify({ error: 'no name input' });
      const before = nameInput.value;
      if (before === "${esc}") {
        return JSON.stringify({ skip: true, before, after: before });
      }
      nameInput.focus();
      nameInput.value = "${esc}";
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (!${apply ? "true" : "false"}) {
        return JSON.stringify({ dryRun: true, before, after: nameInput.value });
      }
      for (const btn of document.querySelectorAll('button')) {
        const t = (btn.innerText||'').trim();
        if (t === 'บันทึก' || t === 'Save') {
          btn.click();
          return JSON.stringify({ saved: true, before, after: nameInput.value });
        }
      }
      return JSON.stringify({ error: 'no save btn', before, after: nameInput.value });
    })()`,
    { windowIndex },
  );
}

export async function mapPool(items, workers, fn) {
  const { windowIndex } = findShopeeTab();
  let tabIndices = ensureWorkerTabs(workers);
  await sleep(2000);

  const results = new Array(items.length);
  let cursor = 0;

  async function worker(slot) {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      let tabIndex = tabIndices[slot];
      try {
        results[i] = await fn(tabIndex, items[i], i, windowIndex);
      } catch (err) {
        const msg = String(err?.message || err);
        if (/Invalid index|Can’t get tab|Can't get tab/i.test(msg)) {
          tabIndices = ensureWorkerTabs(workers);
          tabIndex = tabIndices[slot] ?? tabIndices[0];
          await sleep(800);
          results[i] = await fn(tabIndex, items[i], i, windowIndex);
        } else {
          throw err;
        }
      }
    }
  }

  await Promise.all(tabIndices.map((_, slot) => worker(slot)));
  return results;
}
