/**
 * Gate (strict): BO «เวอร์ชันระบบ» pin MUST equal nPos APK build.gradle.
 * If APK ships without updating npos-apk-release.ts, the devices table stays
 * on the old system version and will not flag tablets as behind.
 *
 * OTA rule: only versionCode decides update eligibility on tablets
 * (`UpdateManifest.isNewerThan`). versionName is a short display label and
 * MUST equal String(versionCode). Changing the name never blocks OTA.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const gradle = read("npos-telltea/app/build.gradle");
const pin = read("src/lib/npos-apk-release.ts");
const panel = read("src/components/NposDevicesPanel.tsx");
const hosting = read("firebase.json");
const manifest = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateManifest.java",
);

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
assert.ok(code > 0, "build.gradle versionCode missing");
assert.ok(name, "build.gradle versionName missing");
assert.equal(
  name,
  String(code),
  `versionName must be short digits equal to versionCode (got name=${name} code=${code})`,
);
assert.ok(code >= 135, `versionCode must keep rising for OTA (got ${code})`);

assert.match(
  pin,
  new RegExp(`NPOS_SYSTEM_VERSION_NAME = "${name}"`),
  `npos-apk-release.ts NAME must be ${name}`,
);
assert.match(
  pin,
  new RegExp(`NPOS_SYSTEM_VERSION_CODE = ${code};`),
  `npos-apk-release.ts CODE must be ${code}`,
);
assert.match(pin, /versionCode only|OTA safety|isNewerThan/);
assert.match(pin, /formatNposReleaseLabel/);

// Tablets: newer = higher versionCode only (name format irrelevant).
assert.match(manifest, /isNewerThan\s*\(\s*int localVersionCode\s*\)/);
assert.match(manifest, /return versionCode > localVersionCode/);
assert.doesNotMatch(manifest, /versionName\.compare|compareToIgnoreCase\(versionName/);

assert.match(panel, /systemRelease\.label/);
assert.match(panel, /nposVersionMatch\(clientCode, systemRelease\.versionCode\)/);
assert.match(panel, /fetchNposSystemRelease/);

// BO (telltea-shop) fetches telltea-pos latest.json — needs CORS
assert.match(hosting, /"source":\s*"\/downloads\/\*\*"/);
assert.match(hosting, /Access-Control-Allow-Origin/);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 583);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 167);

const labelFn = read("src/lib/npos-apk-release.ts");
assert.match(labelFn, /name === String\(code\)/);

console.log(`OK test-npos-system-ver-sync ${name} (code=${code}) OTA=versionCode`);
