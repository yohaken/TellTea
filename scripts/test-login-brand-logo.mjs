/**
 * Staff login must show uploaded brandLogo — not flash stock TellTea SVG,
 * not show opaque pad / boxed logo on the green hero.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const login = read("src/app/login/page.tsx");
assert.match(login, /AppBrand/);
assert.match(login, /hero-brand/);
assert.match(login, /showLogo/);

const appBrand = read("src/components/AppBrand.tsx");
assert.match(appBrand, /loadBrandLogo/);
assert.match(appBrand, /logoResolved/);
assert.match(appBrand, /brand-logo-slot/);
assert.match(appBrand, /logo-telltea\.svg/);
assert.match(appBrand, /purgeLegacyBrandLogoStorage/);

const brand = read("src/lib/brand-logo.ts");
assert.match(brand, /BRAND_LOGO_KNOCKOUT_VERSION = 3/);
assert.match(brand, /needsKnockoutUpgrade/);
assert.match(brand, /forceKnockout/);

const css = read("src/app/globals.css");
assert.match(css, /\.hero-brand \.brand-logo-custom/);
assert.match(css, /brightness\(0\) invert\(1\)/);
assert.match(css, /brand-logo-slot/);
assert.doesNotMatch(css, /brand-logo-dark-pad/);
assert.match(css, /object-position:\s*center 16%/);

const rules = read("firestore.rules");
assert.match(rules, /docId == 'brandLogo'/);
assert.match(rules, /docId == 'businessProfile'/);
assert.match(rules, /allow get:\s*if docId == 'brandLogo'/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 771);

console.log("OK test-login-brand-logo");
