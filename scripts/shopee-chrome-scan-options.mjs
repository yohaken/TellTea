#!/usr/bin/env node
/**
 * Parallel scan Shopee option groups → shopee-live-options.json
 *
 *   node scripts/shopee-chrome-scan-options.mjs [--workers=6]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromeJsOnTab,
  chromeJsJsonOnTab,
  sleep,
  mapPool,
} from "./lib/shopee-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CHECK = join(__dir, "data/menu-price-baseline/shopee-option-group-live-check.json");
const PREV = join(__dir, "data/menu-price-baseline/shopee-live-options.json");
const OUT = PREV;

function collectGroups() {
  const byId = new Map();
  if (existsSync(CHECK)) {
    const check = JSON.parse(readFileSync(CHECK, "utf8"));
    for (const g of check.scanned || []) {
      const id = (g.url || "").match(/id=(\d+)/)?.[1];
      if (id) byId.set(id, { id, url: g.url, group: g.group });
    }
  }
  if (existsSync(PREV)) {
    try {
      const prev = JSON.parse(readFileSync(PREV, "utf8"));
      for (const o of prev.options || []) {
        const id = (o.url || "").match(/id=(\d+)/)?.[1];
        if (id && !byId.has(id)) byId.set(id, { id, url: o.url, group: o.group });
      }
      for (const r of prev.raw || []) {
        const id = r.id || (r.url || "").match(/id=(\d+)/)?.[1];
        if (id && r.url && !byId.has(id)) byId.set(id, { id, url: r.url, group: r.group });
      }
    } catch {
      /* ignore broken prev */
    }
  }
  return [...byId.values()];
}

function readOptionGroup(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const m = location.href.match(/id=(\\d+)/);
      const title = [...document.querySelectorAll('input[type="text"]')].find(
        (i) => !((i.placeholder || "").includes("ราคา")),
      );
      const groupName = title?.value || "";
      const options = [];
      const seen = new Set();
      const priceCandidates = [...document.querySelectorAll("input")].filter(
        (i) =>
          (i.placeholder || "").includes("ราคา") ||
          (i.placeholder || "").includes("ใส่ราคา") ||
          i.type === "number" ||
          i.inputMode === "decimal",
      );
      for (const priceInput of priceCandidates) {
        const price = Number(String(priceInput.value).replace(/[,]/g, ""));
        if (!Number.isFinite(price)) continue;
        let root = priceInput.parentElement;
        let name = "";
        for (let d = 0; d < 8 && root; d++) {
          const nameInput = [...root.querySelectorAll('input[type="text"], input:not([type])')].find(
            (i) =>
              i !== priceInput &&
              !((i.placeholder || "").includes("ราคา")) &&
              !((i.placeholder || "").includes("ใส่ราคา")),
          );
          if (
            nameInput &&
            nameInput.value.trim() &&
            nameInput.value.trim() !== groupName
          ) {
            name = nameInput.value.trim();
            break;
          }
          root = root.parentElement;
        }
        if (!name) continue;
        const key = name + "|" + price;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ name, price });
      }
      return JSON.stringify({
        onEdit: location.href.includes("option-group/edit"),
        groupId: m ? m[1] : null,
        group: groupName,
        options,
        url: location.href,
      });
    })()`,
    { windowIndex },
  );
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg
    ? Math.min(10, Math.max(2, Number(workersArg.slice(10))))
    : 6;
  const groups = collectGroups();
  if (!groups.length) throw new Error("No option group URLs found");
  console.log(`=== Shopee option scan ×${workers} — ${groups.length} groups ===`);

  const results = await mapPool(groups, workers, async (tabIndex, g, i, windowIndex) => {
    chromeJsOnTab(
      tabIndex,
      `(() => { location.href=${JSON.stringify(g.url)}; return 'ok'; })()`,
      { windowIndex },
    );
    await sleep(1800);
    let data = readOptionGroup(tabIndex, windowIndex);
    if (!data?.onEdit || !data.options?.length) {
      await sleep(1500);
      data = readOptionGroup(tabIndex, windowIndex);
    }
    const n = data?.options?.length || 0;
    console.log(
      `[${i + 1}/${groups.length}] ${(data?.group || g.group || g.id).slice(0, 40)} → ${n}`,
    );
    return {
      id: g.id,
      url: g.url,
      group: data?.group || g.group || "",
      options: data?.options || [],
      error: !data?.onEdit ? "read_fail" : n ? null : "no_options",
    };
  });

  const flat = [];
  for (const r of results) {
    for (const o of r.options) {
      flat.push({ group: r.group, name: o.name, price: o.price, url: r.url });
    }
  }
  const out = {
    at: new Date().toISOString(),
    source: `shopee-option-group parallel-${workers}`,
    groups: results.length,
    okGroups: results.filter((r) => !r.error).length,
    options: flat,
    raw: results.map(({ id, url, group, options, error }) => ({
      id,
      url,
      group,
      count: options.length,
      error,
    })),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\nOK options ${flat.length} · groups ${out.okGroups}/${out.groups} → ${OUT}`,
  );
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
