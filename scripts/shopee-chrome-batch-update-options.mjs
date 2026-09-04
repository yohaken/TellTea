#!/usr/bin/env node
/**
 * Apply hub option price targets on Shopee via option-group PUT (Chrome session).
 * Targets = POS priceDelta + Shopee rule in menuPriceHub/settings (GP 22%).
 *
 *   node scripts/shopee-chrome-batch-update-options.mjs --dry-run
 *   node scripts/shopee-chrome-batch-update-options.mjs --apply
 *
 * Prices are micros: ฿18 → "1800000". Option PUT limit is typically 100% (not 15%).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { applyChannelRule } from "./lib/hub-channel-targets.mjs";
import { normName } from "./lib/grab-csv.mjs";
import { findShopeeTab, chromeJsJsonOnTab, sleep } from "./lib/shopee-chrome.mjs";
import { nextStepPrice } from "./lib/shopee-price-step.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const LIVE = join(DATA, "shopee-live-options.json");
const LOG = join(DATA, "shopee-option-price-update-log.json");
const API = "https://foody.shopee.co.th/api/seller/store/option-groups";
const MICROS = 100_000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || !args.includes("--apply");
const groupFilter = (args.find((a) => a.startsWith("--group=")) || "").slice(8);

function fold(s) {
  return normName(s).replace(/ท้อปปิ้ง/g, "ท็อปปิ้ง").replace(/\s+/g, " ");
}
function scoreOpt(a, b) {
  const na = fold(a);
  const nb = fold(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return 0;
}
function baht(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n >= 1000) return Math.round(n / MICROS);
  return Math.round(n);
}
function micros(bahtVal) {
  return String(Math.max(0, Math.round(Number(bahtVal) || 0)) * MICROS);
}

function xhrOnTab(tabIndex, windowIndex, method, url, body) {
  const js = `(() => {
    try {
      const x = new XMLHttpRequest();
      x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
      x.withCredentials = true;
      x.setRequestHeader("Content-Type", "application/json");
      x.send(${body != null ? JSON.stringify(JSON.stringify(body)) : "null"});
      return JSON.stringify({ status: x.status, body: x.responseText });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  })()`;
  const raw = chromeJsJsonOnTab(tabIndex, js, { windowIndex });
  if (raw?.error) return raw;
  try {
    return { status: raw.status, json: JSON.parse(raw.body) };
  } catch {
    return { status: raw?.status, raw: String(raw?.body || "").slice(0, 2000) };
  }
}

async function buildPlan() {
  const live = JSON.parse(readFileSync(LIVE, "utf8"));
  const shopeeOpts = live.options || [];
  const db = await getSeedDb();
  const [groupsSnap, settingsSnap] = await Promise.all([
    getDocs(collection(db, "menuOptionGroups")),
    getDoc(doc(db, "menuPriceHub", "settings")),
  ]);
  const settings = settingsSnap.data() || {};
  const shopeeRule = settings.channels?.shopee || { mode: "gp", value: 22 };
  const optionOverrides = settings.optionOverrides || {};
  const posGroups = [];
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    const choices = [];
    for (const c of g.options || []) {
      if (c.active === false) continue;
      const key = `${d.id}::${c.id}`;
      const override = optionOverrides[key]?.shopee;
      const rule = override || shopeeRule;
      const store = Math.max(0, Number(c.priceDelta) || 0);
      choices.push({
        key,
        posGroup: g.name || "",
        name: c.name || "",
        store,
        target: applyChannelRule(store, rule),
      });
    }
    posGroups.push({ name: g.name || "", choices });
  }

  const byG = new Map();
  for (const o of shopeeOpts) {
    if (!byG.has(o.group)) byG.set(o.group, []);
    byG.get(o.group).push(o);
  }
  function bestGroup(posName, used) {
    let best = null;
    for (const g of byG.keys()) {
      if (used.has(g)) continue;
      const s = scoreOpt(posName, g);
      if (s < 0.85) continue;
      if (!best || s > best.score) best = { name: g, score: s, opts: byG.get(g) };
    }
    return best;
  }

  const usedG = new Set();
  const diffs = [];
  const same = [];
  for (const pg of posGroups) {
    const sg = bestGroup(pg.name, usedG);
    if (sg) usedG.add(sg.name);
    const used = new Set();
    for (const c of pg.choices) {
      let best = null;
      for (const o of sg?.opts || []) {
        const k = o.optionId || o.name;
        if (used.has(k)) continue;
        const s = scoreOpt(c.name, o.name);
        if (s < 0.85) continue;
        if (!best || s > best.score) best = { o, score: s, k };
      }
      if (!best) continue;
      used.add(best.k);
      const row = {
        group: pg.name,
        shopeeGroup: best.o.group,
        name: c.name,
        store: c.store,
        target: c.target,
        live: Number(best.o.price) || 0,
        optionId: String(best.o.optionId || ""),
        groupId: String(best.o.groupId || ""),
      };
      if (row.live !== row.target) {
        if (row.live > 0 && Math.abs(row.target - row.live) / row.live > 1) {
          console.log(`skip >100% ${row.group} | ${row.name}: ${row.live}→${row.target}`);
        } else {
          diffs.push(row);
        }
      } else same.push(row);
    }
  }
  return { live, shopeeRule, diffs, same };
}

function putBody(g, priceById) {
  const groupName = g.name || g.group_name || "";
  return {
    option_group: {
      group_id: String(g.group_id),
      name: groupName,
      group_name: groupName,
      remark: g.remark || "",
      shelve_state: g.shelve_state ? 1 : 0,
      select_min: g.select_min ?? 0,
      select_max: g.select_max ?? 0,
      select_mode: g.select_mode ?? 5,
    },
    options: (g.options || []).map((o) => {
      const id = String(o.option_id);
      const next = priceById.has(id) ? micros(priceById.get(id)) : String(o.price ?? "0");
      return {
        id,
        name: o.option_name,
        rank: o.rank,
        price: next,
        available: o.available ? 1 : 0,
      };
    }),
  };
}

function parseLimit(json) {
  const msg = JSON.stringify(json || {});
  const m = msg.match(/change_percent_limit["\s:]+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function liveFromGets(gets, prev) {
  const options = [];
  const groups = new Set();
  for (const g of gets) {
    const groupName = g.name || g.group_name || "";
    if (groupName) groups.add(groupName);
    for (const o of g.options || []) {
      options.push({
        group: groupName,
        name: o.option_name,
        price: baht(o.price),
        optionId: String(o.option_id || ""),
        groupId: String(g.group_id || ""),
        url: `https://partner.shopee.co.th/shopee-pos/menu-management/option-group/edit?id=${g.group_id}&storeId=10212109&defaultTab=sf`,
      });
    }
  }
  return {
    at: new Date().toISOString(),
    source: "shopee option-group API after price PUT",
    groups: groups.size || prev.groups,
    okGroups: groups.size || prev.okGroups,
    options,
  };
}

async function refreshLiveFromApi() {
  const prev = JSON.parse(readFileSync(LIVE, "utf8"));
  const { windowIndex, tabIndex } = findShopeeTab();
  const ids = [...new Set((prev.options || []).map((o) => o.groupId).filter(Boolean))];
  const gets = [];
  for (const gid of ids) {
    const get = xhrOnTab(tabIndex, windowIndex, "GET", `${API}/${gid}`);
    if (get.json?.data) gets.push(get.json.data);
    else console.log("GET fail", gid, get.json?.msg || get.error || get.status);
  }
  const rebuilt = liveFromGets(gets, prev);
  rebuilt.source = "shopee option-group API GET";
  writeFileSync(LIVE, JSON.stringify(rebuilt, null, 2) + "\n");
  console.log(`refreshed live ${rebuilt.options.length} options / ${rebuilt.groups} groups`);
  return rebuilt;
}

async function main() {
  if (!dryRun) await refreshLiveFromApi();
  const plan = await buildPlan();
  let diffs = plan.diffs;
  if (groupFilter) diffs = diffs.filter((d) => d.group.includes(groupFilter) || d.shopeeGroup.includes(groupFilter));
  const byGroup = new Map();
  for (const d of diffs) {
    if (!d.groupId) continue;
    if (!byGroup.has(d.groupId)) byGroup.set(d.groupId, []);
    byGroup.get(d.groupId).push(d);
  }

  console.log(
    JSON.stringify(
      {
        rule: plan.shopeeRule,
        diffs: diffs.length,
        same: plan.same.length,
        groups: byGroup.size,
        dryRun,
      },
      null,
      2,
    ),
  );
  for (const [gid, rows] of byGroup) {
    console.log(`\n[${rows[0].group}] ${gid}`);
    for (const r of rows) console.log(`  ${r.name}  ${r.live} → ${r.target}  (store ${r.store})`);
  }
  if (dryRun) {
    writeFileSync(
      LOG,
      JSON.stringify({ at: new Date().toISOString(), dryRun: true, diffs }, null, 2) + "\n",
    );
    return;
  }

  const { windowIndex, tabIndex } = findShopeeTab();
  const log = { at: new Date().toISOString(), dryRun: false, groups: [], failed: [] };
  const gets = [];
  const allIds = [...new Set((plan.live.options || []).map((o) => o.groupId).filter(Boolean))];

  for (const gid of allIds) {
    const rows = byGroup.get(gid) || [];
    const get = xhrOnTab(tabIndex, windowIndex, "GET", `${API}/${gid}`);
    const g = get.json?.data;
    if (!g) {
      log.failed.push({ groupId: gid, phase: "get", get });
      console.log(`GET fail ${gid}`, get.json?.msg || get.error || get.status);
      continue;
    }
    if (!rows.length) {
      gets.push(g);
      continue;
    }

    const applyPrices = new Map();
    for (const r of rows) applyPrices.set(r.optionId, r.target);
    let body = putBody(g, applyPrices);
    let put = xhrOnTab(tabIndex, windowIndex, "PUT", `${API}/${gid}`, body);
    const ok = put.status === 200 && put.json?.code === 0;
    if (!ok) {
      const limit = parseLimit(put.json);
      if (limit != null) {
        const stepped = new Map();
        for (const r of rows) {
          const step = nextStepPrice(r.live, r.target, limit / 100);
          stepped.set(r.optionId, step.apply);
        }
        body = putBody(g, stepped);
        put = xhrOnTab(tabIndex, windowIndex, "PUT", `${API}/${gid}`, body);
      }
    }
    await sleep(350);
    const verify = xhrOnTab(tabIndex, windowIndex, "GET", `${API}/${gid}`);
    const vg = verify.json?.data || g;
    gets.push(vg);
    const results = rows.map((r) => {
      const liveOpt = (vg.options || []).find((o) => String(o.option_id) === r.optionId);
      const liveBaht = liveOpt ? baht(liveOpt.price) : null;
      return { ...r, after: liveBaht, ok: liveBaht === r.target };
    });
    const allOk = results.every((r) => r.ok);
    log.groups.push({
      groupId: gid,
      group: rows[0].group,
      putStatus: put.status,
      putCode: put.json?.code,
      putMsg: put.json?.msg,
      results,
    });
    if (!allOk) log.failed.push({ groupId: gid, results, put: put.json });
    console.log(
      `${allOk ? "OK" : "PARTIAL"} ${rows[0].group}  ${results.filter((r) => r.ok).length}/${results.length}`,
    );
    for (const r of results) {
      if (!r.ok) console.log(`  still ${r.name}  ${r.after} (want ${r.target})`);
    }
  }

  const rebuilt = liveFromGets(gets, plan.live);
  if (rebuilt.options.length) {
    writeFileSync(LIVE, JSON.stringify(rebuilt, null, 2) + "\n");
    console.log(`wrote ${LIVE}  ${rebuilt.options.length} options / ${rebuilt.groups} groups`);
  }
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  const remain = (rebuilt.options.length ? rebuilt.options : plan.live.options).length;
  const still = diffs.filter((d) => {
    const o = rebuilt.options.find((x) => x.optionId === d.optionId);
    return !o || o.price !== d.target;
  });
  console.log(`remain diffs ${still.length} / ${diffs.length}  (live options ${remain})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).then(() => process.exit(0));
