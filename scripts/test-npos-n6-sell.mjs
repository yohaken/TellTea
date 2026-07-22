/**
 * nPos N6.1–N6.5 sell stack wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 256/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.23"/);
assert.match(read("docs/npos-migration-phases.md"), /N6\.1–N6\.5.*✅|✅ รอบนี้ \(1\.8\.0\)/);
assert.match(read("docs/npos-migration-phases.md"), /N6\.6/);

assert.match(read("functions/npos-sell.js"), /nposMenuSnapshot/);
assert.match(read("functions/npos-sell.js"), /nposCompleteSale/);
assert.match(read("functions/npos-sell.js"), /nposSessionOpen/);
assert.match(read("functions/index.js"), /nposCompleteSale/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuRepository.java")));
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /SellActivity/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /SaleSync|SellActivity/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java"), /demoBundle/);

console.log("OK test-npos-n6-sell");
