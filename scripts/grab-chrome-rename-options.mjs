#!/usr/bin/env node
/**
 * Rename Grab modifier option names → POS (canonical in-use groups only).
 * Does not create new modifier groups / ZIP clones.
 *
 *   node scripts/grab-chrome-rename-options.mjs --dry-run
 *   node scripts/grab-chrome-rename-options.mjs --apply
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRAB_STORE_ID,
  chromeJsJsonOnTab,
  chromeJsOnTab,
  fetchGrabMenuApi,
  findGrabTab,
  sleep,
} from "./lib/grab-chrome.mjs";
import { normName } from "./lib/grab-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/grab-option-rename-log.json");
const apply = process.argv.includes("--apply");

const RENAMES = [
  {
    groupId: "THMOG20260901152504029308",
    group: "ท้อปปิ้ง",
    from: "บุกบราวน์ชูก้า",
    to: "บุกบราวน์",
    modifierId: "THMOD20260901152504104156",
  },
  {
    groupId: "THMOG20260901152504029308",
    group: "ท้อปปิ้ง",
    from: "ซอสบราวน์ชูก้า",
    to: "ซอสบราวน์",
    modifierId: "THMOD20260901152504129943",
  },
  {
    groupId: "THMOG20260901152504018148",
    group: "ช็อตกาแฟ",
    from: "เพิ่มช็อตกาแฟ",
    to: "เพิ่มช็อตกาแฟ 1 ช็อต",
    modifierId: "THMOD20260901152504025024",
  },
];

function fold(s) {
  return normName(s);
}

function tab() {
  return findGrabTab();
}

function groupUrl(id) {
  return `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/modifierGroups/${id}`;
}

function liveNames(menu, groupId) {
  const g = (menu.modifierGroups || []).find((x) => x.modifierGroupID === groupId);
  return (g?.modifiers || []).map((m) => m.modifierName);
}

async function openGroup(groupId) {
  const { windowIndex, tabIndex } = tab();
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(groupUrl(groupId))}; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(2800);
  return { windowIndex, tabIndex };
}

function renameOnPage(tabIndex, windowIndex, from, to) {
  const fromEsc = JSON.stringify(from);
  const toEsc = JSON.stringify(to);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const from = ${fromEsc};
      const to = ${toEsc};
      const apply = ${apply ? "true" : "false"};
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];
      let target = inputs.find((i) => (i.value || '').trim() === from);
      if (!target) {
        target = inputs.find((i) => (i.id || '').startsWith('modifierName') && (i.value || '').trim() === from);
      }
      if (!target) {
        return JSON.stringify({
          error: 'no-input',
          values: inputs.map((i) => (i.value || '').trim()).filter(Boolean).slice(0, 20),
        });
      }
      if ((target.value || '').trim() === to) {
        return JSON.stringify({ skip: true, id: target.id, before: from });
      }
      target.focus();
      setter.call(target, to);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      if (!apply) {
        return JSON.stringify({ dryRun: true, id: target.id, before: from, after: target.value });
      }
      const buttons = [...document.querySelectorAll('button')];
      const save = buttons.find((b) => {
        const t = (b.innerText || '').trim();
        return t === 'บันทึก' || t === 'Save' || /^บันทึก/.test(t);
      });
      if (!save) return JSON.stringify({ error: 'no-save', id: target.id, after: target.value });
      if (save.disabled) return JSON.stringify({ error: 'save-disabled', id: target.id, after: target.value });
      save.click();
      return JSON.stringify({ saved: true, id: target.id, saveLabel: (save.innerText || '').trim(), after: target.value });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const { windowIndex, tabIndex } = tab();
  let menu = fetchGrabMenuApi(tabIndex, windowIndex);
  const log = [];
  console.log(`=== Grab option rename ${apply ? "APPLY" : "DRY-RUN"} · ${RENAMES.length} ===`);

  const byGroup = new Map();
  for (const row of RENAMES) {
    if (!byGroup.has(row.groupId)) byGroup.set(row.groupId, []);
    byGroup.get(row.groupId).push(row);
  }

  for (const [groupId, rows] of byGroup) {
    await openGroup(groupId);
    const loc = tab();
    for (const row of rows) {
      const before = liveNames(menu, groupId);
      if (before.includes(row.to) && !before.includes(row.from)) {
        const rec = { ...row, status: "skip_already" };
        log.push(rec);
        console.log(`skip ${row.group}: ${row.to}`);
        continue;
      }
      const result = renameOnPage(loc.tabIndex, loc.windowIndex, row.from, row.to);
      console.log(`${row.group}: ${row.from} → ${row.to}`, result);
      if (apply && result?.saved) {
        await sleep(2500);
        menu = fetchGrabMenuApi(loc.tabIndex, loc.windowIndex);
      }
      const after = liveNames(menu, groupId);
      const ok = after.includes(row.to) && (apply ? !after.includes(row.from) || row.from === row.to : true);
      log.push({
        ...row,
        status: result?.skip ? "skip_already" : result?.dryRun ? "dry-run" : ok && apply ? "renamed" : result?.error || "verify_fail",
        result,
        after,
      });
    }
  }

  writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), apply, log }, null, 2) + "\n");
  const fail = log.filter((r) => r.status !== "renamed" && r.status !== "skip_already" && r.status !== "dry-run");
  console.log(`→ ${LOG}`);
  if (fail.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error("FAIL:", e.message || e);
  process.exit(1);
});
