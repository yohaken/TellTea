/**
 * Delete specific unused Grab modifier groups (related=0, not linked).
 * Aborts if confirm dialog is not "มีผลต่อเมนู 0 รายการ".
 *
 *   node scripts/grab-chrome-delete-zero-link-groups.mjs
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

const LOG_PATH = "scripts/data/menu-price-baseline/grab-zero-link-delete-log.json";
const PROTECTED = new Set([
  "THMOG20260901152504029308",
  "THMOG20260901152504018148",
]);

const args = process.argv.slice(2);
const allowProtected = args.includes("--allow-protected");
const idsArg = args.find((a) => a.startsWith("--ids="));

/** Default: misspelled leftover copies. Pass --ids= to target specific groups. */
const TARGET_IDS = idsArg
  ? idsArg
      .slice("--ids=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [
      "THMOG20260903085639097109",
      "THMOG20260903085635010042",
      "THMOG20260903033101017514",
      "THMOG20260903033055010261",
      "THMOG20260903033057074861",
    ];

const log = [];
function rec(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  console.log(JSON.stringify(entry));
}

function fold(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function liveGroups(menu) {
  const items = (menu.categories || []).flatMap((c) => c.items || []);
  const linked = new Set(items.flatMap((it) => it.linkedModifierGroupIDs || []));
  return (menu.modifierGroups || []).map((g) => ({
    id: g.modifierGroupID,
    name: g.modifierGroupName,
    related: (g.relatedItemIDs || []).length,
    linkedOnItem: linked.has(g.modifierGroupID),
  }));
}

function usedKey(menu) {
  return liveGroups(menu)
    .filter((g) => g.related > 0 || g.linkedOnItem)
    .map((g) => `${g.id}|${fold(g.name)}|${g.related}|${g.linkedOnItem}`)
    .sort()
    .join("\n");
}

async function waitFor(fn, { tries = 16, delay = 300, label = "wait" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = fn();
    if (last) return last;
    await sleep(delay);
  }
  throw new Error(`${label} timed out last=${JSON.stringify(last)}`);
}

const { windowIndex, tabIndex } = findGrabTab();
rec({ step: "tab", windowIndex, tabIndex });

let menu = fetchGrabMenuApi(tabIndex, windowIndex);
const baselineUsed = usedKey(menu);
const groups = liveGroups(menu);
const targets = TARGET_IDS.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
rec({
  step: "baseline",
  targets: targets.map((g) => ({ id: g.id, name: g.name, related: g.related, linkedOnItem: g.linkedOnItem })),
});

let deleted = 0;
let aborted = null;

for (const target of targets) {
  if (PROTECTED.has(target.id) && !allowProtected) {
    rec({ step: "skip-protected", id: target.id, name: target.name });
    continue;
  }
  menu = fetchGrabMenuApi(tabIndex, windowIndex);
  if (usedKey(menu) !== baselineUsed) {
    aborted = { why: "used-groups-changed", id: target.id };
    rec({ step: "abort", ...aborted });
    break;
  }
  const live = liveGroups(menu).find((g) => g.id === target.id);
  if (!live) {
    rec({ step: "already-gone", id: target.id, name: target.name });
    continue;
  }
  if (live.related > 0 || live.linkedOnItem) {
    aborted = { why: "now-used", id: target.id, live };
    rec({ step: "abort", ...aborted });
    break;
  }

  const url = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/modifierGroups/${target.id}`;
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(2200);

  const clicked = chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const delBtn = [...document.querySelectorAll('button')].find((el) =>
        el.getAttribute('data-testid') === 'btn-modgroup-delete'
        || (el.innerText || '').trim() === 'ลบตัวเลือกเสริม'
      );
      if (!delBtn) return JSON.stringify({ ok: false, why: 'no-delete-btn' });
      delBtn.click();
      return JSON.stringify({ ok: true });
    })()`,
    { windowIndex },
  );
  if (!clicked || clicked.ok === false) {
    aborted = { why: "click-delete-failed", id: target.id, clicked };
    rec({ step: "abort", ...aborted });
    break;
  }

  let dlg;
  try {
    dlg = await waitFor(
      () => {
        const d = chromeJsJsonOnTab(
          tabIndex,
          `(() => {
            const dlg = [...document.querySelectorAll('div,section,aside,[role=dialog]')].find((el) =>
              (el.innerText || '').includes('การลบจะมีผลต่อเมนู')
              && ((el.innerText || '').includes('แน่ใจ') || (el.innerText || '').includes('ต้องการลบ'))
            );
            if (!dlg) return JSON.stringify({ ok: false });
            const t = dlg.innerText || '';
            const m = t.match(/การลบจะมีผลต่อเมนู\\s*(\\d+)\\s*รายการ/);
            return JSON.stringify({ ok: true, n: m ? Number(m[1]) : -1, t: t.slice(0, 220) });
          })()`,
          { windowIndex },
        );
        return d && d.ok ? d : null;
      },
      { label: `dialog ${target.id}` },
    );
  } catch (e) {
    aborted = { why: "no-dialog", id: target.id, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  const confirm = (ok) =>
    chromeJsJsonOnTab(
      tabIndex,
      `(() => {
        const dlg = [...document.querySelectorAll('div,section,aside,[role=dialog]')].find((el) =>
          (el.innerText || '').includes('การลบจะมีผลต่อเมนู')
        );
        if (!dlg) return JSON.stringify({ ok: false });
        const want = ${JSON.stringify("PLACE")};
        const b = [...dlg.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === want);
        if (!b) return JSON.stringify({ ok: false, why: 'no-btn' });
        b.click();
        return JSON.stringify({ ok: true, clicked: want });
      })()`.replace("PLACE", ok ? "ลบ" : "ยกเลิก"),
      { windowIndex },
    );

  if (dlg.n !== 0) {
    confirm(false);
    aborted = { why: "linked-not-zero", id: target.id, name: target.name, n: dlg.n, t: dlg.t };
    rec({ step: "abort", ...aborted });
    break;
  }

  const confirmed = confirm(true);
  if (!confirmed || confirmed.ok === false) {
    aborted = { why: "confirm-failed", id: target.id, confirmed };
    rec({ step: "abort", ...aborted });
    break;
  }

  try {
    await waitFor(
      () => {
        const now = fetchGrabMenuApi(tabIndex, windowIndex);
        return liveGroups(now).some((g) => g.id === target.id) ? null : now;
      },
      { tries: 20, delay: 500, label: `gone ${target.id}` },
    );
  } catch (e) {
    aborted = { why: "still-present", id: target.id, name: target.name, err: String(e.message || e) };
    rec({ step: "abort", ...aborted });
    break;
  }

  deleted += 1;
  rec({ step: "deleted", n: deleted, of: targets.length, id: target.id, name: target.name });
  await sleep(1200);
}

menu = fetchGrabMenuApi(tabIndex, windowIndex);
const leftover = TARGET_IDS.filter((id) => liveGroups(menu).some((g) => g.id === id));
const summary = {
  aborted,
  deleted,
  attempted: targets.length,
  usedUnchanged: usedKey(menu) === baselineUsed,
  leftover,
};
rec({ step: "done", ...summary });
writeFileSync(LOG_PATH, JSON.stringify({ log, summary }, null, 2) + "\n");
console.log("---SUMMARY---");
console.log(JSON.stringify(summary, null, 2));
if (aborted) process.exit(2);
