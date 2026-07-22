/**
 * Brand logo perf + wiring smoke.
 * Guards against the regression that froze the app (fat data URL in profile + event loop).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const brand = read("src/lib/brand-logo.ts");
const profile = read("src/lib/business-profile.ts");
const appBrand = read("src/components/AppBrand.tsx");
const logoField = read("src/components/BusinessLogoField.tsx");
const receipts = read("src/lib/receipts.ts");
const rules = read("firestore.rules");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 231/);
assert.match(brand, /BRAND_LOGO_MAX_CHARS = 80_000/);
assert.match(brand, /meta", "brandLogo"/);
assert.match(brand, /purgeLegacyBrandLogoStorage/);
assert.match(brand, /if \(next === memorySrc\) return/);
assert.match(brand, /loadPromise/);
assert.match(receipts, /LOGO_DATA_URL_SOFT_MAX = 80_000/);
assert.match(receipts, /edge = 320/);

// businessProfile must stay text-only (no localStorage of data URLs)
assert.doesNotMatch(profile, /localStorage|cacheBrandLogo|saveBusinessLogo/);
assert.match(profile, /ห้ามฝัง data URL|Never write image bytes|Never keep fat/);

// AppBrand: singleton load, no getBusinessProfile for logo, no re-cache loop
assert.match(appBrand, /loadBrandLogo/);
assert.doesNotMatch(appBrand, /getBusinessProfile|cacheBrandLogo/);
assert.match(appBrand, /setCustomLogoSrc\(detail\)/);

assert.match(logoField, /saveBrandLogo/);
assert.doesNotMatch(logoField, /saveBusinessLogo|saveEvidencePhotoDoc/);

assert.match(rules, /docId == 'brandLogo'/);
assert.match(rules, /docId == 'businessProfile'/);

console.log("OK test-brand-logo-perf");
