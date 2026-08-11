/**
 * Guard: shop hosting target is telltea-bo; claim QR must not use dead telltea-shop.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rc = read(".firebaserc");
assert.match(rc, /"telltea":\s*\[\s*"telltea-bo"\s*\]/);
assert.doesNotMatch(rc, /"telltea":\s*\[\s*"telltea-shop"\s*\]/);

const deploy = read(".github/workflows/deploy.yml");
assert.match(deploy, /create_site telltea-bo|hosting:sites:create telltea-bo|telltea-bo/);
assert.match(deploy, /target:apply hosting telltea telltea-bo/);

const claim = read("functions/pos-members.js");
assert.match(claim, /https:\/\/telltea-bo\.web\.app\/claim\//);
assert.doesNotMatch(claim, /https:\/\/telltea-shop\.web\.app\/claim\//);

const receipt = read("src/lib/receipt-claim.ts");
assert.match(receipt, /TELLTEA_SHOP_ORIGIN/);
const origins = read("src/lib/telltea-origins.ts");
assert.match(origins, /telltea-bo\.web\.app/);

const smoke = read("scripts/smoke-live-version.mjs");
assert.match(smoke, /telltea-bo\.web\.app\/version\.json/);
assert.match(smoke, /Site Not Found/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 775);

console.log("OK test-restore-telltea-shop-hosting");
