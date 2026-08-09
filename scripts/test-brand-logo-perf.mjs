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

assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 698);
assert.doesNotMatch(appBrand, /brand-logo-dark-pad/);
assert.match(appBrand, /brand-logo-custom/);
assert.match(brand, /BRAND_LOGO_MAX_CHARS = 80_000/);
assert.match(brand, /meta", "brandLogo"/);
assert.match(brand, /purgeLegacyBrandLogoStorage/);
assert.match(brand, /if \(next === memorySrc\) return/);
assert.match(brand, /loadPromise/);
assert.match(brand, /logoEpoch/);
assert.match(brand, /epochAtStart !== logoEpoch/);
assert.match(brand, /lightBgKnockedOut/);
assert.match(brand, /prepareBrandLogoPngDataUrl|prepareAndShrinkLogo/);
assert.match(receipts, /LOGO_DATA_URL_SOFT_MAX = 80_000/);
assert.match(receipts, /edge = 320/);
assert.match(receipts, /knockOutLogoLightBackground/);
assert.match(receipts, /prepareBrandLogoPngDataUrl/);
assert.match(receipts, /isLogoKnockoutRgb/);
assert.match(receipts, /avg >= 155/);
assert.match(receipts, /checkerboard|ตารางหมากรุก|Transparency-grid/);
assert.match(logoField, /ตัดแถบขาว|ตัดพื้นขาว/);
assert.match(logoField, /getBrandLogoMemory/);
assert.match(logoField, /Do not wipe a newer upload|newer upload/);

// businessProfile must stay text-only (no localStorage of data URLs)
assert.doesNotMatch(profile, /localStorage|cacheBrandLogo|saveBusinessLogo/);
assert.match(profile, /ห้ามฝัง data URL|Never write image bytes|Never keep fat/);

// AppBrand: singleton load, no getBusinessProfile for logo, no re-cache loop
assert.match(appBrand, /loadBrandLogo/);
assert.doesNotMatch(appBrand, /getBusinessProfile|cacheBrandLogo/);
assert.match(appBrand, /setCustomLogoSrc\(detail\)/);

assert.match(logoField, /saveBrandLogo/);
assert.match(logoField, /UPLOAD_BUDGET_MS|ย่อรูปนานเกินไป|บันทึกโลโก้นานเกินไป/);
assert.match(logoField, /business-logo-error|localError/);
assert.match(logoField, /ยกเลิก/);
assert.doesNotMatch(logoField, /saveBusinessLogo|saveEvidencePhotoDoc/);
assert.match(receipts, /Sync PNG encode/);
assert.match(receipts, /toDataURL\("image\/png"\)/);
assert.match(receipts, /decodeImageFile|createObjectURL/);
assert.match(receipts, /ยังไม่รองรับ HEIC/);
assert.match(receipts, /function canvasToPngDataUrl[\s\S]*?toDataURL\("image\/png"\)/);

assert.match(rules, /docId == 'brandLogo'/);
assert.match(rules, /docId == 'businessProfile'/);

console.log("OK test-brand-logo-perf");
