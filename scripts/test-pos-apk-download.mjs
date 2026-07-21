/**
 * POS 58 — Stable APK download link on telltea-pos hosting.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*61\b/);
assert.match(read("src/lib/pos-url.ts"), /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/install\//);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/downloads\/telltea-pos\.apk/);
assert.match(read("public/install/index.html"), /TellTea POS/);
assert.match(read("public/install/index.html"), /\/downloads\/telltea-pos\.apk/);
assert.match(read("public/install/index.html"), /qr-pos-install\.png/);
assert.ok(existsSync(join(root, "public/install/qr-pos-install.png")));
assert.match(read("scripts/publish-pos-apk.mjs"), /telltea-pos\.apk/);
assert.match(read("scripts/split-pos-hosting.mjs"), /install/);
assert.match(read("firebase.json"), /application\/vnd\.android\.package-archive/);
assert.match(read(".github/workflows/deploy.yml"), /assembleDebug/);
assert.match(read(".github/workflows/deploy.yml"), /publish-pos-apk/);
assert.match(read(".github/workflows/deploy.yml"), /java-version:\s*"21"/);
assert.match(read(".github/workflows/deploy.yml"), /smoke-pos-install-live/);
assert.match(read("scripts/smoke-pos-install-live.mjs"), /telltea-pos\.web\.app\/install/);
assert.match(read("src/components/PosDeviceSetup.tsx"), /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("docs/pos-native-install.md"), /telltea-pos\.web\.app\/install/);

console.log("test-pos-apk-download: ok");
