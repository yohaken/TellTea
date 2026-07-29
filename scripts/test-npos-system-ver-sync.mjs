/**
 * Gate (strict): BO «เวอร์ชันระบบ» pin MUST equal nPos APK build.gradle.
 * If APK ships without updating npos-apk-release.ts, the devices table stays
 * on the old system version and will not flag tablets as behind.
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

const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
assert.ok(code > 0, "build.gradle versionCode missing");
assert.ok(name, "build.gradle versionName missing");

assert.match(
  pin,
  new RegExp(`NPOS_SYSTEM_VERSION_NAME = "${name.replace(/\./g, "\\.")}"`),
  `npos-apk-release.ts NAME must be ${name}`,
);
assert.match(
  pin,
  new RegExp(`NPOS_SYSTEM_VERSION_CODE = ${code};`),
  `npos-apk-release.ts CODE must be ${code}`,
);

assert.match(panel, /systemRelease\.label/);
assert.match(panel, /nposVersionMatch\(clientCode, systemRelease\.versionCode\)/);
assert.match(panel, /fetchNposSystemRelease/);

// BO (telltea-shop) fetches telltea-pos latest.json — needs CORS
assert.match(hosting, /"source":\s*"\/downloads\/\*\*"/);
assert.match(hosting, /Access-Control-Allow-Origin/);

assert.match(read("src/lib/version.ts"), /APP_BUILD = 395/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 131/);

console.log(`OK test-npos-system-ver-sync ${name} (${code})`);
