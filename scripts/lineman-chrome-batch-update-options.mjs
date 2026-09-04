#!/usr/bin/env node
/**
 * Apply hub option price targets on LINE MAN (Wongnai) via Chrome UI.
 * Path: remove choice → re-add with new delivery/pickup/offline → save group.
 *
 *   node scripts/lineman-chrome-batch-update-options.mjs [--dry-run] [--group=ท้อปปิ้ง] [--limit=N]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { applyChannelRule } from "./lib/hub-channel-targets.mjs";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const LIVE = join(DATA, "lineman-live-options.json");
const DIFF = join(DATA, "lineman-option-diffs.json");
const LOG = join(DATA, "lineman-option-update-log.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowBigJump = args.includes("--allow-big-jump");
const groupFilter = (args.find((a) => a.startsWith("--group=")) || "").slice(8);
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;

function runAS(script, timeoutMs = 180_000) {
  return execFileSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: timeoutMs,
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
      if URL of tb as string contains "merchant.wongnai.com" then
        return (wi as string) & "," & (ti as string)
      end if
    end repeat
  end repeat
  error "NO_WONGNAI_TAB"
end tell`);
  const [w, t] = out.split(",").map(Number);
  return { windowIndex: w, tabIndex: t };
}

function chromeJs(tabIndex, windowIndex, code) {
  const b64 = b64Js(code);
  const out = runAS(`tell application "Google Chrome"
  tell window ${windowIndex}
    set j to do shell script "echo ${b64} | base64 -D"
    return execute tab ${tabIndex} javascript j
  end tell
end tell`);
  if (!out || out === "missing value") return null;
  return out;
}

function chromeJson(tabIndex, windowIndex, code) {
  const raw = chromeJs(tabIndex, windowIndex, code);
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: String(raw || "").slice(0, 4000) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function buildDiffs() {
  const live = JSON.parse(readFileSync(LIVE, "utf8"));
  const db = await getSeedDb();
  const [settingsSnap, groupsSnap] = await Promise.all([
    getDoc(doc(db, "menuPriceHub", "settings")),
    getDocs(collection(db, "menuOptionGroups")),
  ]);
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const rule = settings.channels?.lineman || { mode: "gp", value: 30 };
  const overrides = settings.optionOverrides || {};

  const posOpts = [];
  for (const g of groupsSnap.docs) {
    const data = g.data() || {};
    if (data.active === false) continue;
    for (const c of data.options || []) {
      if (c.active === false) continue;
      posOpts.push({
        group: data.name || "",
        name: c.name || "",
        store: Number(c.priceDelta) || 0,
        key: `${g.id}::${c.id}`,
      });
    }
  }

  /** Match POS by group+name first — สุดคุ้ม names collide across promo groups. */
  function bestPos(group, name) {
    const n = norm(name);
    const g = norm(group);
    return (
      posOpts.find((p) => norm(p.group) === g && norm(p.name) === n) ||
      posOpts.find((p) => norm(p.name) === n) ||
      null
    );
  }

  const diffs = [];
  for (const o of live.options || []) {
    const pos = bestPos(o.group, o.name);
    if (!pos) continue;
    const ov = overrides[pos.key]?.lineman;
    const target = applyChannelRule(pos.store, ov || rule);
    const current = Number(o.price);
    if (current === target) continue;
    if (current > 0 && Math.abs(target - current) / current > 1 && !allowBigJump) {
      console.log(`skip >100% ${o.group} | ${o.name}: ${current}→${target}`);
      continue;
    }
    diffs.push({
      group: o.group,
      name: o.name,
      current,
      target,
      store: pos.store,
      url: o.url,
      id: o.id,
      posKey: pos.key,
    });
  }

  const byUrl = new Map();
  for (const d of diffs) {
    if (!byUrl.has(d.url)) byUrl.set(d.url, []);
    byUrl.get(d.url).push(d);
  }
  const groups = [...byUrl].map(([url, rows]) => ({
    url,
    group: rows[0].group,
    rows,
  }));
  const payload = { at: new Date().toISOString(), rule, diffs, byUrl: groups };
  writeFileSync(DIFF, JSON.stringify(payload, null, 2) + "\n");
  return payload;
}

function navigate(tabIndex, windowIndex, url) {
  chromeJs(
    tabIndex,
    windowIndex,
    `(()=>{ location.href=${JSON.stringify(url)}; return 'ok'; })()`,
  );
}

