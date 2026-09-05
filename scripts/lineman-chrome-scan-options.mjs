#!/usr/bin/env node
/**
 * Parallel LINE MAN option-group scan (Wongnai menu-option edit pages).
 *
 *   node scripts/lineman-chrome-scan-options.mjs [--workers=6]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "data/menu-price-baseline/lineman-live-options.json");
const STOCK = join(__dir, "data/menu-price-baseline/lineman-stock-options.json");
const LIST = "https://merchant.wongnai.com/businesses/2688343/menu-option";
const URL_PART = "merchant.wongnai.com";

function runAS(script) {
  return execFileSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}
function b64Js(js) {
  return Buffer.from(js, "utf8").toString("base64");
}
function findWongnaiTab() {
  const out = runAS(`tell application "Google Chrome"
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
end tell`);
  const [w, t] = out.split(",").map(Number);
  return { windowIndex: w, tabIndex: t };
}
function chromeJsOnTab(tabIndex, js, opts = {}) {
  const windowIndex =
    typeof opts === "number"
      ? opts
      : Number(opts?.windowIndex);
  if (!Number.isFinite(windowIndex)) {
    throw new Error(`bad windowIndex: ${JSON.stringify(opts)}`);
  }
  const b64 = b64Js(js);
  const out = runAS(`tell application "Google Chrome"
  tell window ${windowIndex}
    set j to do shell script "echo ${b64} | base64 -D"
    return execute tab ${tabIndex} javascript j
  end tell
end tell`);
  if (!out || out === "missing value") return null;
  return out;
}
function chromeJsJsonOnTab(tabIndex, js, opts) {
  const raw = chromeJsOnTab(tabIndex, js, opts);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function ensureWorkerTabs(windowIndex, workers) {
  const raw = runAS(`tell application "Google Chrome"
  set out to ""
  set ti to 0
  repeat with tb in tabs of window ${windowIndex}
    set ti to ti + 1
    if URL of tb as string contains "${URL_PART}" then set out to out & (ti as string) & ","
  end repeat
  return out
end tell`);
  let indices = raw.split(",").filter(Boolean).map(Number);
  while (indices.length < workers) {
    const n = Number(
      runAS(`tell application "Google Chrome"
  tell window ${windowIndex}
    make new tab with properties {URL:"${LIST}"}
    return count of tabs
  end tell
end tell`),
    );
    indices.push(n);
  }
  return indices.slice(0, workers);
}

async function collectGroupLinks(tabIndex, windowIndex) {
  chromeJsOnTab(
    tabIndex,
    `(() => { location.href='${LIST}'; return 'ok'; })()`,
    { windowIndex },
  );
  await sleep(3000);
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const out = [];
      const seen = new Set();
      for (const a of document.querySelectorAll('a')) {
        const m = a.href.match(/menu-option\\/(0[a-zA-Z0-9]+)/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name: (a.innerText || '').trim().split('\\n')[0],
          url: 'https://merchant.wongnai.com/businesses/2688343/menu-option/' + id + '/edit',
        });
      }
      return JSON.stringify(out);
    })()`,
    { windowIndex },
  );
}

function readOptionEdit(tabIndex, windowIndex) {
  return chromeJsJsonOnTab(
    tabIndex,
    `(() => {
      const m = location.href.match(/menu-option\\/(0[a-zA-Z0-9]+)/);
      const nameInput = document.querySelector('input[name="name"], input[name="nameTh"], #name');
      const group = (nameInput && nameInput.value) || '';
      const options = [];
      const seen = new Set();
      // Choice prices render as text "+฿N" (not inputs). Free choices may have no +฿.
      for (const el of document.querySelectorAll('div')) {
        const tx = (el.innerText || '').trim();
        if (!tx.includes('มีจำหน่าย')) continue;
        if (tx.length > 180) continue;
        const lines = tx.split('\\n').map((s) => s.trim()).filter(Boolean);
        if (lines.length < 1) continue;
        const name = lines[0];
        if (!name || name.includes('เพิ่มช้อยส์') || name === 'มีจำหน่าย') continue;
        if (name === 'ช้อยส์' || name === 'แก้ไขลำดับ') continue;
        const prices = lines
          .filter((l) => /^[+\\-]?฿\\d+/.test(l) || /^\\+฿\\d+/.test(l))
          .map((l) => Number(String(l).replace(/[^0-9.]/g, '')))
          .filter((n) => Number.isFinite(n));
        // free / unchanged choice → 0
        const price = prices.length ? prices[0] : 0;
        if (seen.has(name)) continue;
        seen.add(name);
        options.push({ name, price, prices: prices.length ? prices : [0] });
      }
      return JSON.stringify({
        onEdit: /menu-option\\//.test(location.href) && /edit/.test(location.href),
        id: m ? m[1] : null,
        group,
        options,
        url: location.href,
      });
    })()`,
    { windowIndex: Number(windowIndex) },
  );
}

async function main() {
  const workersArg = process.argv.find((a) => a.startsWith("--workers="));
  const workers = workersArg
    ? Math.min(8, Math.max(1, Number(workersArg.slice(10))))
    : 4;
  const { windowIndex, tabIndex } = findWongnaiTab();
  let groups = await collectGroupLinks(tabIndex, windowIndex);
  if (!Array.isArray(groups) || !groups.length) {
    // fallback stock ids if list empty
    const stock = existsSync(STOCK) ? JSON.parse(readFileSync(STOCK, "utf8")) : null;
    groups = (stock?.options || stock?.groups || []).map((g) => ({
      id: g.id,
      name: g.name || g.group,
      url:
        g.url ||
        `https://merchant.wongnai.com/businesses/2688343/menu-option/${g.id}/edit`,
    })).filter((g) => g.id);
  }
  console.log(`=== LM options ×${workers} — ${groups.length} groups ===`);

  const tabs = ensureWorkerTabs(windowIndex, workers);
  await sleep(1000);
  const results = new Array(groups.length);
  let cursor = 0;
  async function worker(ti) {
    while (true) {
      const i = cursor++;
      if (i >= groups.length) break;
      const g = groups[i];
      chromeJsOnTab(
        ti,
        `(() => { location.href=${JSON.stringify(g.url)}; return 'ok'; })()`,
        { windowIndex },
      );
      await sleep(1700);
      let data = readOptionEdit(ti, windowIndex);
      if (!data?.options?.length) {
        await sleep(1400);
        data = readOptionEdit(ti, windowIndex);
      }
      console.log(
        `[${i + 1}/${groups.length}] ${(data?.group || g.name || "").slice(0, 36)} → ${data?.options?.length || 0}`,
      );
      results[i] = {
        id: data?.id || g.id,
        group: data?.group || g.name || "",
        options: data?.options || [],
        url: data?.url || g.url,
        error: data?.options?.length ? null : "no_options",
      };
    }
  }
  await Promise.all(tabs.map((ti) => worker(ti)));

  const flat = [];
  for (const r of results) {
    for (const o of r.options || []) {
      flat.push({
        group: r.group,
        name: o.name,
        price: o.price,
        url: r.url,
        id: r.id,
      });
    }
  }
  const out = {
    at: new Date().toISOString(),
    source: `wongnai option parallel-${workers}`,
    groups: results.length,
    okGroups: results.filter((r) => !r.error).length,
    options: flat,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`OK options ${flat.length} · groups ${out.okGroups}/${out.groups} → ${OUT}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
