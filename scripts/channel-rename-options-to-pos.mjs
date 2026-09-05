#!/usr/bin/env node
/**
 * Rename Grab / Shopee / LINE MAN option-group + choice names to POS storefront.
 *
 *   node scripts/channel-rename-options-to-pos.mjs --dry-run
 *   node scripts/channel-rename-options-to-pos.mjs --apply --channel=all
 *   node scripts/channel-rename-options-to-pos.mjs --apply --channel=lineman --workers=4
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { applyChannelRule, loadHubChannelContext } from "./lib/hub-channel-targets.mjs";
import { namesEqual } from "./lib/grab-csv.mjs";
import { writeHubChannelLiveRow } from "./lib/hub-live-write.mjs";
import { findShopeeTab, chromeJsJsonOnTab as shopeeJs } from "./lib/shopee-chrome.mjs";
import {
  findGrabTab,
  chromeJsJsonOnTab as grabJs,
  chromeJsOnTab as grabGo,
  fetchGrabMenuApi,
  sleep as grabSleep,
  GRAB_STORE_ID,
} from "./lib/grab-chrome.mjs";
import {
  findWongnaiTab,
  chromeJsJsonOnTab as lmJs,
  chromeJsOnTab as lmGo,
  mapPool,
  sleep as lmSleep,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const SHOPEE_LIVE = join(DATA, "shopee-live-options.json");
const LM_LIVE = join(DATA, "lineman-live-options.json");
const LOG = join(DATA, "channel-rename-options-to-pos-log.json");
const SHOPEE_API = "https://foody.shopee.co.th/api/seller/store/option-groups";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const channelArg = (args.find((a) => a.startsWith("--channel=")) || "--channel=all").slice(10);
const workers = Math.min(6, Math.max(1, Number((args.find((a) => a.startsWith("--workers=")) || "").slice(10)) || 4));
const channels = channelArg === "all" ? ["shopee", "grab", "lineman"] : channelArg.split(",").map((s) => s.trim());

function wsNorm(s) {
  return String(s || "")
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNbsp(s) {
  return /[\u00a0\u200b\u200c\u200d\ufeff]/.test(String(s || ""));
}

/** Rename live → POS only when POS is the cleaner spelling (no NBSP). */
function shouldRename(from, to) {
  if (!from || !to || from === to) return false;
  if (hasNbsp(to) && !hasNbsp(from) && wsNorm(from) === wsNorm(to)) return false;
  return true;
}