async function waitEdit(tabIndex, windowIndex, timeoutMs = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = chromeJson(
      tabIndex,
      windowIndex,
      `JSON.stringify({
        ready: document.readyState,
        hasSave: !!document.querySelector('[data-testid=option-form-save-button]'),
        url: location.href
      })`,
    );
    if (st?.hasSave && String(st.url || "").includes("/edit")) return st;
    await sleep(500);
  }
  return null;
}

function readChoiceSnippet(tabIndex, windowIndex, name) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const name=${JSON.stringify(name)};
      const esc=name.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');
      const tx=document.body.innerText||'';
      const re=new RegExp(esc+'[\\\\s\\\\S]{0,70}');
      const m=tx.match(re);
      return JSON.stringify({snippet:m&&m[0], has:tx.includes(name)});
    })()`,
  );
}

function removeChoice(tabIndex, windowIndex, name) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const name=${JSON.stringify(name)};
      let row=null;
      for (const el of document.querySelectorAll('div')) {
        const tx=(el.innerText||'').trim();
        if (!tx.startsWith(name)) continue;
        if (!tx.includes('+฿') && !tx.includes('฿')) continue;
        if (!tx.includes('มีจำหน่าย')) continue;
        if (tx.length > Math.max(120, name.length + 80)) continue;
        row=el;
        break;
      }
      if (!row) return JSON.stringify({ok:false, reason:'no-row'});
      const btns=[...row.querySelectorAll('button')];
      const xBtn=btns[btns.length-1];
      if (!xBtn) return JSON.stringify({ok:false, reason:'no-x'});
      xBtn.click();
      return JSON.stringify({ok:true, btnCount:btns.length});
    })()`,
  );
}

function openAddDialog(tabIndex, windowIndex) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const addBtn=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').includes('เพิ่มช้อยส์'));
      if (!addBtn) return JSON.stringify({ok:false, reason:'no-add'});
      addBtn.click();
      return JSON.stringify({ok:true});
    })()`,
  );
}

function fillAddDialog(tabIndex, windowIndex, { name, target, store }) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const name=${JSON.stringify(name)};
      const target=${Number(target)};
      const store=${Number(store)};
      const setNative=(el,val)=>{
        if (!el) return;
        const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
        desc.set.call(el, String(val));
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      };
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
      return JSON.stringify({ok:true, effect: target===0?'unchanged':'increased'});
    })()`,
  );
}

function fillPricesAndConfirm(tabIndex, windowIndex, { target, store }) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const target=${Number(target)};
      const store=${Number(store)};
      const setNative=(el,val)=>{
        if (!el) return;
        const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
        desc.set.call(el, String(val));
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      };
      if (target !== 0) {
        const delivery=document.querySelector('input[name=deliveryPrice]');
        const pickup=document.querySelector('input[name=selfPickupPrice]');
        const offline=document.querySelector('input[name=offlinePrice]');
        if (!delivery) return JSON.stringify({ok:false, reason:'no-price-inputs'});
        setNative(delivery, target);
        setNative(pickup, target);
        setNative(offline, store);
      }
      const saves=[...document.querySelectorAll('button')].filter(b=>(b.innerText||'').trim()==='บันทึก');
      const save=saves[saves.length-1];
      if (!save) return JSON.stringify({ok:false, reason:'no-dialog-save'});
      save.click();
      return JSON.stringify({ok:true});
    })()`,
  );
}

function saveGroup(tabIndex, windowIndex) {
  return chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const btn=document.querySelector('[data-testid=option-form-save-button]');
      if (!btn) return JSON.stringify({ok:false});
      btn.click();
      return JSON.stringify({ok:true});
    })()`,
  );
}

function liveHasTarget(snippet, name, target, from) {
  if (!snippet) return false;
  if (target === 0) return !new RegExp(`\\+฿${from}\\b`).test(snippet);
  return new RegExp(`\\+฿${target}\\b`).test(snippet);
}

