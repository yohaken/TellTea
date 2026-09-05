/**
 * Delete leftover empty Grab categories (0 items) via Merchant UI.
 * Aborts if the confirm dialog is not "เมนูทั้งหมด 0 รายการ".
 *
 *   node scripts/grab-chrome-delete-empty-categories.mjs
 */
import { writeFileSync } from "node:fs";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  fetchGrabMenuApi,
  sleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";

const LOG_PATH = "scripts/data/menu-price-baseline/grab-empty-category-delete-log.json";
const MENU_URL = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}`;

function fold(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const log = [];
function rec(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  console.log(JSON.stringify(entry));
}

async function waitFor(fn, { tries = 20, delay = 400, label = "wait" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = fn();
    if (last) return last;
    await sleep(delay);
  }
  throw new Error(`${label} timed out last=${JSON.stringify(last)}`);
}

function emptyCats(menu) {
  return (menu.categories || [])
    .filter((c) => !(c.items || []).length)
    .map((c) => ({ id: c.categoryID, name: c.categoryName || c.name || "" }));
}

function goMenu(tabIndex, windowIndex) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(MENU_URL)}; return 'ok'; })()`,
    { windowIndex },
  );
}

function scrollCatList(tabIndex, windowIndex, top) {
  const y = Number(top) || 0;
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const title = [...document.querySelectorAll("div")].find((el) =>
        el.className === "dui-card-head-title" && (el.innerText || "").trim() === "หมวดหมู่"
      );
      const card = title && title.closest(".dui-card");
      if (!card) return JSON.stringify({ ok: false, why: "no-card" });
      const row = [...card.querySelectorAll("div")].find((el) =>
        String(el.className || "").includes("sortable-item-row")
      );
      if (!row) return JSON.stringify({ ok: false, why: "no-row" });
      let p = row.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (p.scrollHeight > p.clientHeight + 20 && (cs.overflowY === "auto" || cs.overflowY === "scroll")) {
          p.scrollTop = ${y};
          p.dispatchEvent(new Event("scroll", { bubbles: true }));
          return JSON.stringify({
            ok: true,
            st: p.scrollTop,
            sh: p.scrollHeight,
            ch: p.clientHeight,
            names: [...card.querySelectorAll("div")]
              .filter((el) => String(el.className || "").includes("sortable-item-row"))
              .map((el) => ((el.innerText || "").split("\\n")[0] || "").trim())
          });
        }
        p = p.parentElement;
      }
      return JSON.stringify({ ok: false, why: "no-scroller" });
    })()`,
    { windowIndex },
  );
}

async function openEditWithScroll(tabIndex, windowIndex, name) {
  let last = null;
  let st = 0;
  for (let pass = 0; pass < 16; pass++) {
    const opened = openEdit(tabIndex, windowIndex, name);
    if (opened && opened.ok) return opened;
    last = opened;
    const sc = scrollCatList(tabIndex, windowIndex, st);
    st = Math.min((sc?.st || 0) + 140, Math.max(0, (sc?.sh || 900) - (sc?.ch || 400)));
    scrollCatList(tabIndex, windowIndex, st);
    await sleep(350);
  }
  return last || { ok: false, why: "not-found-after-scroll" };
}

function openEdit(tabIndex, windowIndex, name) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const want = ${JSON.stringify(fold(name))};
      const row = [...document.querySelectorAll('div')].find((el) => {
        if (!String(el.className || "").includes("sortable-item-row")) return false;
        const first = foldLine(el);
        return first === want;
      });
      function foldLine(el) {
        const line = ((el.innerText || "").split("\\n")[0] || "")
          .replace(/\\u00a0/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
        return line;
      }
      if (!row) return JSON.stringify({ ok: false, why: "no-row" });
      const count = (row.innerText || "").split("\\n").map((s) => s.trim()).find((s) => /^\\d+$/.test(s));
      if (count !== "0") return JSON.stringify({ ok: false, why: "row-not-empty", count, t: (row.innerText || "").slice(0, 80) });
      const edit = row.querySelector('[aria-label="editable"]');
      if (!edit) return JSON.stringify({ ok: false, why: "no-edit" });
      edit.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      edit.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
}

function clickDeleteCat(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const drawer = document.querySelector('.dui-drawer-open');
      const b = [...(drawer ? drawer.querySelectorAll('button') : document.querySelectorAll('button'))]
        .find((el) => (el.innerText || "").trim() === "ลบหมวดหมู่");
      if (!b) return JSON.stringify({ ok: false, why: "no-delete-btn" });
      b.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
}

function readConfirm(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const dlg = document.querySelector('.dui-modal-confirm');
      if (!dlg) return JSON.stringify({ ok: false, why: "no-dialog" });
      const t = dlg.innerText || "";
      const m = t.match(/เมนูทั้งหมด\\s*(\\d+)\\s*รายการ/);
      const n = m ? Number(m[1]) : -1;
      return JSON.stringify({ ok: true, n, t: t.slice(0, 280) });
    })()`,
    { windowIndex },
  );
}

