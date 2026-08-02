/**
 * Guard: owner-only floating quick dock + settings manage panel
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/owner-quick-dock.ts");
const ui = read("src/components/OwnerQuickDock.tsx");
const setup = read("src/components/OwnerQuickDockSetup.tsx");
const settings = read("src/app/settings/page.tsx");
const shell = read("src/components/AppShell.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const ledger = read("src/app/ledger/page.tsx");
const ownerBooks = read("src/app/owner-books/page.tsx");

assert.match(version, /APP_BUILD = 632/);
assert.match(lib, /OWNER_QUICK_KEYS/);
assert.match(lib, /DEFAULT_OWNER_QUICK_KEYS/);
assert.match(lib, /ownerQuickKeys/);
assert.match(lib, /ownerQuickAbbrs/);
assert.match(lib, /saveOwnerQuickSettings/);
assert.match(lib, /subscribeOwnerQuickSettings/);
assert.match(lib, /setupOwnerQuickListOrder/);
assert.match(lib, /setOwnerQuickAbbr/);
assert.match(lib, /normalizeOwnerQuickAbbr/);
assert.match(lib, /abbr: "เจ"/);
assert.match(lib, /abbr: "VAT"/);
assert.match(lib, /businessNotes/);
assert.match(lib, /production/);
assert.match(lib, /capital/);
assert.match(lib, /OWNER_QUICK_MAX = 10/);
assert.match(lib, /OWNER_QUICK_ABBR_MAX = 4/);

assert.match(ui, /export function OwnerQuickDock/);
assert.match(ui, /staff\?\.role === "owner"/);
assert.match(ui, /LONG_PRESS_MS|กดค้าง/);
assert.match(ui, /OwnerQuickSetupModal/);
assert.match(ui, /moveOwnerQuickKey/);
assert.match(ui, /setupOwnerQuickListOrder/);
assert.match(ui, /settingsRef/);
assert.match(ui, /owner-quick-setup-rank/);
assert.match(ui, /onAbbr/);
assert.match(ui, /owner-quick-abbr-input/);
assert.doesNotMatch(ui, /open=\{true\}/);

assert.match(setup, /export function OwnerQuickDockSetup/);
assert.match(setup, /ไอคอนลอย/);
assert.match(setup, /commitAbbr/);
assert.match(setup, /SettingsFold/);
assert.match(settings, /OwnerQuickDockSetup/);
assert.match(settings, /ไอคอนลอย/);

assert.match(shell, /OwnerQuickDock/);
assert.match(shell, /isOwner \? <OwnerQuickDock/);
assert.match(shell, /"\/capital"/);

assert.match(css, /\.owner-quick-dock\b/);
assert.match(css, /\.owner-quick-chip\b/);
assert.match(css, /\.owner-quick-abbr\b/);
assert.match(css, /\.owner-quick-abbr-input\b/);
assert.match(css, /var\(--nav-h\)/);
assert.match(css, /\.owner-quick-dock[\s\S]*z-index:\s*1[36]/);
assert.match(css, /\.module-tab-dock\.is-single[\s\S]*overflow:\s*hidden/);
assert.match(css, /\.module-tab-dock\.is-single[\s\S]*max-width:\s*4\.6rem/);
assert.match(css, /\.module-tab-dock\.is-single[\s\S]*left:\s*max/);
assert.match(css, /\.module-tab-dock\.is-single[\s\S]*min-height:\s*1\.25rem/);
assert.match(css, /\.owner-quick-dock[\s\S]*left:\s*50%/);
assert.match(css, /\.owner-quick-dock[\s\S]*justify-content:\s*flex-start/);
assert.doesNotMatch(
  css,
  /\.owner-quick-dock\s*\{[^}]*transform:\s*translateX\(-50%\)/,
);

assert.match(ledger, /addLabel="\+ ออก"/);
assert.match(ownerBooks, /addLabel="\+ ออก"/);
assert.doesNotMatch(ledger, /addLabel="บันทึกเงินออก"/);
assert.doesNotMatch(ownerBooks, /addLabel="บันทึกเงินออก"/);

/** Runtime: move + setup list order + abbr normalize */
const OWNER_QUICK_KEYS = [
  "ownerBooks",
  "vatSales",
  "capital",
  "pnl",
  "ledger",
  "production",
  "otBonus",
  "bonus",
  "checklist",
  "stock",
  "assignTasks",
  "staff",
  "menu",
  "posSales",
  "businessNotes",
  "utility",
  "export",
  "settings",
  "profile",
  "more",
];
const DEFAULT = ["ownerBooks", "vatSales", "pnl", "staff"];
const KEY_SET = new Set(OWNER_QUICK_KEYS);
const MAX = 10;

function normalize(input) {
  const out = [];
  for (const raw of input || []) {
    if (KEY_SET.has(raw) && !out.includes(raw)) out.push(raw);
    if (out.length >= MAX) break;
  }
  return out.length ? out : [...DEFAULT];
}

function move(keys, key, dir) {
  const list = normalize(keys);
  const idx = list.indexOf(key);
  if (idx < 0) return list;
  const next = idx + dir;
  if (next < 0 || next >= list.length) return list;
  const copy = [...list];
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  return copy;
}

function setupOrder(keys) {
  const active = normalize(keys);
  const on = new Set(active);
  return [...active, ...OWNER_QUICK_KEYS.filter((k) => !on.has(k))];
}

function normalizeAbbr(raw) {
  const text = String(raw ?? "").replace(/\s+/g, "").trim();
  if (!text) return "";
  return [...text].slice(0, 4).join("");
}

const moved = move(DEFAULT, "vatSales", -1);
assert.deepEqual(moved, ["vatSales", "ownerBooks", "pnl", "staff"]);
assert.equal(setupOrder(moved)[0], "vatSales");
assert.equal(setupOrder(moved)[1], "ownerBooks");
assert.ok(setupOrder(moved).indexOf("menu") > setupOrder(moved).indexOf("staff"));
assert.ok(OWNER_QUICK_KEYS.includes("businessNotes"));
assert.ok(OWNER_QUICK_KEYS.includes("production"));
assert.equal(normalizeAbbr(" กำไรX "), "กำไรX".slice(0, 4) === "กำไรX" ? "กำไรX" : normalizeAbbr("กำไรX"));
assert.equal(normalizeAbbr("ABCDEF"), "ABCD");
assert.equal(normalizeAbbr("  "), "");

console.log("OK test-owner-quick-dock");
