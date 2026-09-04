#!/usr/bin/env node
/**
 * Probe Wongnai create-item form + a sibling template's settings (options, prices, category).
 * Read-only: clicks สร้างสินค้า and opens one existing edit page. Does not save.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findWongnaiTab,
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  MENU_URL,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "data/menu-price-baseline");

const TEA_URL =
  "https://merchant.wongnai.com/businesses/2688343/menu/0leDVTT5glqCay9uabVyCsgWzN16ZY/edit";
const SODA_URL =
  "https://merchant.wongnai.com/businesses/2688343/menu/0leDVTYJPpoUUwk6R7Ix9mk4FVKJQ9/edit";
const HOT_URL =
  "https://merchant.wongnai.com/businesses/2688343/menu/0leDkaOg5qRX5k5YUc9Hx5Ej5RNvM8/edit";

function js(tabIndex, windowIndex, code) {
  return chromeJsJsonOnTab(tabIndex, code, { windowIndex });
}
function go(tabIndex, windowIndex, url) {
  return chromeJsOnTab(
    tabIndex,
    `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`,
    { windowIndex },
  );
}

const FORM_DUMP = `(() => {
  const labels = [];
  for (const el of document.querySelectorAll('label, h1, h2, h3, h4, legend')) {
    const t = (el.innerText || '').trim().split('\\n')[0];
    if (t && t.length < 80) labels.push(t);
  }
  const inputs = [...document.querySelectorAll('input, textarea, select')].map((el) => ({
    tag: el.tagName,
    type: el.type || '',
    name: el.name || '',
    id: el.id || '',
    placeholder: el.placeholder || '',
    value: String(el.value || '').slice(0, 120),
    disabled: !!el.disabled,
    checked: el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : undefined,
  }));
  const buttons = [...new Set(
    [...document.querySelectorAll('button, a, [role="button"]')]
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 80))
      .filter((t) => t && t.length < 60),
  )];
  const text = document.body.innerText || '';
  const quotaHits = (text.match(/.{0,60}(จำกัด|โควตา|สูงสุด|เต็ม|ไม่สามารถสร้าง|รายการ).{0,60}/g) || []).slice(0, 30);
  return JSON.stringify({
    url: location.href,
    title: document.title,
    headings: [...new Set(labels)].slice(0, 100),
    inputs: inputs.slice(0, 100),
    buttons: buttons.slice(0, 80),
    quotaHits,
    sample: text.slice(0, 4500),
  });
})()`;

async function dumpPage(tabIndex, windowIndex, name) {
  const data = js(tabIndex, windowIndex, FORM_DUMP);
  writeFileSync(join(OUT, `lineman-${name}-probe.json`), JSON.stringify(data, null, 2) + "\n");
  return data;
}

async function main() {
  const { windowIndex, tabIndex } = findWongnaiTab();
  console.log("tab", { windowIndex, tabIndex });

  go(tabIndex, windowIndex, MENU_URL);
  await sleep(3500);

  const clickCreate = js(
    tabIndex,
    windowIndex,
    `(() => {
      const els = [...document.querySelectorAll('a, button, [role="button"], span, div')];
      const btn = els.find((el) => (el.innerText || '').trim() === 'สร้างสินค้า');
      if (!btn) {
        return JSON.stringify({
          error: 'no create btn',
          texts: [...new Set(els.map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 40))].slice(0, 40),
        });
      }
      btn.click();
      return JSON.stringify({ clicked: true, href: btn.href || '', tag: btn.tagName, className: String(btn.className || '').slice(0, 80) });
    })()`,
  );
  console.log("CLICK CREATE", JSON.stringify(clickCreate));
  await sleep(4000);

  const createForm = await dumpPage(tabIndex, windowIndex, "create-form");
  console.log("\n==== CREATE FORM ====");
  console.log("url", createForm?.url);
  console.log("headings", (createForm?.headings || []).join(" | "));
  console.log("buttons", (createForm?.buttons || []).join(" | "));
  console.log("quota", createForm?.quotaHits);
  console.log("inputs", JSON.stringify(createForm?.inputs, null, 2));
  console.log("sample\n", (createForm?.sample || "").slice(0, 2800));

  if (createForm?.url && !/create|new|add/i.test(createForm.url)) {
    const guesses = [
      "https://merchant.wongnai.com/businesses/2688343/menu/create",
      "https://merchant.wongnai.com/businesses/2688343/menu/new",
      "https://merchant.wongnai.com/businesses/2688343/menus/create",
    ];
    for (const g of guesses) {
      go(tabIndex, windowIndex, g);
      await sleep(2500);
      const p = js(
        tabIndex,
        windowIndex,
        `(() => JSON.stringify({ url: location.href, text: (document.body.innerText || '').slice(0, 300) }))()`,
      );
      console.log("GUESS", g, "->", p?.url, String(p?.text || "").slice(0, 100).replace(/\n/g, " | "));
    }
  }

  for (const [name, url] of [
    ["template-tea", TEA_URL],
    ["template-soda", SODA_URL],
    ["template-hot", HOT_URL],
  ]) {
    go(tabIndex, windowIndex, url);
    await sleep(4000);
    const page = await dumpPage(tabIndex, windowIndex, name);
    js(tabIndex, windowIndex, `(() => { window.scrollTo(0, document.body.scrollHeight); return 'ok'; })()`);
    await sleep(700);
    const extra = js(
      tabIndex,
      windowIndex,
      `(() => {
        const text = document.body.innerText || '';
        const idx = Math.max(text.indexOf('ตัวเลือก'), text.indexOf('ช้อยส์'), 0);
        const checks = [...document.querySelectorAll('input[type="checkbox"]')].map((el) => ({
          name: el.name,
          id: el.id,
          checked: el.checked,
          label: (el.closest('label')?.innerText || el.parentElement?.innerText || '').trim().slice(0, 100),
        }));
        const imgs = [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => s && !s.startsWith('data:')).slice(0, 8);
        return JSON.stringify({
          optionSlice: text.slice(idx, idx + 2200),
          checks: checks.slice(0, 50),
          imgs,
        });
      })()`,
    );
    writeFileSync(join(OUT, `lineman-${name}-options.json`), JSON.stringify(extra, null, 2) + "\n");
    console.log(`\n==== ${name} ====`);
    console.log("url", page?.url);
    console.log("headings", (page?.headings || []).join(" | "));
    console.log("inputs", JSON.stringify(page?.inputs, null, 2));
    console.log("optionSlice\n", extra?.optionSlice);
    console.log("checks", JSON.stringify(extra?.checks, null, 2));
    console.log("imgs", extra?.imgs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