async function applyGroup(tabIndex, windowIndex, group) {
  const result = { group: group.group, url: group.url, rows: [], ok: false };
  navigate(tabIndex, windowIndex, group.url);
  await sleep(2800);
  const ready = await waitEdit(tabIndex, windowIndex);
  if (!ready?.hasSave) {
    result.error = "edit-not-ready";
    return result;
  }

  // Wongnai rejects NBSP / special spaces in group names on save.
  chromeJson(
    tabIndex,
    windowIndex,
    `(()=>{
      const setNative=(el,val)=>{
        const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
        d.set.call(el,String(val));
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      };
      const clean=(s)=>String(s||'').replace(/[\\u00a0\\u200b\\u200c\\u200d\\ufeff]/g,' ').replace(/\\s+/g,' ').trim();
      for (const id of ['name','nameTh','nameEn']) {
        const el=document.querySelector('#'+id);
        if (!el) continue;
        const next=clean(el.value);
        if (next!==el.value) setNative(el, next);
      }
      return JSON.stringify({ok:true});
    })()`,
  );

  for (const row of group.rows) {
    const entry = { name: row.name, from: row.current, to: row.target, store: row.store };
    const rem = removeChoice(tabIndex, windowIndex, row.name);
    await sleep(450);
    if (!rem?.ok) {
      entry.error = "remove-failed";
      entry.rem = rem;
      result.rows.push(entry);
      continue;
    }
    const opened = openAddDialog(tabIndex, windowIndex);
    await sleep(550);
    if (!opened?.ok) {
      entry.error = "open-add-failed";
      result.rows.push(entry);
      continue;
    }
    const cleanRow = {
      ...row,
      name: String(row.name || "")
        .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    };
    const filled = fillAddDialog(tabIndex, windowIndex, cleanRow);
    await sleep(450);
    if (!filled?.ok) {
      entry.error = "fill-failed";
      entry.fill = filled;
      result.rows.push(entry);
      continue;
    }
    const priced = fillPricesAndConfirm(tabIndex, windowIndex, row);
    await sleep(700);
    if (!priced?.ok) {
      entry.error = "price-confirm-failed";
      entry.priced = priced;
      result.rows.push(entry);
      continue;
    }
    const snip = readChoiceSnippet(tabIndex, windowIndex, row.name);
    entry.draftSnippet = snip?.snippet || null;
    entry.draftOk = liveHasTarget(snip?.snippet, row.name, row.target, row.current);
    result.rows.push(entry);
  }

  if (dryRun) {
    result.ok = result.rows.every((r) => !r.error);
    result.dryRun = true;
    // reload to discard draft
    navigate(tabIndex, windowIndex, group.url);
    await sleep(2000);
    return result;
  }

  const sav = saveGroup(tabIndex, windowIndex);
  await sleep(4500);
  result.save = sav;

  navigate(tabIndex, windowIndex, group.url);
  await sleep(3200);
  await waitEdit(tabIndex, windowIndex);

  let allOk = true;
  for (const entry of result.rows) {
    if (entry.error) {
      allOk = false;
      continue;
    }
    const snip = readChoiceSnippet(tabIndex, windowIndex, entry.name);
    entry.liveSnippet = snip?.snippet || null;
    entry.liveOk = liveHasTarget(snip?.snippet, entry.name, entry.to, entry.from);
    if (!entry.liveOk) allOk = false;
  }
  result.ok = allOk && !!sav?.ok;
  return result;
}

async function main() {
  if (!existsSync(LIVE)) throw new Error("missing " + LIVE);
  console.log("Building diffs from live scan + POS hub…");
  const payload = await buildDiffs();
  let groups = payload.byUrl;
  if (groupFilter) groups = groups.filter((g) => g.group.includes(groupFilter));
  if (limit > 0) groups = groups.slice(0, limit);

  // Skip ชีส-only already done? Still include full topping group remaining.
  console.log(
    `Groups to apply: ${groups.length}, choices: ${groups.reduce((n, g) => n + g.rows.length, 0)} dryRun=${dryRun}`,
  );
  for (const g of groups) {
    console.log(
      ` - ${g.group}:`,
      g.rows.map((r) => `${r.name} ${r.current}->${r.target}`).join(" | "),
    );
  }

  if (!groups.length) {
    console.log("Nothing to do.");
    return;
  }

  const { windowIndex, tabIndex } = findWongnaiTab();
  console.log(`Chrome window=${windowIndex} tab=${tabIndex}`);

  const log = { at: new Date().toISOString(), dryRun, results: [] };

  for (const g of groups) {
    console.log(`\n=== ${g.group} (${g.rows.length}) ===`);
    const res = await applyGroup(tabIndex, windowIndex, g);
    log.results.push(res);
    const okN = res.rows.filter((r) => (dryRun ? !r.error && r.draftOk : r.liveOk)).length;
    console.log(`done ok=${res.ok} verified=${okN}/${res.rows.length}`, res.error || "");
    for (const r of res.rows) {
      console.log(
        `  ${r.name}: ${r.from}->${r.to} draft=${r.draftOk} live=${r.liveOk} ${r.error || ""}`,
      );
    }
    writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  const failed = log.results.filter((r) => !r.ok);
  console.log(`\nFinished. groups ok=${log.results.length - failed.length}/${log.results.length}`);
  console.log("log:", LOG);
  if (failed.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
