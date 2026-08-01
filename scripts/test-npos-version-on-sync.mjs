/**
 * Gate: version check rides server sync pulse (native heartbeat + web).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 555/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 161/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+128/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.105"/);

assert.ok(existsSync(join(root, "docs/npos-version-on-sync-checklist.md")));
const doc = read("docs/npos-version-on-sync-checklist.md");
assert.match(doc, /1\.14\.43/);
assert.match(doc, /UpdateCheckCoordinator|V0|V1/);
assert.match(doc, /telltea-pos-sync-pulse|onServerSyncPulse/);

const coordinator = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateCheckCoordinator.java",
);
assert.match(coordinator, /onServerSyncPulse/);
assert.match(coordinator, /requestCheck/);
assert.match(coordinator, /bind|unbind/);

const config = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateConfig.java",
);
assert.match(config, /AUTO_CHECK_MIN_INTERVAL_MS\s*=\s*20_000L/);

const heartbeat = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java",
);
assert.match(heartbeat, /UpdateCheckCoordinator\.onServerSyncPulse/);
assert.match(heartbeat, /MAIN\.post/);
assert.match(heartbeat, /worker thread|CalledFromWrongThread|view hierarchy|main/);


const prompt = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdatePromptController.java",
);
assert.match(prompt, /UpdateCheckCoordinator\.bind/);
assert.match(prompt, /void onPause\(\)/);
assert.match(prompt, /runAutoCheck/);

assert.match(read("src/components/AppUpdateWatcher.tsx"), /POLL_MS = 30 \* 1000/);
assert.match(read("src/components/AppUpdateWatcher.tsx"), /visibilitychange/);
assert.match(read("src/components/AppUpdateWatcher.tsx"), /MIN_VISIBILITY_CHECK_MS/);

assert.match(
  read("src/lib/pos-app-context.tsx"),
  /telltea-pos-sync-pulse/,
);
assert.match(read("src/components/PosUpdateWatcher.tsx"), /telltea-pos-sync-pulse/);
assert.match(read("src/components/PosUpdateWatcher.tsx"), /MIN_SYNC_PULSE_CHECK_MS/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-version-on-sync-checklist/);

console.log("OK test-npos-version-on-sync");
