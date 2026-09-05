/**
 * Delete unused Grab modifier-group clones (0 linked menus) via Merchant UI.
 * Aborts immediately if the confirm dialog is not "มีผลต่อเมนู 0 รายการ"
 * or if any in-use group loses items.
 */
import { writeFileSync } from "node:fs";
import {
  findGrabTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";

const PLAN_PATH = "scripts/data/menu-price-baseline/grab-orphan-modifier-plan.json";
const LOG_PATH = "scripts/data/menu-price-baseline/grab-orphan-modifier-delete-log.json";

function fold(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMenu(raw) {
  const menu = JSON.parse(raw);
  const items = (menu.categories || []).flatMap((c) => c.items || []);
  const linkedFromItems = new Set(items.flatMap((it) => it.linkedModifierGroupIDs || []));
  const groups = (menu.modifierGroups || []).map((g) => {
    const related = g.relatedItemIDs || [];
    const linkedOnItem = linkedFromItems.has(g.modifierGroupID);
    return {
      id: g.modifierGroupID,
      name: g.modifierGroupName,
      fold: fold(g.modifierGroupName),
      related: related.length,
      linkedOnItem,
      used: related.length > 0 || linkedOnItem,
    };
  });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const byFold = new Map();
  for (const g of groups) {
    if (!byFold.has(g.fold)) byFold.set(g.fold, []);
    byFold.get(g.fold).push(g);
  }
  const itemLinkKey = items
    .map((it) => `${it.itemID}:${[...(it.linkedModifierGroupIDs || [])].sort().join(",")}`)
    .sort()
    .join("|");
  return { menu, items, groups, byId, byFold, itemLinkKey };
}

function fetchRawMenu(tabIndex, windowIndex) {
  const raw = chromeJsOnTab(
    tabIndex,
    `(() => {
      const x = new XMLHttpRequest();
      x.open('GET', 'https://api.grab.com/food/merchant/v2/menu', false);
      x.withCredentials = true;
      x.send(null);
      return x.responseText;
    })()`,
    { windowIndex }
  );
  if (!raw || raw.length < 1000) throw new Error("menu api empty len=" + (raw || "").length);
  return raw;
}

function keepFingerprint(parsed) {
  return parsed.groups
    .filter((g) => g.used)
    .map((g) => `${g.id}|${g.fold}|${g.related}|${g.linkedOnItem}`)
    .sort();
}

function pageInfo(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => JSON.stringify({
      url: location.href,
      title: document.title,
      hasDel: !!document.querySelector('[data-testid="btn-modgroup-delete"]')
        || [...document.querySelectorAll('button')].some(el => (el.innerText||'').trim() === 'ลบตัวเลือกเสริม')
    }))()`,
    { windowIndex }
  );
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

function clickDeleteAndReadDialog(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const delBtn = [...document.querySelectorAll('button')].find(el =>
        el.getAttribute('data-testid') === 'btn-modgroup-delete'
        || (el.innerText||'').trim() === 'ลบตัวเลือกเสริม'
      );
      if (!delBtn) return JSON.stringify({ ok: false, why: 'no-delete-btn' });
      delBtn.click();
      return JSON.stringify({ ok: true, step: 'clicked-delete' });
    })()`,
    { windowIndex }
  );
}

function readDialog(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const nodes = [...document.querySelectorAll('div,section,aside,[role=dialog]')];
      const dlg = nodes.find(el =>
        (el.innerText||'').includes('การลบจะมีผลต่อเมนู')
        && ((el.innerText||'').includes('แน่ใจ') || (el.innerText||'').includes('ต้องการลบ'))
      );
      if (!dlg) {
        return JSON.stringify({
          ok: false,
          why: 'no-dialog',
          hasSure: (document.body.innerText||'').includes('แน่ใจ')
        });
      }
      const t = dlg.innerText || '';
      const m = t.match(/การลบจะมีผลต่อเมนู\\s*(\\d+)\\s*รายการ/);
      const n = m ? Number(m[1]) : -1;
      return JSON.stringify({ ok: true, n, t: t.slice(0, 280) });
    })()`,
    { windowIndex }
  );
}

function confirmOrCancel(tabIndex, windowIndex, { confirm }) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const nodes = [...document.querySelectorAll('div,section,aside,[role=dialog]')];
      const dlg = nodes.find(el => (el.innerText||'').includes('การลบจะมีผลต่อเมนู'));
      if (!dlg) return JSON.stringify({ ok: false, why: 'no-dialog' });
      const want = ${confirm ? JSON.stringify("ลบ") : JSON.stringify("ยกเลิก")};
      const b = [...dlg.querySelectorAll('button')].find(x => (x.innerText||'').trim() === want);
      if (!b) return JSON.stringify({ ok: false, why: 'no-btn', want, t: (dlg.innerText||'').slice(0, 200) });
      b.click();
      return JSON.stringify({ ok: true, clicked: want });
    })()`,
    { windowIndex }
  );
}

