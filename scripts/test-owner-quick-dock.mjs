/**
 * Guard: owner-only floating quick dock above bottom nav
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/owner-quick-dock.ts");
const ui = read("src/components/OwnerQuickDock.tsx");
const shell = read("src/components/AppShell.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 398/);
assert.match(lib, /OWNER_QUICK_KEYS/);
assert.match(lib, /DEFAULT_OWNER_QUICK_KEYS/);
assert.match(lib, /ownerQuickKeys/);
assert.match(lib, /saveOwnerQuickKeys/);
assert.match(lib, /subscribeOwnerQuickKeys/);
assert.match(lib, /abbr: "เจ"/);
assert.match(lib, /abbr: "VAT"/);
assert.match(lib, /OWNER_QUICK_MAX = 6/);

assert.match(ui, /export function OwnerQuickDock/);
assert.match(ui, /staff\?\.role === "owner"/);
assert.match(ui, /LONG_PRESS_MS|กดค้าง/);
assert.match(ui, /OwnerQuickSetupModal/);
assert.match(ui, /moveOwnerQuickKey/);
assert.doesNotMatch(ui, /open=\{true\}/);

assert.match(shell, /OwnerQuickDock/);
assert.match(shell, /isOwner \? <OwnerQuickDock/);

assert.match(css, /\.owner-quick-dock\b/);
assert.match(css, /\.owner-quick-chip\b/);
assert.match(css, /\.owner-quick-abbr\b/);
assert.match(css, /var\(--nav-h\)/);

console.log("OK test-owner-quick-dock");
