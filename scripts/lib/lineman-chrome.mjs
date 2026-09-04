/**
 * Multi-tab Chrome control for Wongnai / LINE MAN merchant menu.
 */
import { execFileSync } from "node:child_process";

export const BUSINESS = "2688343";
const URL_PART = "merchant.wongnai.com";
export const MENU_URL = `https://merchant.wongnai.com/businesses/${BUSINESS}/menu`;

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

export function findWongnaiTab() {
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
  error "NO_WONGNAI_TAB"
end tell
`;
  const out = runAppleScript(script);
  const [w, t] = out.split(",").map(Number);
  cachedWindowIndex = w;
  return { windowIndex: w, tabIndex: t };
}

export function chromeJsOnTab(tabIndex, js, { windowIndex } = {}) {
  let wi = windowIndex ?? cachedWindowIndex;
  let ti = tabIndex;
  if (wi == null) {
    const found = findWongnaiTab();
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
    const found = findWongnaiTab();
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

export function openTab(url, { windowIndex } = {}) {
  const wi = windowIndex ?? cachedWindowIndex ?? findWongnaiTab().windowIndex;
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
  const found = findWongnaiTab();
  const { windowIndex, tabIndex } = found;
  cachedWindowIndex = windowIndex;

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

export function editUrl(id) {
  return `https://merchant.wongnai.com/businesses/${BUSINESS}/menu/${id}/edit`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Persisted GraphQL hashes used by merchant.wongnai.com */
export const WONGNAI_GQL = {
  menuItems: "26d2378baa24724cbaa5a9acd5171dd8d69e21a6219336e9eaa75145d78d5b90",
  menuItem: "838c7884e9234fcc79635072e5cc56372f572db0fba0010cc2145a234218c965",
};

/**
 * Run a Wongnai persisted query from the logged-in Chrome tab (wma-token).
 * Always injects JWT `sub` as userId. Does not print the token.
 */
export async function wongnaiGql(operationName, sha256Hash, variables = {}, timeoutMs = 20_000) {
  const key = `__wnGql_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { windowIndex, tabIndex } = findWongnaiTab();
  chromeJsOnTab(
    tabIndex,
    `(() => {
      const key = ${JSON.stringify(key)};
      window[key] = 'pending';
      (async () => {
        const token = localStorage.getItem('wma-token') || '';
        const userId = JSON.parse(atob(token.split('.')[1])).sub;
        const variables = { userId, ...${JSON.stringify(variables || {})} };
        const res = await fetch('https://rms-gateway.wongnai.com/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({
            operationName: ${JSON.stringify(operationName)},
            variables,
            extensions: { persistedQuery: { version: 1, sha256Hash: ${JSON.stringify(sha256Hash)} } },
          }),
        });
        window[key] = await res.json();
      })().catch((e) => { window[${JSON.stringify(key)}] = { err: String(e) }; });
      return 'started';
    })()`,
    { windowIndex },
  );
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(350);
    const found = findWongnaiTab();
    const val = chromeJsJsonOnTab(
      found.tabIndex,
      `(() => JSON.stringify(window[${JSON.stringify(key)}]))()`,
      { windowIndex: found.windowIndex },
    );
    if (val && val !== "pending") return val;
  }
  throw new Error(`wongnai gql timeout ${operationName}`);
}

export async function listWongnaiMenuItems() {
  const json = await wongnaiGql("menuItems", WONGNAI_GQL.menuItems, { businessId: BUSINESS });
  const data = json?.data?.my?.menu?.items?.data || [];
  return data.map((it) => ({
    id: it.id,
    name: it.name?.primary || it.name?.thai || "",
    nameEn: it.name?.english || "",
    status: it.menuStatus || "",
    listPrice: it.price?.exact ?? null,
    pickupPrice: it.selfPickupPrice?.exact ?? null,
    offlinePrice: it.offlinePrice?.exact ?? null,
    deliveryAvailable: it.deliveryAvailable !== false,
    selfPickupAvailable: it.selfPickupAvailable === true,
    offlineAvailable: it.offlineAvailable === true,
    categoryIds: it.menuGroupIds || [],
    href: editUrl(it.id),
  }));
}

export async function readWongnaiMenuItem(menuItemId) {
  const json = await wongnaiGql("menuItem", WONGNAI_GQL.menuItem, {
    businessId: BUSINESS,
    menuItemId,
  });
  const it = json?.data?.my?.menu?.item;
  if (!it) return { error: json?.err || json?.errors || "no item", raw: json };
  return {
    id: it.id,
    name: it.name?.primary || it.name?.thai || "",
    nameEn: it.name?.english || "",
    status: it.menuStatus || "",
    online: it.price?.exact ?? null,
    pickup: it.selfPickupPrice?.exact ?? null,
    offline: it.offlinePrice?.exact ?? null,
    deliveryAvailable: it.deliveryAvailable !== false,
    selfPickupAvailable: it.selfPickupAvailable === true,
    offlineAvailable: it.offlineAvailable === true,
    optionNames: (it.properties || []).map((p) => p.name?.primary || p.name?.thai).filter(Boolean),
    categoryIds: it.menuGroupIds || [],
    hasPhoto: !!it.image?.smallUrl,
  };
}

export function setDeliveryOnlyOnTab(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const setBox = (name, want) => {
        const el = document.querySelector('input[name="'+name+'"]');
        if (!el) return { name, ok: false };
        if (!!el.checked !== !!want) el.click();
        return { name, ok: true, checked: !!el.checked };
      };
      return JSON.stringify({
        online: setBox('onlineEnabled', true),
        pickup: setBox('pickUpEnabled', false),
        offline: setBox('offlineEnabled', false),
      });
    })()`,
    { windowIndex },
  );
}

