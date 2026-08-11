/**
 * Guard: CI recreates telltea-shop Hosting site before deploy.
 * Claim QR points at https://telltea-shop.web.app/claim/ — Site Not Found breaks scan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const deploy = read(".github/workflows/deploy.yml");
assert.match(deploy, /hosting:sites:create telltea-shop/);
assert.match(deploy, /hosting:sites:create telltea-pos/);
assert.match(deploy, /target:apply hosting telltea telltea-shop/);

const claim = read("functions/pos-members.js");
assert.match(claim, /https:\/\/telltea-shop\.web\.app\/claim\//);

const smoke = read("scripts/smoke-live-version.mjs");
assert.match(smoke, /Site Not Found/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 774);

console.log("OK test-restore-telltea-shop-hosting");
