/**
 * POS 62 — Embedded APK download (no live Hosting UI).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-version.ts"), /POS_BUILD\s*=\s*62\b/);
assert.match(read("src/lib/pos-native-version.ts"), /POS_NATIVE_SHELL_BUILD\s*=\s*2\b/);
assert.match(read("src/lib/pos-url.ts"), /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/downloads\/telltea-pos\.apk/);
assert.match(read("public/install/index.html"), /ฝังหน้า POS ใน APK/);
assert.match(read("public/install/index.html"), /qr-pos-install\.png/);
assert.ok(existsSync(join(root, "public/install/qr-pos-install.png")));
assert.match(read("capacitor.config.ts"), /CAPACITOR_LIVE/);
assert.match(read("capacitor.config.ts"), /useLiveServer = process\.env\.CAPACITOR_LIVE === "1"/);
assert.match(read(".github/workflows/deploy.yml"), /embedded APK/);
assert.match(read(".github/workflows/deploy.yml"), /CAPACITOR_LIVE=0/);
assert.match(read(".github/workflows/deploy.yml"), /must not set server\.url/);
assert.match(read("android/app/build.gradle"), /versionCode 2/);
assert.match(read("docs/pos-native-shell.md"), /ไม่มี `server\.url`/);
assert.match(read("scripts/publish-pos-apk.mjs"), /embeddedUi/);

console.log("test-pos-apk-download: ok");