async function loadPosGroups() {
  const db = await getSeedDb();
  const [{ channels: chSettings }, groupsSnap] = await Promise.all([
    loadHubChannelContext(),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const posGroups = [];
  for (const d of groupsSnap.docs) {
    const g = d.data() || {};
    if (g.active === false) continue;
    const choices = [];
    for (const c of g.options || []) {
      if (c.active === false) continue;
      choices.push({
        id: c.id,
        key: `${d.id}::${c.id}`,
        name: c.name || "",
        store: Math.max(0, Number(c.priceDelta) || 0),
      });
    }
    posGroups.push({ id: d.id, name: g.name || "", choices });
  }
  return { posGroups, chSettings };
}

function pairGroups(posGroups, liveGroups) {
  const used = new Set();
  const leftover = [];
  const scored = [];
  for (const pg of posGroups) {
    let best = null;
    for (const lg of liveGroups) {
      if (used.has(lg.key)) continue;
      if (!namesEqual(pg.name, lg.name)) continue;
      const related = Number(lg.related) || 0;
      if (!best || related > (Number(best.related) || 0)) best = lg;
    }
    if (!best) {
      leftover.push({ pos: pg.name });
      continue;
    }
    used.add(best.key);
    scored.push({ pos: pg, live: best });
  }
  for (const lg of liveGroups) {
    if (used.has(lg.key)) continue;
    const pos = posGroups.find((p) => namesEqual(p.name, lg.name));
    if (pos) {
      used.add(lg.key);
      scored.push({ pos, live: lg, extraClone: true });
    }
  }
  return { pairs: scored, leftover, unusedLive: liveGroups.filter((g) => !used.has(g.key)) };
}

function planFromPair(pos, live) {
  const groupRename = shouldRename(live.name, pos.name) ? { from: live.name, to: pos.name } : null;
  const used = new Set();
  const choiceRenames = [];
  const missing = [];
  for (const c of pos.choices) {
    const hit = (live.choices || []).find((o) => !used.has(o.id || o.name) && namesEqual(o.name, c.name));
    if (!hit) {
      missing.push(c);
      continue;
    }
    used.add(hit.id || hit.name);
    if (shouldRename(hit.name, c.name)) {
      choiceRenames.push({
        from: hit.name,
        to: c.name,
        liveId: hit.id,
        price: hit.price,
        posKey: c.key,
        store: c.store,
      });
    }
  }
  return { groupRename, choiceRenames, missing, live, pos };
}

function shopeeXhr(tabIndex, windowIndex, method, url, body) {
  return shopeeJs(
    tabIndex,
    `(() => {
      try {
        const x = new XMLHttpRequest();
        x.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, false);
        x.withCredentials = true;
        x.setRequestHeader("Content-Type", "application/json");
        x.send(${body != null ? JSON.stringify(JSON.stringify(body)) : "null"});
        let json = null;
        try { json = JSON.parse(x.responseText); } catch {}
        return JSON.stringify({ status: x.status, json });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    })()`,
    { windowIndex },
  );
}

function liveFromShopeeJson(opts) {
  const by = new Map();
  for (const o of opts || []) {
    const key = String(o.groupId || o.group);
    if (!by.has(key)) by.set(key, { key, name: o.group, related: 1, choices: [], groupId: o.groupId });
    by.get(key).choices.push({ name: o.name, id: o.optionId, price: o.price });
  }
  return [...by.values()];
}

function liveFromLmJson(opts) {
  const by = new Map();
  for (const o of opts || []) {
    const key = String(o.id || o.url || o.group);
    if (!by.has(key)) {
      by.set(key, {
        key,
        name: o.group,
        related: 1,
        choices: [],
        url: o.url,
        groupId: o.id,
      });
    }
    by.get(key).choices.push({ name: o.name, id: o.name, price: o.price });
  }
  return [...by.values()];
}

function liveFromGrabMenu(menu) {
  const items = (menu.categories || []).flatMap((c) => c.items || []);
  const linked = new Set(items.flatMap((it) => it.linkedModifierGroupIDs || []));
  return (menu.modifierGroups || [])
    .map((g) => {
      const related = (g.relatedItemIDs || []).length;
      const used = related > 0 || linked.has(g.modifierGroupID);
      return {
        key: g.modifierGroupID,
        name: g.modifierGroupName,
        related,
        used,
        choices: (g.modifiers || []).map((m) => ({
          name: m.modifierName,
          id: m.modifierID,
          price: m.priceInMin,
        })),
      };
    })
    .filter((g) => g.used);
}

async function applyShopee(plans) {
  const { windowIndex, tabIndex } = findShopeeTab();
  const out = [];
  for (const plan of plans) {
    const gid = plan.live.groupId || plan.live.key;
    if (!plan.groupRename && !plan.choiceRenames.length) continue;
    const get = shopeeXhr(tabIndex, windowIndex, "GET", `${SHOPEE_API}/${gid}`);
    const g = get?.json?.data;
    if (!g) {
      out.push({ group: plan.pos.name, status: "get-fail", get });
      continue;
    }
    const nameById = new Map(plan.choiceRenames.map((r) => [String(r.liveId), r.to]));
    const groupName = plan.groupRename?.to || g.name || g.group_name || "";
    const body = {
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
      options: (g.options || []).map((o) => ({
        id: String(o.option_id),
        name: nameById.get(String(o.option_id)) || o.option_name,
        rank: o.rank,
        price: String(o.price ?? "0"),
        available: o.available ? 1 : 0,
      })),
    };
    const put = shopeeXhr(tabIndex, windowIndex, "PUT", `${SHOPEE_API}/${gid}`, body);
    const ok = put?.status === 200 && put.json?.code === 0;
    out.push({
      group: plan.pos.name,
      groupId: gid,
      status: ok ? "renamed" : "fail",
      msg: put?.json?.msg || "",
      groupRename: plan.groupRename,
      choiceRenames: plan.choiceRenames,
    });
    console.log(`${ok ? "OK" : "FAIL"} Shopee ${plan.pos.name}`, put?.json?.msg || "");
  }
  return out;
}

async function applyGrab(plans) {
  const out = [];
  for (const plan of plans) {
    if (!plan.groupRename && !plan.choiceRenames.length) continue;
    const gid = plan.live.key;
    const url = `https://merchant.grab.com/food/menu/${GRAB_STORE_ID}/modifierGroups/${gid}`;
    const { windowIndex, tabIndex } = findGrabTab();
    grabGo(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, { windowIndex });
    await grabSleep(2800);
    const loc = findGrabTab();
    const payload = {
      groupFrom: plan.live.name,
      groupTo: plan.groupRename?.to || null,
      choices: plan.choiceRenames.map((r) => ({ from: r.from, to: r.to, id: r.liveId })),
      apply,
    };
    const result = grabJs(
      loc.tabIndex,
      `(() => {
        const p = ${JSON.stringify(payload)};
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const setVal = (el, v) => {
          el.focus();
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
        };
        const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];
        const changed = [];
        if (p.groupTo) {
          let gEl = document.querySelector('#modifierGroupName, input[name="modifierGroupName"]');
          if (!gEl) {
            gEl = inputs.find((i) => (i.value || '').trim() === p.groupFrom && !(i.id || '').startsWith('modifierName'));
          }
          if (gEl && (gEl.value || '').trim() !== p.groupTo) {
            setVal(gEl, p.groupTo);
            changed.push({ kind: 'group', from: p.groupFrom, to: p.groupTo, id: gEl.id });
          }
        }
        for (const row of p.choices) {
          let el = document.getElementById('modifierName[' + row.id + ']');
          if (!el) el = inputs.find((i) => (i.value || '').trim() === row.from);
          if (!el) { changed.push({ kind: 'choice', from: row.from, error: 'no-input' }); continue; }
          if ((el.value || '').trim() === row.to) { changed.push({ kind: 'choice', from: row.from, skip: true }); continue; }
          setVal(el, row.to);
          changed.push({ kind: 'choice', from: row.from, to: row.to, id: el.id });
        }
        if (!p.apply) return JSON.stringify({ dryRun: true, changed });
        const buttons = [...document.querySelectorAll('button')];
        const save = buttons.find((b) => {
          const t = (b.innerText || '').trim();
          return t === 'บันทึก' || t === 'Save' || /^บันทึก/.test(t);
        });
        if (!save) return JSON.stringify({ error: 'no-save', changed });
        if (save.disabled) return JSON.stringify({ error: 'save-disabled', changed });
        save.click();
        return JSON.stringify({ saved: true, changed, saveLabel: (save.innerText || '').trim() });
      })()`,
      { windowIndex: loc.windowIndex },
    );
    if (apply && result?.saved) await grabSleep(2500);
    out.push({ group: plan.pos.name, groupId: gid, status: result?.saved ? "renamed" : result?.dryRun ? "dry-run" : result?.error || "fail", result });
    console.log(`${result?.saved || result?.dryRun ? "OK" : "FAIL"} Grab ${plan.live.name} → ${plan.pos.name}`, result?.error || "");
  }
  return out;
}

function lmReadChoices(tabIndex, windowIndex) {
  return lmJs(
    tabIndex,
    `(() => {
      const nameInput = document.querySelector('input[name="name"], input[name="nameTh"], #name');
      const group = (nameInput && nameInput.value) || '';
      const options = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('div')) {
        const tx = (el.innerText || '').trim();
        if (!tx.includes('มีจำหน่าย')) continue;
        if (tx.length > 180) continue;
        const lines = tx.split('\\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) continue;
        const name = lines[0];
        if (!name || name.includes('เพิ่มช้อยส์') || name === 'มีจำหน่าย') continue;
        if (name === 'ช้อยส์' || name === 'แก้ไขลำดับ') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        options.push(name);
      }
      return JSON.stringify({
        onEdit: /menu-option\\//.test(location.href) && /edit/.test(location.href),
        group,
        options,
        hasSave: !!document.querySelector('[data-testid=option-form-save-button]'),
      });
    })()`,
    { windowIndex },
  );
}

async function applyLineman(plans, linemanRule) {
  const jobs = plans.filter((p) => p.groupRename || p.choiceRenames.length || p.missing.length);
  const results = [];
  await mapPool(jobs, workers, async (tabIndex, plan, i, windowIndex) => {
    const url = plan.live.url;
    lmGo(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, { windowIndex });
    await lmSleep(2200);
    const ready = lmReadChoices(tabIndex, windowIndex);
    if (!ready?.onEdit) {
      const r = { group: plan.pos.name, status: "edit-not-ready" };
      results[i] = r;
      console.log(`[LM ${i + 1}/${jobs.length}] error ${plan.pos.name}`);
      return r;
    }

    const setNativeJs = `(el,val)=>{
      const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      d.set.call(el,String(val));
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }`;

    if (plan.groupRename) {
      lmJs(
        tabIndex,
        `(() => {
          const setNative=${setNativeJs};
          const want=${JSON.stringify(plan.groupRename.to)};
          const el=document.querySelector('#nameTh, #name, input[name="nameTh"], input[name="name"]');
          if (!el) return JSON.stringify({ok:false});
          setNative(el, want);
          return JSON.stringify({ok:true, after: el.value});
        })()`,
        { windowIndex },
      );
    }

    for (const row of plan.choiceRenames) {
      lmJs(
        tabIndex,
        `(() => {
          const from=${JSON.stringify(row.from)};
          for (const el of document.querySelectorAll('div')) {
            const tx=(el.innerText||'').trim();
            if (!tx.startsWith(from) && !tx.startsWith(from.replace(/\\s+/g,' '))) continue;
            if (!tx.includes('มีจำหน่าย')) continue;
            if (tx.length > Math.max(140, from.length + 80)) continue;
            const btns=[...el.querySelectorAll('button')];
            const xBtn=btns[btns.length-1];
            if (!xBtn) return JSON.stringify({ok:false, reason:'no-x'});
            xBtn.click();
            return JSON.stringify({ok:true});
          }
          return JSON.stringify({ok:false, reason:'no-row'});
        })()`,
        { windowIndex },
      );
      await lmSleep(450);
      const target = applyChannelRule(row.store || 0, linemanRule);
      lmJs(
        tabIndex,
        `(() => {
          const addBtn=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').includes('เพิ่มช้อยส์'));
          if (!addBtn) return JSON.stringify({ok:false});
          addBtn.click();
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(550);
      lmJs(
        tabIndex,
        `(() => {
          const setNative=${setNativeJs};
          const name=${JSON.stringify(row.to)};
          const target=${Number(target)};
          const store=${Number(row.store || 0)};
          const nameEl=document.querySelector('#choiceName');
          if (!nameEl) return JSON.stringify({ok:false});
          setNative(nameEl, name);
          const radios=[...document.querySelectorAll('input[name=choiceEffect]')];
          if (target === 0) {
            const u=radios.find(r=>r.value==='unchanged');
            if (u) u.click();
          } else {
            const inc=radios.find(r=>r.value==='increased');
            if (inc) inc.click();
          }
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(450);
      lmJs(
        tabIndex,
        `(() => {
          const setNative=${setNativeJs};
          const target=${Number(target)};
          const store=${Number(row.store || 0)};
          if (target !== 0) {
            const delivery=document.querySelector('input[name=deliveryPrice]');
            const pickup=document.querySelector('input[name=selfPickupPrice]');
            const offline=document.querySelector('input[name=offlinePrice]');
            if (delivery) setNative(delivery, target);
            if (pickup) setNative(pickup, target);
            if (offline) setNative(offline, store);
          }
          const saves=[...document.querySelectorAll('button')].filter(b=>(b.innerText||'').trim()==='บันทึก');
          const save=saves[saves.length-1];
          if (save) save.click();
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(700);
    }

    for (const c of plan.missing) {
      const target = applyChannelRule(c.store, linemanRule);
      lmJs(
        tabIndex,
        `(() => {
          const addBtn=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').includes('เพิ่มช้อยส์'));
          if (!addBtn) return JSON.stringify({ok:false, reason:'no-add'});
          addBtn.click();
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(550);
      lmJs(
        tabIndex,
        `(() => {
          const setNative=${setNativeJs};
          const name=${JSON.stringify(c.name)};
          const target=${Number(target)};
          const store=${Number(c.store)};
          const nameEl=document.querySelector('#choiceName');
          if (!nameEl) return JSON.stringify({ok:false, reason:'no-choiceName'});
          setNative(nameEl, name);
          const radios=[...document.querySelectorAll('input[name=choiceEffect]')];
          if (target === 0) {
            const u=radios.find(r=>r.value==='unchanged');
            if (u) u.click();
          } else {
            const inc=radios.find(r=>r.value==='increased');
            if (inc) inc.click();
          }
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(450);
      lmJs(
        tabIndex,
        `(() => {
          const setNative=${setNativeJs};
          const target=${Number(target)};
          const store=${Number(c.store)};
          if (target !== 0) {
            const delivery=document.querySelector('input[name=deliveryPrice]');
            const pickup=document.querySelector('input[name=selfPickupPrice]');
            const offline=document.querySelector('input[name=offlinePrice]');
            if (delivery) setNative(delivery, target);
            if (pickup) setNative(pickup, target);
            if (offline) setNative(offline, store);
          }
          const saves=[...document.querySelectorAll('button')].filter(b=>(b.innerText||'').trim()==='บันทึก');
          const save=saves[saves.length-1];
          if (!save) return JSON.stringify({ok:false});
          save.click();
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(700);
    }

    if (apply) {
      lmJs(
        tabIndex,
        `(() => {
          const btn=document.querySelector('[data-testid=option-form-save-button]');
          if (!btn) return JSON.stringify({ok:false});
          btn.click();
          return JSON.stringify({ok:true});
        })()`,
        { windowIndex },
      );
      await lmSleep(3500);
    }

    lmGo(tabIndex, `(() => { location.href=${JSON.stringify(url)}; return 'ok'; })()`, { windowIndex });
    await lmSleep(2200);
    const after = lmReadChoices(tabIndex, windowIndex);
    const names = new Set(after?.options || []);
    const renamed = plan.choiceRenames.filter((r) => names.has(r.to)).length;
    const added = plan.missing.filter((c) => names.has(c.name)).length;
    const r = {
      group: plan.pos.name,
      status: apply ? "applied" : "dry-run",
      after: after?.options || [],
      renamed,
      added,
      wantRename: plan.choiceRenames.length,
      wantAdd: plan.missing.length,
    };
    results[i] = r;
    console.log(`[LM ${i + 1}/${jobs.length}] ${plan.pos.name} renamed ${renamed}/${plan.choiceRenames.length} added ${added}/${plan.missing.length}`);
    return r;
  });
  return results.filter(Boolean);
}

function printPlan(label, plans, leftover) {
  const choiceN = plans.reduce((n, p) => n + p.choiceRenames.length, 0);
  const groupN = plans.filter((p) => p.groupRename).length;
  const missN = plans.reduce((n, p) => n + p.missing.length, 0);
  console.log(`=== ${label} ${apply ? "APPLY" : "DRY-RUN"} · group ${groupN} · choice ${choiceN} · missing ${missN} ===`);
  for (const p of plans) {
    if (p.groupRename) console.log(`  GROUP ${p.groupRename.from} → ${p.groupRename.to}`);
    for (const r of p.choiceRenames) console.log(`  ${p.live.name}: ${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}`);
    for (const c of p.missing) console.log(`  MISSING ${p.pos.name}: ${c.name}`);
  }
  if (leftover.length) {
    console.log(`  leftover POS groups: ${leftover.map((x) => x.pos).join(" | ")}`);
  }
}

async function writeHub(channel, plans, results) {
  for (const plan of plans) {
    for (const r of plan.choiceRenames) {
      if (!r.posKey) continue;
      await writeHubChannelLiveRow({
        posId: r.posKey,
        channel,
        name: r.to,
        price: r.price ?? null,
        scannedAt: new Date().toISOString(),
        externalId: String(r.liveId || ""),
        source: "rename-option",
        scope: "option",
      }).catch(() => false);
    }
  }
  void results;
}

async function main() {
  const { posGroups, chSettings } = await loadPosGroups();
  const log = { at: new Date().toISOString(), apply, channels, results: {} };

  if (channels.includes("shopee")) {
    const liveFile = existsSync(SHOPEE_LIVE) ? JSON.parse(readFileSync(SHOPEE_LIVE, "utf8")) : { options: [] };
    const liveGroups = liveFromShopeeJson(liveFile.options || []);
    const { pairs, leftover } = pairGroups(posGroups, liveGroups);
    const plans = pairs.map(({ pos, live }) => planFromPair(pos, live));
    printPlan("Shopee", plans, leftover);
    if (apply) {
      log.results.shopee = await applyShopee(plans);
      await writeHub("shopee", plans, log.results.shopee);
    } else {
      log.results.shopee = plans.map((p) => ({
        group: p.pos.name,
        groupRename: p.groupRename,
        choiceRenames: p.choiceRenames,
        missing: p.missing.map((c) => c.name),
      }));
    }
  }

  if (channels.includes("grab")) {
    const { windowIndex, tabIndex } = findGrabTab();
    const menu = fetchGrabMenuApi(tabIndex, windowIndex);
    const liveGroups = liveFromGrabMenu(menu);
    const { pairs, leftover } = pairGroups(posGroups, liveGroups);
    const plans = pairs.map(({ pos, live }) => planFromPair(pos, live));
    printPlan("Grab", plans, leftover);
    if (apply) {
      log.results.grab = await applyGrab(plans);
    } else {
      log.results.grab = plans.map((p) => ({
        group: p.pos.name,
        live: p.live.name,
        liveId: p.live.key,
        groupRename: p.groupRename,
        choiceRenames: p.choiceRenames,
        missing: p.missing.map((c) => c.name),
      }));
    }
  }

  if (channels.includes("lineman")) {
    const liveFile = existsSync(LM_LIVE) ? JSON.parse(readFileSync(LM_LIVE, "utf8")) : { options: [] };
    let liveGroups = liveFromLmJson(liveFile.options || []);
    try {
      const { windowIndex, tabIndex } = findWongnaiTab();
      lmGo(
        tabIndex,
        `(() => { location.href='https://merchant.wongnai.com/businesses/2688343/menu-option'; return 'ok'; })()`,
        { windowIndex },
      );
      await lmSleep(2500);
      const listed = lmJs(
        tabIndex,
        `(() => {
          const out = [];
          for (const a of document.querySelectorAll('a[href*="/menu-option/"]')) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/menu-option\\/(0[a-zA-Z0-9]+)/);
            if (!m) continue;
            const id = m[1];
            const name = (a.innerText || '').trim().split('\\n')[0];
            if (!name || /สร้าง/.test(name)) continue;
            out.push({
              key: id,
              name,
              related: 1,
              choices: [],
              url: 'https://merchant.wongnai.com/businesses/2688343/menu-option/' + id + '/edit',
              groupId: id,
            });
          }
          return JSON.stringify(out);
        })()`,
        { windowIndex },
      );
      for (const g of listed || []) {
        if (!liveGroups.some((x) => namesEqual(x.name, g.name))) liveGroups.push(g);
      }
      for (const g of liveGroups) {
        if ((g.choices || []).length || !g.url) continue;
        lmGo(
          tabIndex,
          `(() => { location.href=${JSON.stringify(g.url)}; return 'ok'; })()`,
          { windowIndex },
        );
        await lmSleep(2000);
        const page = lmReadChoices(tabIndex, windowIndex);
        if (page?.options?.length) {
          g.name = page.group || g.name;
          g.choices = page.options.map((name) => ({ name, id: name, price: null }));
        }
      }
    } catch (e) {
      console.warn("LINE MAN list fallback:", e.message);
    }
    const { pairs, leftover } = pairGroups(posGroups, liveGroups);
    const plans = pairs.map(({ pos, live }) => planFromPair(pos, live));
    printPlan("LINE MAN", plans, leftover);
    const linemanRule = chSettings.lineman || { mode: "gp", value: 30 };
    if (apply) {
      log.results.lineman = await applyLineman(plans, linemanRule);
    } else {
      log.results.lineman = plans.map((p) => ({
        group: p.pos.name,
        groupRename: p.groupRename,
        choiceRenames: p.choiceRenames,
        missing: p.missing.map((c) => c.name),
      }));
    }
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`→ ${LOG}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e.message || e);
    process.exit(1);
  });
