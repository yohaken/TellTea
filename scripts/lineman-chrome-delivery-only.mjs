#!/usr/bin/env node
/**
 * Turn off LINE MAN pickup + storefront (Wongnai POS channels). Keep delivery only.
 *
 *   node scripts/lineman-chrome-delivery-only.mjs --dry-run
 *   node scripts/lineman-chrome-delivery-only.mjs --apply --workers=6
 *   node scripts/lineman-chrome-delivery-only.mjs --apply --limit=1
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findWongnaiTab,
  openEditItem,
  setDeliveryOnlyOnTab,
  listWongnaiMenuItems,
  chromeJsJsonOnTab,
  sleep,
  mapPool,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dir, "data/menu-price-baseline/lineman-delivery-only-log.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const workersArg = args.find((a) => a.startsWith("--workers="));
const workers = workersArg
  ? Math.min(8, Math.max(1, Number(workersArg.slice("--workers=".length))))
  : 6;
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;

function clickSave(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const buttons = [...document.querySelectorAll('button')].filter((b) => (b.innerText || '').trim() === 'บันทึก' && !b.disabled);
      const btn = buttons.find((b) => b.type === 'submit') || buttons[0];
      if (!btn) return JSON.stringify({ error: 'no save' });
      btn.click();
      return JSON.stringify({ saved: true });
    })()`,
    { windowIndex },
  );
}

async function one(tabIndex, item, _i, windowIndex) {
  if (!item.selfPickupAvailable && !item.offlineAvailable) {
    return { ...item, status: "skip_already_off" };
  }
  const page = await openEditItem(tabIndex, item.id, item.name, windowIndex, item.href);
  if (!page?.onEdit) return { ...item, status: "error", error: "edit page not open" };
  if (!apply) {
    return { ...item, status: "dry-run", pickup: item.selfPickupAvailable, offline: item.offlineAvailable };
  }
  const channels = setDeliveryOnlyOnTab(tabIndex, windowIndex);
  clickSave(tabIndex, windowIndex);
  await sleep(2800);
  return { ...item, status: "saved", channels };
}

async function main() {
  findWongnaiTab();
  const all = await listWongnaiMenuItems();
  const need = all.filter((it) => it.selfPickupAvailable || it.offlineAvailable);
  const queue = limit > 0 ? need.slice(0, limit) : need;
  console.log(
    `LM ${all.length} · already delivery-only ${all.length - need.length} · to close ${need.length} · queue ${queue.length}` +
      `${apply ? "" : " · dry-run"}`,
  );
  if (!queue.length) {
    console.log("ไม่มีรายการที่ยังเปิดรับที่ร้าน/หน้าร้าน");
    return;
  }
  const results = apply
    ? await mapPool(queue, Math.min(workers, queue.length), one)
    : queue.map((it) => ({ ...it, status: "dry-run" }));
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log("saved", counts);
  let still = [];
  if (apply) {
    const after = await listWongnaiMenuItems();
    still = after.filter((it) => it.selfPickupAvailable || it.offlineAvailable);
    console.log(`verify still open pickup/store: ${still.length}`);
    if (still.length) console.log(still.slice(0, 12).map((x) => x.name).join(" · "));
  }
  writeFileSync(
    LOG,
    JSON.stringify({ at: new Date().toISOString(), apply, counts, stillOpen: still.map((x) => x.name), results }, null, 2) + "\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message || e);
    process.exit(1);
  });
