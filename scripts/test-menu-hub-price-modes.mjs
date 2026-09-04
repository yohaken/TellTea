/**
 * Hub price UI: GP% + คงที่, cell multi-select → ระบุราคา,
 * category-first sort, overrides must not fight column formulas / store / other channels.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const hub = read("src/components/PosMenuChannelPriceHub.tsx");
const lib = read("src/lib/menu-channel-price.ts");
const settingsLib = read("src/lib/menu-price-hub-settings.ts");
const css = read("src/app/globals.css");

assert.match(lib, /HUB_UI_PRICE_MODES/);
assert.match(lib, /\["gp", "absolute"\]/);
assert.match(lib, /shopee: \{ mode: "gp", value: 22 \}/);

assert.match(hub, /function HubPriceModeOptions/);
assert.match(hub, /function TargetPriceField/);
assert.match(hub, /onDoubleClick/);
assert.match(hub, /ตั้งเป้าคงที่/);
assert.match(hub, /mode: "absolute", value: price/);
assert.match(hub, /beginTargetEdit/);
assert.doesNotMatch(hub, /<option value="offset">มาร์จ<\/option>/);
assert.doesNotMatch(hub, /<option value="percent">%<\/option>/);
assert.match(hub, /<HubPriceModeOptions/);

assert.match(css, /\.mph-td\.is-sticky \{\s*background: #fff6e4/);
assert.match(css, /\.mph-td\.is-cat \{\s*background: #e8eef6/);
assert.match(css, /\.mph-th\.is-cat \{\s*background: #b7c8de/);
assert.match(css, /\.mph-target-edit/);

assert.match(hub, /const OPT_GROUP_TONES/);
assert.match(hub, /mph-opt-chip-tone/);
assert.match(css, /--mph-g-fill/);
assert.match(css, /--mph-g-accent/);
assert.doesNotMatch(css, /\.mph-opt-chip-g0/);
assert.doesNotMatch(hub, /OPT_GROUP_TONE_COUNT/);
assert.match(hub, /mph-menu-row/);
assert.match(hub, /catToneById/);
assert.match(css, /tr\.mph-menu-row \.mph-td\.is-cat/);

const accents = [...hub.matchAll(/accent: "(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
assert.ok(accents.length >= 20, `need 20+ group accents, got ${accents.length}`);
assert.equal(new Set(accents).size, accents.length, "group accent colors must be unique");

assert.match(hub, /useState<ColKey>\("cat"\)/);
assert.match(hub, /catRank\.get\(a\.item\.categoryId\)/);
assert.match(hub, /if \(catCmp !== 0\) return catCmp;/);
assert.match(hub, /if \(row\.storeOnly\) continue;/);

assert.doesNotMatch(hub, /ToneBucket/);
assert.doesNotMatch(hub, /ลังโทนราคา/);
assert.doesNotMatch(hub, /uniq price/);
assert.match(hub, /function cellSelKey/);
assert.match(hub, /function selectAllDisplayedCells/);
assert.match(hub, /function applySelectedTargets/);
assert.match(hub, /onSelectClick/);
assert.match(hub, /if \(e\.detail > 1\) return;/);
assert.match(hub, /mph-sel-bar/);
assert.match(hub, /mph-th-sel/);
assert.match(hub, /เลือกทั้งหมด/);
assert.match(hub, /กำหนดราคา/);
assert.match(settingsLib, /export function applyManyChannelOverrideWrites/);
assert.match(settingsLib, /setManyChannelOverrides/);
assert.match(lib, /fromOverride && rule.mode === "absolute"\) return "ระบุราคา"/);
assert.match(css, /\.mph-pair-t\.is-sel/);
assert.match(css, /\.mph-sel-bar/);

assert.match(hub, /rule: \{ mode: "absolute" as const, value:/);
assert.match(hub, /onClearOverride/);
assert.doesNotMatch(hub, /applySelectedTargets[\s\S]{0,400}item\.price\s*=/);

assert.match(hub, /const \[colFilterName, setColFilterName\]/);
assert.match(hub, /const \[colFilterCat, setColFilterCat\]/);
assert.match(hub, /const \[colFilterStore, setColFilterStore\]/);
assert.match(hub, /const \[colFilterNote, setColFilterNote\]/);
assert.match(hub, /function storePriceMatches/);
assert.match(hub, /function itemHubNoteText/);
assert.match(hub, /function isNoteEmptyFilterQuery/);
assert.match(hub, /function noteFilterMatches/);
assert.match(hub, /mph-th-empty/);
assert.match(hub, /setColFilterNote\(\(prev\) => \(isNoteEmptyFilterQuery\(prev\) \? "" : "ว่าง"\)\)/);
assert.match(css, /\.mph-th-empty/);
assert.match(hub, /function selectedMenuItemIdsFromSel/);
assert.match(hub, /function applySelectedNotes/);
assert.match(hub, /ใส่ note \$\{selectedNoteCount\} แถว/);
assert.match(hub, /function optionHubNoteText/);
assert.match(hub, /function selectedOptionNoteKeysFromSel/);
assert.match(hub, /function commitOptNote/);
assert.match(hub, /persistHideMenus/);
assert.match(hub, /persistHideStoreOnlyOptions/);
assert.match(hub, /เฉพาะตัวเลือก/);
assert.match(hub, /ตัวเลือก ร \{storeOnlyOptionCount\}/);
assert.match(hub, /HIDE_MENUS_KEY/);
assert.match(hub, /HIDE_STORE_ONLY_OPTS_KEY/);
assert.match(hub, /function optionGroupIdsUsedOnlyByStoreOnly/);
assert.match(hub, /function isOptionStoreOnlyRow/);
assert.match(hub, /if \(hideStoreOnlyOptions && r\.storeOnly\) return false;/);
assert.match(hub, /setMenuOptionChoiceHubNotes/);
assert.match(hub, /mph-sel-note/);
assert.match(hub, /mph-th-filter-input/);
assert.match(hub, /filterable = key === "name" \|\| key === "cat" \|\| key === "store" \|\| key === "note"/);
assert.match(hub, /function renderRowCheck/);
assert.match(hub, /function renderSelHead/);
assert.match(hub, /mph-sel-col/);
assert.match(hub, /mph-row-sel-hit/);
assert.match(hub, /mph-row-sel/);
assert.match(css, /\.mph-row-sel-hit/);
assert.match(css, /\.mph-row-sel/);
assert.match(css, /\.mph-td\.mph-sel-col/);
assert.match(css, /\.mph-sel-note/);
assert.match(css, /left: var\(--mph-sel-w/);
assert.match(css, /border-collapse: separate/);
assert.match(read("src/lib/pos-menu.ts"), /export async function setMenuItemHubNotes/);
assert.match(read("src/lib/pos-menu-options.ts"), /export async function setMenuOptionChoiceHubNotes/);
assert.match(read("src/lib/pos-menu-options.ts"), /row\.hubNote = o\.hubNote\.trim\(\)/);
assert.match(read("src/lib/types.ts"), /hubNote\?: string;/);

function applyChannelRule(base, rule) {
  const value = Number(rule.value) || 0;
  let raw;
  if (rule.mode === "absolute") raw = value;
  else if (rule.mode === "percent") raw = base * (1 + value / 100);
  else if (rule.mode === "gp") {
    const gp = Math.min(99.9, Math.max(0, value));
    const keep = 1 - gp / 100;
    raw = keep > 0 ? base / keep : base;
  } else raw = base + value;
  return Math.max(0, Math.round(raw));
}

function writeKeyedOverride(map, key, channel, rule) {
  const next = { ...map };
  const row = { ...(next[key] || {}) };
  if (rule == null) delete row[channel];
  else row[channel] = rule;
  if (!Object.keys(row).length) delete next[key];
  else next[key] = row;
  return next;
}

function applyMany(settings, writes) {
  let itemOverrides = settings.itemOverrides;
  let optionOverrides = settings.optionOverrides;
  for (const w of writes) {
    if (w.scope === "option") {
      optionOverrides = writeKeyedOverride(optionOverrides, w.id, w.channel, w.rule);
    } else {
      itemOverrides = writeKeyedOverride(itemOverrides, w.id, w.channel, w.rule);
    }
  }
  return { ...settings, itemOverrides, optionOverrides };
}

function resolveItem(settings, itemId, store, channel) {
  const override = settings.itemOverrides[itemId]?.[channel];
  if (override) return { target: applyChannelRule(store, override), fromOverride: true };
  return { target: applyChannelRule(store, settings.channels[channel]), fromOverride: false };
}

function badge(rule, fromOverride) {
  if (fromOverride && rule.mode === "absolute") return "ระบุราคา";
  const core =
    rule.mode === "absolute"
      ? `คงที่${rule.value}`
      : rule.mode === "gp"
        ? `GP${rule.value}`
        : `${rule.value}`;
  return fromOverride ? `ระบุ·${core}` : core;
}

const baseSettings = {
  channels: {
    shopee: { mode: "gp", value: 22 },
    grab: { mode: "gp", value: 30 },
    lineman: { mode: "gp", value: 30 },
  },
  itemOverrides: {},
  optionOverrides: {},
  tableNote: "keep-me",
};

const storeA = 30;
const storeB = 45;
assert.equal(resolveItem(baseSettings, "a", storeA, "shopee").target, 38);
assert.equal(resolveItem(baseSettings, "a", storeA, "grab").target, 43);
assert.equal(resolveItem(baseSettings, "a", storeA, "lineman").target, 43);
assert.equal(resolveItem(baseSettings, "a", storeA, "grab").fromOverride, false);

const afterGrab = applyMany(baseSettings, [
  { scope: "item", id: "a", channel: "grab", rule: { mode: "absolute", value: 29 } },
  { scope: "item", id: "b", channel: "grab", rule: { mode: "absolute", value: 29 } },
]);

assert.equal(afterGrab.tableNote, "keep-me");
assert.deepEqual(afterGrab.channels, baseSettings.channels);
assert.equal(storeA, 30);
assert.equal(resolveItem(afterGrab, "a", storeA, "grab").target, 29);
assert.equal(resolveItem(afterGrab, "a", storeA, "grab").fromOverride, true);
assert.equal(resolveItem(afterGrab, "b", storeB, "grab").target, 29);
assert.equal(resolveItem(afterGrab, "a", storeA, "shopee").target, 38);
assert.equal(resolveItem(afterGrab, "a", storeA, "lineman").target, 43);
assert.equal(resolveItem(afterGrab, "a", storeA, "shopee").fromOverride, false);
assert.equal(badge(afterGrab.itemOverrides.a.grab, true), "ระบุราคา");
assert.equal(badge(afterGrab.channels.shopee, false), "GP22");

const gpChanged = {
  ...afterGrab,
  channels: { ...afterGrab.channels, grab: { mode: "gp", value: 25 } },
};
assert.equal(resolveItem(gpChanged, "a", storeA, "grab").target, 29, "absolute override must ignore new column GP");
assert.equal(resolveItem(gpChanged, "c", storeA, "grab").target, 40, "cells without override follow new column GP");
assert.equal(resolveItem(gpChanged, "a", storeA, "shopee").target, 38, "other channel column GP unchanged");

const afterOpt = applyMany(afterGrab, [
  { scope: "option", id: "g::shot", channel: "shopee", rule: { mode: "absolute", value: 21 } },
]);
assert.equal(afterOpt.itemOverrides.a.grab.value, 29, "option write must not clobber item override");
assert.equal(afterOpt.optionOverrides["g::shot"].shopee.value, 21);
assert.equal(afterOpt.optionOverrides["g::shot"].grab, undefined);
assert.equal(applyChannelRule(7, afterOpt.optionOverrides["g::shot"].shopee), 21);

const cleared = applyMany(afterGrab, [
  { scope: "item", id: "a", channel: "grab", rule: null },
]);
assert.equal(cleared.itemOverrides.a, undefined);
assert.equal(resolveItem(cleared, "a", storeA, "grab").target, 43);
assert.equal(resolveItem(cleared, "b", storeB, "grab").target, 29);
assert.equal(resolveItem(cleared, "a", storeA, "shopee").target, 38);

const sameItemTwoCh = applyMany(baseSettings, [
  { scope: "item", id: "a", channel: "grab", rule: { mode: "absolute", value: 29 } },
  { scope: "item", id: "a", channel: "lineman", rule: { mode: "absolute", value: 31 } },
]);
assert.equal(resolveItem(sameItemTwoCh, "a", storeA, "grab").target, 29);
assert.equal(resolveItem(sameItemTwoCh, "a", storeA, "lineman").target, 31);
assert.equal(resolveItem(sameItemTwoCh, "a", storeA, "shopee").target, 38);

function parseCellSelKey(key) {
  const parts = key.split("\t");
  if (parts.length !== 3) return null;
  const [scope, id, channel] = parts;
  if (scope !== "item" && scope !== "option") return null;
  if (!id) return null;
  if (channel !== "shopee" && channel !== "grab" && channel !== "lineman") return null;
  return { scope, id, channel };
}

function selectedMenuItemIdsFromSel(cellSel, storeOnlySel) {
  const ids = new Set([...storeOnlySel].filter(Boolean));
  for (const key of cellSel) {
    const sel = parseCellSelKey(key);
    if (sel?.scope === "item") ids.add(sel.id);
  }
  return [...ids].sort();
}

assert.deepEqual(
  selectedMenuItemIdsFromSel(
    ["item\ta\tshopee", "item\ta\tgrab", "option\tg::shot\tshopee", "item\tb\tlineman"],
    ["c", ""],
  ),
  ["a", "b", "c"],
);
assert.deepEqual(selectedMenuItemIdsFromSel(["option\tg::shot\tgrab"], []), []);

function isNoteEmptyFilterQuery(needle) {
  const q = String(needle || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
  return q === "ว่าง" || q === "-" || q === "--" || q === "(ว่าง)" || q === "empty" || q === "blank";
}

function noteFilterMatches(note, needle) {
  const q = String(needle || "").trim();
  if (!q) return true;
  if (isNoteEmptyFilterQuery(q)) return !String(note || "").trim();
  return String(note || "")
    .toLowerCase()
    .includes(q.toLowerCase());
}

assert.equal(noteFilterMatches("", ""), true);
assert.equal(noteFilterMatches("update price", "ว่าง"), false);
assert.equal(noteFilterMatches("", "ว่าง"), true);
assert.equal(noteFilterMatches("   ", "-"), true);
assert.equal(noteFilterMatches("สร้างเมนู grab", "empty"), false);
assert.equal(noteFilterMatches("update price", "update"), true);

function optionGroupIdsUsedOnlyByStoreOnly(items) {
  const used = new Map();
  for (const item of items) {
    const store = item.storeOnly === true || (item.storeOnly !== false && /เฉพาะหน้าร้าน/.test(item.name || ""));
    for (const gid of item.optionGroupIds || []) {
      const cur = used.get(gid) || { allStore: true };
      if (!store) cur.allStore = false;
      used.set(gid, cur);
    }
  }
  const out = new Set();
  for (const [id, v] of used) {
    if (v.allStore) out.add(id);
  }
  return out;
}

function isOptionStoreOnlyRow(choiceName, groupName, groupId, storeOnlyGroupIds) {
  return (
    /เฉพาะหน้าร้าน/.test(choiceName || "") ||
    /เฉพาะหน้าร้าน/.test(groupName || "") ||
    storeOnlyGroupIds.has(groupId)
  );
}

const storeOnlyGids = optionGroupIdsUsedOnlyByStoreOnly([
  { name: "ลาเต้ เฉพาะหน้าร้าน", storeOnly: true, optionGroupIds: ["shot-store", "shared"] },
  { name: "ลาเต้", storeOnly: false, optionGroupIds: ["shared", "milk"] },
  { name: "อเมริกาโน่ เฉพาะหน้าร้าน", optionGroupIds: ["shot-store"] },
]);
assert.equal(storeOnlyGids.has("shot-store"), true);
assert.equal(storeOnlyGids.has("shared"), false);
assert.equal(storeOnlyGids.has("milk"), false);
assert.equal(storeOnlyGids.has("unused"), false);
assert.equal(isOptionStoreOnlyRow("2 shot", "ช็อต", "shot-store", storeOnlyGids), true);
assert.equal(isOptionStoreOnlyRow("2 shot", "ช็อต", "milk", storeOnlyGids), false);
assert.equal(isOptionStoreOnlyRow("น้ำเชื่อม เฉพาะหน้าร้าน", "หวาน", "milk", storeOnlyGids), true);
assert.equal(isOptionStoreOnlyRow("2 shot", "ท็อปปิ้งเฉพาะหน้าร้าน", "milk", storeOnlyGids), true);

console.log("ok menu hub price modes");