export function readEditPage(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const m = location.href.match(/menu\\/(0[a-zA-Z0-9]+)\\/edit/);
      const nameInput = document.querySelector('input[name="name"], input[name="nameTh"]');
      const priceInputs = [...document.querySelectorAll('input[placeholder="ราคา"]')];
      const prices = priceInputs.map((i) =>
        Number(String(i.value || "").replace(/[฿,\\s]/g, "")),
      ).filter((n) => Number.isFinite(n));
      let listPrice = null;
      if (prices.length >= 3) listPrice = prices[0];
      else if (prices.length) listPrice = prices[0];
      const offline = prices.length >= 3 ? prices[2] : null;
      const text = document.body.innerText || '';
      const nameLocked = !!(nameInput && (nameInput.disabled || nameInput.readOnly));
      return JSON.stringify({
        onEdit: location.href.includes('/menu/') && location.href.includes('/edit'),
        name: nameInput?.value || '',
        listPrice,
        offlinePrice: offline,
        prices,
        id: m ? m[1] : null,
        url: location.href,
        nameLocked,
        menuBlocked: /ไม่สามารถแก้ไข|read.?only|locked/i.test(text) && nameLocked,
      });
    })()`,
    { windowIndex },
  );
}

/** Open Wongnai menu item edit page (direct URL). */
export async function openEditItem(tabIndex, id, _name, windowIndex, href) {
  const url = href || editUrl(id);
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`,
    { windowIndex },
  );
  for (let i = 0; i < 10; i++) {
    await sleep(i === 0 ? 1600 : 700);
    const page = readEditPage(tabIndex, windowIndex);
    if (page?.onEdit && page.listPrice != null) return page;
    if (page?.onEdit && i >= 2) return page;
  }
  return readEditPage(tabIndex, windowIndex);
}

