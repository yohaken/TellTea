/**
 * Gate: MediaProjection capture + one-shot capture consent (not every update).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 394/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 130/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+101/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.78"/);

assert.ok(existsSync(join(root, "docs/npos-capture-projection-checklist.md")));
const doc = read("docs/npos-capture-projection-checklist.md");
assert.match(doc, /1\.14\.78/);
assert.match(doc, /MediaProjection/);
assert.match(doc, /ถามครั้งเดียว|after update|หลังอัปเดต/);

const manifest = read("npos-telltea/app/src/main/AndroidManifest.xml");
assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
assert.match(manifest, /CaptureConsentActivity/);
assert.match(manifest, /CaptureProjectionService/);
assert.match(manifest, /foregroundServiceType="mediaProjection"/);

for (const rel of [
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureConsentActivity.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionService.java",
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionPrefs.java",
]) {
  assert.ok(existsSync(join(root, rel)), rel);
}

const capture = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ScreenCapture.java",
);
assert.match(capture, /MediaProjection|CaptureProjectionService/);
assert.match(capture, /grabPrimary/);
assert.match(capture, /reject_uniform_green|isMostlyBrandGreen/);
assert.match(capture, /shouldAutoPrompt|CaptureConsentActivity/);
// Must not treat synthetic status cards as successful uploads
assert.doesNotMatch(capture, /statusShot\(/);
assert.doesNotMatch(
  capture,
  /Always produce a small JPEG so BO still gets a visible frame/,
);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CaptureProjectionPrefs.java",
);
assert.match(prefs, /markPromptAfterUpdate/);
assert.match(prefs, /shouldAutoPrompt/);
assert.match(prefs, /6L \* 60L \* 60L/);

const install = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/InstallResultReceiver.java",
);
assert.match(install, /CaptureProjectionPrefs\.markPromptAfterUpdate/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /CaptureConsentActivity\.launchAfterUpdateIfNeeded/);
const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /CaptureConsentActivity\.launchAfterUpdateIfNeeded/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-capture-projection-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /capture-projection/);

console.log("OK test-npos-capture-projection");