function confirmOrCancel(tabIndex, windowIndex, { confirm }) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const dlg = document.querySelector('.dui-modal-confirm');
      if (!dlg) return JSON.stringify({ ok: false, why: "no-dialog" });
      const want = ${confirm ? JSON.stringify("ลบ") : JSON.stringify("ยกเลิก")};
      const b = [...dlg.querySelectorAll('button')].find((x) => (x.innerText || "").trim() === want);
      if (!b) return JSON.stringify({ ok: false, why: "no-btn", want, t: (dlg.innerText || "").slice(0, 200) });
      b.click();
      return JSON.stringify({ ok: true, clicked: want });
    })()`,
    { windowIndex },
  );
}

const { windowIndex, tabIndex } = findGrabTab();
rec({ step: "tab", windowIndex, tabIndex });

let menu = fetchGrabMenuApi(tabIndex, windowIndex);
const baselineItems = (menu.categories || []).flatMap((c) => c.items || []).length;
const targets = emptyCats(menu);
rec({
  step: "baseline",
  items: baselineItems,
  cats: (menu.categories || []).length,
  empty: targets,
});

goMenu(tabIndex, windowIndex);
await sleep(2800);

let deleted = 0;
let aborted = null;

for (const target of targets) {
  menu = fetchGrabMenuApi(tabIndex, windowIndex);
  const live = emptyCats(menu).find((c) => c.id === target.id);
  const itemsNow = (menu.categories || []).flatMap((c) => c.items || []).length;
  if (itemsNow !== baselineItems) {
    aborted = { why: "item-count-changed", before: baselineItems, after: itemsNow };
    rec({ step: "abort", ...aborted });
    break;
  }
  if (!live) {
    rec({ step: "already-gone", id: target.id, name: target.name });
    continue;
  }

  let opened;
  try {
    opened = await openEditWithScroll(tabIndex, windowIndex, target.name);
    if (!opened || opened.ok === false) {
      throw new Error(JSON.stringify(opened));
    }
  } catch (e) {
    aborted = { why: "open-edit-failed", id: target.id, name: target.name, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }
  rec({ step: "opened", id: target.id, name: target.name, opened });

  try {
    await waitFor(
      () => {
        const r = clickDeleteCat(tabIndex, windowIndex);
        return r && r.ok ? r : null;
      },
      { tries: 12, delay: 300, label: `delete-btn ${target.name}` },
    );
  } catch (e) {
    aborted = { why: "click-delete-failed", id: target.id, name: target.name, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  let dlg;
  try {
    dlg = await waitFor(
      () => {
        const d = readConfirm(tabIndex, windowIndex);
        return d && d.ok ? d : null;
      },
      { tries: 15, delay: 250, label: `dialog ${target.name}` },
    );
  } catch (e) {
    aborted = { why: "no-dialog", id: target.id, name: target.name, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  if (dlg.n !== 0) {
    confirmOrCancel(tabIndex, windowIndex, { confirm: false });
    aborted = { why: "not-empty", id: target.id, name: target.name, n: dlg.n, t: dlg.t };
    rec({ step: "abort", ...aborted });
    break;
  }

  const confirmed = confirmOrCancel(tabIndex, windowIndex, { confirm: true });
  if (!confirmed || confirmed.ok === false) {
    aborted = { why: "confirm-failed", id: target.id, confirmed };
    rec({ step: "abort", ...aborted });
    break;
  }

  try {
    await waitFor(
      () => {
        const now = fetchGrabMenuApi(tabIndex, windowIndex);
        return emptyCats(now).some((c) => c.id === target.id) ? null : now;
      },
      { tries: 20, delay: 500, label: `gone ${target.name}` },
    );
  } catch (e) {
    aborted = { why: "still-present-after-confirm", id: target.id, name: target.name, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  deleted += 1;
  rec({ step: "deleted", n: deleted, of: targets.length, id: target.id, name: target.name });
  await sleep(1200);
}

menu = fetchGrabMenuApi(tabIndex, windowIndex);
const leftover = emptyCats(menu);
const summary = {
  aborted,
  deleted,
  attempted: targets.length,
  itemsNow: (menu.categories || []).flatMap((c) => c.items || []).length,
  itemsUnchanged: (menu.categories || []).flatMap((c) => c.items || []).length === baselineItems,
  emptyLeft: leftover,
};
rec({ step: "done", ...summary });
writeFileSync(LOG_PATH, JSON.stringify({ log, summary }, null, 2) + "\n");
console.log("---SUMMARY---");
console.log(JSON.stringify(summary, null, 2));
if (aborted) process.exit(2);