/** Canonical Grab groups — never delete even if related=0. */
const PROTECTED_GROUP_IDS = new Set([
  "THMOG20260901152504029308",
  "THMOG20260901152504018148",
]);

function buildPlan(parsed) {
  const keep = [];
  const skip = [];
  const del = [];
  for (const g of parsed.groups) {
    const siblings = parsed.byFold.get(g.fold) || [];
    const usedSiblings = siblings.filter((s) => s.used && s.id !== g.id);
    const row = { ...g, usedSiblingCount: usedSiblings.length, usedSiblingIds: usedSiblings.map((s) => s.id) };
    if (PROTECTED_GROUP_IDS.has(g.id)) {
      row.verdict = "skip";
      row.reason = "SKIP protected canonical group";
      skip.push(row);
      continue;
    }
    if (g.used) {
      row.verdict = "keep";
      row.reason = `KEEP used related=${g.related} linkedOnItem=${g.linkedOnItem}`;
      keep.push(row);
      continue;
    }
    if (usedSiblings.length === 0) {
      row.verdict = "skip";
      row.reason = "SKIP unused with no used sibling — only copy of this name";
      skip.push(row);
      continue;
    }
    row.verdict = "delete";
    row.reason = `DELETE unused clone; keep used ${row.usedSiblingIds.join(",")}`;
    del.push(row);
  }
  return { keep, skip, delete: del };
}

const log = [];
function rec(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  console.log(JSON.stringify(entry));
}

const { windowIndex, tabIndex } = findGrabTab();
rec({ step: "tab", windowIndex, tabIndex });

let parsed = parseMenu(fetchRawMenu(tabIndex, windowIndex));
const plan = buildPlan(parsed);
writeFileSync(
  PLAN_PATH,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      counts: {
        groups: parsed.groups.length,
        items: parsed.items.length,
        keep: plan.keep.length,
        skip: plan.skip.length,
        delete: plan.delete.length,
      },
      keep: plan.keep,
      skip: plan.skip,
      delete: plan.delete,
    },
    null,
    2
  )
);

const baselineKeep = keepFingerprint(parsed);
const baselineItems = parsed.items.length;
const baselineLinkKey = parsed.itemLinkKey;
rec({
  step: "baseline",
  groups: parsed.groups.length,
  items: baselineItems,
  keep: plan.keep.length,
  skip: plan.skip.map((g) => ({ id: g.id, name: g.fold })),
  delete: plan.delete.length,
});

const targets = plan.delete.slice().sort((a, b) => a.id.localeCompare(b.id));
let deleted = 0;
let aborted = null;

