/**
 * POS sell: no infinite setState loop; resubscribe menu after auth.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 258/);

const sellPage = read("src/app/pos/sell/page.tsx");
assert.match(sellPage, /useCallback/);
assert.match(sellPage, /onBusyChange/);

const sellView = read("src/components/PosSellView.tsx");
assert.match(sellView, /lastBusyRef/);
assert.match(sellView, /prev\.cartCount === cartCount/);

const syncWatcher = read("src/components/PosSyncWatcher.tsx");
assert.match(syncWatcher, /onSyncChangeRef/);
assert.doesNotMatch(syncWatcher, /\[enabled, onSyncChange\]/);

const shell = read("src/components/PosAppShell.tsx");
assert.match(shell, /prev\.pendingSyncCount === snap\.pendingCount/);

const ctx = read("src/lib/pos-app-context.tsx");
assert.match(ctx, /resubscribePosMenuAfterAuth/);

const preload = read("src/lib/pos-menu-preload.ts");
assert.match(preload, /export function resubscribePosMenuAfterAuth/);

console.log("ok: pos-sell-menu-loop");
