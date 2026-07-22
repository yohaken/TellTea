/**
 * POS sell busy-loop guards still in tree (shell/sync); web sell is retired stub.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 264/);

assert.match(read("src/app/pos/sell/page.tsx"), /PosWebRetired/);

const sellView = read("src/components/PosSellView.tsx");
assert.match(sellView, /lastBusyRef/);

const syncWatcher = read("src/components/PosSyncWatcher.tsx");
assert.match(syncWatcher, /onSyncChangeRef/);

const shell = read("src/components/PosAppShell.tsx");
assert.match(shell, /prev\.pendingSyncCount === snap\.pendingCount/);

const ctx = read("src/lib/pos-app-context.tsx");
assert.match(ctx, /resubscribePosMenuAfterAuth/);

console.log("ok: pos-sell-menu-loop");
