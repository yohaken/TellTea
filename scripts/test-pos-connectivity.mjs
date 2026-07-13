/**
 * POS connectivity + auto-update wiring sanity checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSrc = readFileSync(join(root, "src/app/pos/page.tsx"), "utf8");
const watcherSrc = readFileSync(join(root, "src/components/PosUpdateWatcher.tsx"), "utf8");
const reloadSrc = readFileSync(join(root, "src/lib/pos-reload.ts"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const deviceSrc = readFileSync(join(root, "src/lib/pos-devices.ts"), "utf8");
const setupSrc = readFileSync(join(root, "src/components/PosDeviceSetup.tsx"), "utf8");

assert.match(pageSrc, /PosUpdateWatcher/);
assert.match(pageSrc, /isPosSafeToReload/);
assert.match(pageSrc, /pendingForceReloadAtRef/);
assert.match(watcherSrc, /fetchServerBuild/);
assert.match(watcherSrc, /forceAppUpdate/);
assert.match(watcherSrc, /isPosSafeToReload/);
assert.match(reloadSrc, /isPosSafeToReload/);
assert.match(rulesSrc, /posDevice == true/);
assert.match(readFileSync(join(root, "functions/index.js"), "utf8"), /posDeviceAuth/);
assert.match(readFileSync(join(root, "functions/index.js"), "utf8"), /posCompleteSale/);
assert.match(readFileSync(join(root, "src/lib/pos-sales.ts"), "utf8"), /posCompleteSale/);
assert.match(readFileSync(join(root, "src/lib/pos-firebase.ts"), "utf8"), /telltea-pos/);
assert.match(readFileSync(join(root, "src/lib/pos-auth.ts"), "utf8"), /getPosFirebaseAuth/);
assert.match(deviceSrc, /requestPosDevicesReload/);
assert.match(setupSrc, /อัปเดตเครื่องที่ค้าง/);
assert.ok(readFileSync(join(root, "docs/pos-connectivity.md"), "utf8").includes("Firestore = สายชีวิต"));

console.log("OK pos-connectivity wiring");
