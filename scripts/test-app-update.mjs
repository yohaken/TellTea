/**
 * Sanity: auto-update wiring + version.json build step.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const layoutSrc = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const watcherSrc = readFileSync(join(root, "src/components/AppUpdateWatcher.tsx"), "utf8");
const updateSrc = readFileSync(join(root, "src/lib/app-update.ts"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const firebaseJson = JSON.parse(readFileSync(join(root, "firebase.json"), "utf8"));

assert.match(layoutSrc, /AppUpdateWatcher/);
assert.match(watcherSrc, /อัปเดตเลย/);
assert.match(watcherSrc, /ภายหลัง/);
assert.match(watcherSrc, /applyUpdate/);
assert.match(watcherSrc, /window\.location\.reload/);
assert.doesNotMatch(watcherSrc, /pendingReload/);
assert.match(updateSrc, /fetchServerBuild/);
assert.equal((rulesSrc.match(/function staffEmployeeId/g) || []).length, 1);

const headers = firebaseJson.hosting.headers;
const staticRule = headers.find((h) => h.source === "/_next/static/**");
const catchAll = headers.find((h) => h.source === "**");
assert.ok(staticRule?.headers?.[0]?.value?.includes("immutable"));
assert.ok(catchAll?.headers?.[0]?.value?.includes("no-cache"));
assert.ok(headers.indexOf(staticRule) > headers.indexOf(catchAll), "static rule must win over catch-all");

if (existsSync(join(root, "out/version.json"))) {
  const version = JSON.parse(readFileSync(join(root, "out/version.json"), "utf8"));
  assert.equal(typeof version.build, "number");
  assert.ok(version.build >= 106);
}

console.log("OK app-update wiring");