for (const target of targets) {
  parsed = parseMenu(fetchRawMenu(tabIndex, windowIndex));
  const live = parsed.byId.get(target.id);
  const keepNow = keepFingerprint(parsed);
  if (keepNow.join("\n") !== baselineKeep.join("\n")) {
    aborted = {
      why: "keep-fingerprint-changed",
      id: target.id,
      before: baselineKeep,
      after: keepNow,
    };
    rec({ step: "abort", ...aborted });
    break;
  }
  if (parsed.items.length !== baselineItems) {
    aborted = { why: "item-count-changed", before: baselineItems, after: parsed.items.length };
    rec({ step: "abort", ...aborted });
    break;
  }
  if (parsed.itemLinkKey !== baselineLinkKey) {
    aborted = { why: "item-links-changed", id: target.id };
    rec({ step: "abort", ...aborted });
    break;
  }
  if (PROTECTED_GROUP_IDS.has(target.id)) {
    rec({ step: "skip-protected", id: target.id, name: target.fold });
    continue;
  }
  if (!live) {
    rec({ step: "already-gone", id: target.id, name: target.fold });
    continue;
  }
  if (live.used || live.related !== 0 || live.linkedOnItem) {
    aborted = { why: "target-now-used", id: target.id, live };
    rec({ step: "abort", ...aborted });
    break;
  }
  const usedSiblings = (parsed.byFold.get(live.fold) || []).filter((s) => s.used && s.id !== live.id);
  if (usedSiblings.length === 0) {
    aborted = { why: "no-used-sibling-anymore", id: target.id, name: live.fold };
    rec({ step: "abort", ...aborted });
    break;
  }

  const listUrl = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/modifierGroups`;
  const url = `${listUrl}/${target.id}`;
  async function waitDetail(label) {
    return waitFor(
      () => {
        const p = pageInfo(tabIndex, windowIndex);
        return p && String(p.url || "").includes(`/modifierGroups/${target.id}`) && p.hasDel ? p : null;
      },
      { tries: 16, delay: 500, label }
    );
  }
  async function openDetail() {
    chromeJsOnTab(tabIndex, `(() => { location.href=${JSON.stringify(listUrl)}; return 'ok'; })()`, { windowIndex });
    await sleep(1200);
    chromeJsOnTab(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, { windowIndex });
    return waitDetail(`open ${target.id}`);
  }
  try {
    await openDetail();
  } catch {
    chromeJsOnTab(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, { windowIndex });
    await sleep(800);
    chromeJsOnTab(tabIndex, `(() => { location.reload(); return 'ok'; })()`, { windowIndex });
    try {
      await waitDetail(`reload ${target.id}`);
    } catch (e) {
      aborted = { why: "page-not-ready", id: target.id, err: String(e.message || e), page: pageInfo(tabIndex, windowIndex) };
      rec({ step: "abort", ...aborted });
      break;
    }
  }

  const clicked = clickDeleteAndReadDialog(tabIndex, windowIndex);
  if (!clicked || clicked.ok === false) {
    aborted = { why: "click-delete-failed", id: target.id, clicked };
    rec({ step: "abort", ...aborted });
    break;
  }

  let dlg;
  try {
    dlg = await waitFor(
      () => {
        const d = readDialog(tabIndex, windowIndex);
        return d && d.ok ? d : null;
      },
      { tries: 15, delay: 250, label: `dialog ${target.id}` }
    );
  } catch (e) {
    aborted = { why: "no-dialog", id: target.id, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  if (dlg.n !== 0) {
    confirmOrCancel(tabIndex, windowIndex, { confirm: false });
    aborted = { why: "linked-not-zero", id: target.id, name: target.fold, n: dlg.n, t: dlg.t };
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
        const liveNow = parseMenu(fetchRawMenu(tabIndex, windowIndex));
        return liveNow.byId.has(target.id) ? null : liveNow;
      },
      { tries: 20, delay: 500, label: `gone ${target.id}` }
    );
  } catch (e) {
    aborted = { why: "still-present-after-confirm", id: target.id, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  deleted += 1;
  rec({
    step: "deleted",
    n: deleted,
    of: targets.length,
    id: target.id,
    name: target.fold,
    leftUsedSiblings: usedSiblings.map((s) => ({ id: s.id, related: s.related })),
  });
  await sleep(1800);
}

parsed = parseMenu(fetchRawMenu(tabIndex, windowIndex));
const finalKeep = keepFingerprint(parsed);
const summary = {
  aborted,
  deleted,
  attempted: targets.length,
  groupsNow: parsed.groups.length,
  itemsNow: parsed.items.length,
  keepUnchanged: finalKeep.join("\n") === baselineKeep.join("\n"),
  itemLinksUnchanged: parsed.itemLinkKey === baselineLinkKey,
  skipStillThere: parsed.byId.has("THMOG2025111605564276064"),
  usedNow: parsed.groups.filter((g) => g.used).map((g) => ({ id: g.id, name: g.fold, related: g.related })),
};
rec({ step: "done", ...summary });
writeFileSync(LOG_PATH, JSON.stringify({ log, summary }, null, 2));
console.log("---SUMMARY---");
console.log(JSON.stringify(summary, null, 2));
if (aborted) process.exit(2);
