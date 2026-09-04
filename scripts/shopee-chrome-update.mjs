#!/usr/bin/env node
/**
 * Update one Shopee menu price via Chrome (edit form) + verify.
 *
 *   node scripts/shopee-chrome-update.mjs --name "ชิโอปัง (Shio Pan) โฮมเมด ใหญ่ขึ้น" --price 30
 *   node scripts/shopee-chrome-update.mjs --name "..." --price 30 --apply
 *
 * Default: dry-run (shows current price only). Use --apply to save.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { chromeJsJson, normName, sleep } from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_CSV = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");

function loadTarget(name) {
  const rows = parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true });
  const row = rows.find((r) => normName(r.shopeeName) === normName(name));
  if (!row) throw new Error(`not in baseline: ${name}`);
  return Number(row.shopeePrice);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const name = get("--name");
  if (!name) {
    console.error("Usage: node scripts/shopee-chrome-update.mjs --name \"...\" [--price N] [--apply]");
    process.exit(1);
  }
  const priceRaw = get("--price");
  const price = priceRaw != null ? Number(priceRaw) : loadTarget(name);
  const apply = args.includes("--apply");
  return { name, price, apply };
}

async function openEditByName(name) {
  const esc = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const res = chromeJsJson(`(() => {
    if (!location.href.includes('/shopee-pos') || location.href.includes('/edit')) {
      location.href = 'https://partner.shopee.co.th/shopee-pos';
    }
    return JSON.stringify({ phase: 'nav' });
  })()`);
  await sleep(2500);

  chromeJsJson(`(() => {
    const target = "${esc}";
    for (const el of document.querySelectorAll('a, span, div, p')) {
      if ((el.innerText||'').trim() === target) { el.click(); return 'clicked'; }
    }
    const input = document.querySelector('input[placeholder*="ชื่อเมนู"], input[placeholder*="เมนู"]');
    if (input) {
      input.focus();
      input.value = target;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'searched';
    }
    return 'notfound';
  })()`);
  await sleep(2500);
}

async function readEditPrice() {
  return chromeJsJson(`(() => {
    const priceInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('ราคา') || (i.placeholder||'').includes('ใส่ราคา'));
    const nameInput = [...document.querySelectorAll('input[type="text"]')].find(i => !((i.placeholder||'').includes('ราคา')));
    return JSON.stringify({
      url: location.href,
      onEdit: location.href.includes('/edit'),
      name: nameInput?.value || '',
      price: priceInput?.value || '',
    });
  })()`);
}

async function setPriceAndSave(price, apply) {
  return chromeJsJson(`(() => {
    const priceInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('ราคา') || (i.placeholder||'').includes('ใส่ราคา'));
    if (!priceInput) return JSON.stringify({ error: 'no price input' });
    const before = priceInput.value;
    priceInput.focus();
    priceInput.value = '';
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
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
    return JSON.stringify({ error: 'save button not found', before, after: priceInput.value });
  })()`);
}

async function verifyOnList(name, expected) {
  chromeJsJson(`(() => { location.href = 'https://partner.shopee.co.th/shopee-pos'; return 'ok'; })()`);
  await sleep(2500);
  const esc = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return chromeJsJson(`(() => {
    const target = "${esc}";
    const text = document.body.innerText;
    const idx = text.indexOf(target);
    if (idx < 0) return JSON.stringify({ found: false });
    const chunk = text.slice(idx, idx + 120);
    const prices = [...chunk.matchAll(/฿([\\d,]+(?:\\.\\d+)?)/g)].map(m => Number(m[1].replace(/,/g,'')));
    const listPrice = prices[0] ?? null;
    return JSON.stringify({ found: true, prices, listPrice, ok: listPrice === ${expected} });
  })()`);
}

async function main() {
  const { name, price, apply } = parseArgs();
  console.log(`=== Shopee update ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log("Menu:", name);
  console.log("Target price:", price);

  await openEditByName(name);
  let state = await readEditPrice();
  console.log("Edit page:", state);

  if (!state?.onEdit) {
    throw new Error("Could not open edit page — check menu name on Shopee tab");
  }

  const current = Number(state.price);
  if (current === price) {
    console.log("Already at target price — skip");
    return;
  }

  const result = await setPriceAndSave(price, apply);
  console.log("Set price:", result);

  if (apply) {
    await sleep(3000);
    const verify = await verifyOnList(name, price);
    console.log("Verify list:", verify);
    if (!verify?.ok) {
      console.error("VERIFY FAILED — price on list does not match target");
      process.exit(2);
    }
    console.log("OK verified on list");
  } else {
    console.log("\nDry-run only. Re-run with --apply to save.");
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