export function setPriceOnTab(tabIndex, price, apply, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      try {
        const target = String(${Number(price)});
        const sanitize = (s) => String(s || '')
          .split('')
          .map((ch) => {
            const c = ch.charCodeAt(0);
            if (c === 160 || c === 8203 || c === 8204 || c === 8205 || c === 65279) return ' ';
            if ('()[]{}'.includes(ch)) return '';
            if (c === 8211 || c === 8212) return '-';
            return ch;
          })
          .join('')
          .replace(/\\s+/g, ' ')
          .trim();
        const setVal = (el, v) => {
          if (!el) return false;
          const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          el.focus();
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          return true;
        };
        const parse = (el) => Number(String(el?.value || '').replace(/[฿,\\s]/g, ''));

        const online = document.querySelector('#onlinePrice')
          || document.querySelector('input[placeholder="ราคา"]');
        const pickup = document.querySelector('#selfPickUpPrice');
        if (!online) return JSON.stringify({ error: 'no price input' });
        const before = parse(online);

        // Wongnai บล็อกเซฟทั้งฟอร์มถ้าชื่อมีอักษรพิเศษ / NBSP
        let nameFixed = false;
        for (const sel of ['#name', '#nameTh', '#nameEn', '#descriptionTh', '#descriptionEn']) {
          const el = document.querySelector(sel);
          if (!el || !('value' in el) || !el.value) continue;
          const cleaned = sanitize(el.value);
          if (cleaned !== el.value) {
            setVal(el, cleaned);
            nameFixed = true;
          }
        }

        setVal(online, target);
        if (pickup) setVal(pickup, target);

        if (!${apply ? "true" : "false"}) {
          return JSON.stringify({ dryRun: true, before, after: parse(online), nameFixed });
        }

        const buttons = [...document.querySelectorAll('button')]
          .filter((b) => (b.innerText || '').trim() === 'บันทึก');
        const prefer = buttons.find((b) => b.type === 'submit');
        const btn = prefer || buttons[buttons.length - 1] || buttons[0];
        if (!btn) return JSON.stringify({ error: 'no save btn', before, after: parse(online), nameFixed });
        btn.click();
        return JSON.stringify({
          saved: true,
          before,
          after: parse(online),
          nameFixed,
          saveLabel: (btn.innerText || '').trim(),
        });
      } catch (e) {
        return JSON.stringify({ error: String(e && e.message || e) });
      }
    })()`,
    { windowIndex },
  );
}

export async function savePriceAndRead(tabIndex, price, apply, windowIndex) {
  const attempt = setPriceOnTab(tabIndex, price, apply, windowIndex);
  if (!apply || attempt?.error || attempt?.dryRun) return attempt;
  await sleep(2500);

  for (let i = 0; i < 3; i++) {
    const clicked = chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        for (const btn of document.querySelectorAll('button')) {
          const t = (btn.innerText || '').trim();
          if (t === 'บันทึกการเปลี่ยนแปลง' || t === 'ยืนยัน' || t === 'ตกลง' || t === 'OK') {
            btn.click();
            return t;
          }
        }
        return 'none';
      })()`,
      { windowIndex },
    );
    if (clicked === 'none') break;
    await sleep(1200);
  }
  await sleep(2200);

  const after = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const online = document.querySelector('#onlinePrice')
        || document.querySelector('input[placeholder="ราคา"]');
      const popupBits = [];
      for (const el of document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="toast"], [class*="Toast"], [class*="Snackbar"]')) {
        const t = (el.innerText || '').trim();
        if (t && t.length < 800) popupBits.push(t);
      }
      const popupText = popupBits.join(' | ').slice(0, 500);
      const specialNameBlock = /ไม่สามารถใช้อักษรพิเศษได้/.test(document.body.innerText || '');
      const blocked = specialNameBlock || /ไม่สามารถบันทึก|บันทึกไม่สำเร็จ|ราคาไม่ถูกต้อง|เกินกำหนด|permission|forbidden/i.test(
        popupText + ' ' + (document.querySelector('[role="dialog"]')?.innerText || ''),
      );
      const afterVal = online ? Number(String(online.value || '').replace(/[฿,\\s]/g, '')) : null;
      return JSON.stringify({
        afterInput: Number.isFinite(afterVal) ? afterVal : null,
        onEdit: location.href.includes('/edit'),
        popupText,
        blocked,
        specialNameBlock,
      });
    })()`,
    { windowIndex },
  );
  return { ...attempt, ...after, after: after?.afterInput ?? null };
}

export async function verifyPersistedPrice(tabIndex, id, windowIndex, href) {
  const page = await openEditItem(tabIndex, id, "", windowIndex, href);
  return page?.listPrice ?? null;
}

export async function mapPool(items, workers, fn) {
  const { windowIndex: baseWindow, tabIndices } = ensureWorkerTabs(workers);
  await sleep(workers > 1 ? 2500 : 1500);

  const results = new Array(items.length);
  let cursor = 0;

  async function worker(assignedTabIndex) {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;

      let windowIndex = baseWindow ?? cachedWindowIndex ?? 1;
      let tabIndex = assignedTabIndex;

      if (workers <= 1) {
        try {
          const found = findWongnaiTab();
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
