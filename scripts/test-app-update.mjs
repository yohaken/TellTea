/**
 * Sanity: auto-update wiring + owner force-update toggle.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const layoutSrc = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const watcherSrc = readFileSync(join(root, "src/components/AppUpdateWatcher.tsx"), "utf8");
const setupSrc = readFileSync(join(root, "src/components/AppUpdateSetup.tsx"), "utf8");
const releaseSrc = readFileSync(join(root, "src/lib/app-release.ts"), "utf8");
const settingsSrc = readFileSync(join(root, "src/app/settings/page.tsx"), "utf8");
const updateSrc = readFileSync(join(root, "src/lib/app-update.ts"), "utf8");

assert.match(layoutSrc, /AppUpdateWatcher/);
assert.match(settingsSrc, /AppUpdateSetup/);
assert.match(watcherSrc, /forceMode/);
assert.match(watcherSrc, /อัปเดตเลย/);
assert.match(watcherSrc, /tryForceReload/);
assert.match(setupSrc, /บังคับอัปเดตทันที/);
assert.match(releaseSrc, /forceAppUpdate/);
assert.match(updateSrc, /fetchServerBuild/);

if (existsSync(join(root, "out/version.json"))) {
  const version = JSON.parse(readFileSync(join(root, "out/version.json"), "utf8"));
  assert.equal(typeof version.build, "number");
  assert.ok(version.build >= 107);
}

console.log("OK app-update wiring");
