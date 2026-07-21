/**
 * nPos-telltea — simple Hello World APK download wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/pos-url.ts"), /POS_APK_INSTALL_PAGE_URL/);
assert.match(read("src/lib/pos-url.ts"), /telltea-pos\.web\.app\/downloads\/nPos-telltea\.apk/);
assert.match(read("public/install/index.html"), /nPos-telltea\.apk/);
assert.match(read("public/install/index.html"), /Hello World/);
assert.match(read(".github/workflows/deploy.yml"), /nPos-telltea Hello World APK/);
assert.match(read(".github/workflows/deploy.yml"), /cd npos-telltea/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /Hello World/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /nPos-telltea/);
assert.match(read("scripts/publish-pos-apk.mjs"), /nPos-telltea\.apk/);
assert.ok(existsSync(join(root, "npos-telltea/gradlew")));

console.log("test-pos-apk-download: ok");
