/**
 * nPos deviceClass — shop / dev / blocked wiring + fold helpers.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 243/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+35/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.12"/);
assert.match(read("docs/npos-device-class-checklist.md"), /deviceClass/);
assert.match(read("docs/npos-parity-checklist.md"), /deviceClass|เครื่องหน้าร้าน/);

// --- native identity flags ---
const identity = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceIdentity.java",
);
assert.match(identity, /isEmulator/);
assert.match(identity, /deviceClass/);
assert.match(identity, /CLASS_DEV|CLASS_SHOP|"dev"|"shop"/);
assert.match(identity, /goldfish|ranchu|sdk_gphone/);

const heartbeatJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java",
);
assert.match(heartbeatJava, /isEmulator/);
assert.match(heartbeatJava, /deviceClass/);
assert.match(heartbeatJava, /stableKey/);

const opsJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/OpsLogger.java",
);
assert.match(opsJava, /isEmulator/);
assert.match(opsJava, /deviceClass/);
assert.match(opsJava, /stableKey/);

const diagJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DiagnoseReporter.java",
);
assert.match(diagJava, /isEmulator/);
assert.match(diagJava, /deviceClass/);
assert.match(diagJava, /stableKey/);

// --- Cloud Functions ---
const hb = read("functions/npos-heartbeat.js");
assert.match(hb, /deviceClass/);
assert.match(hb, /isEmulator/);
assert.match(hb, /wasBlocked|deviceClass === "blocked"/);
assert.match(hb, /disabled:\s*wasBlocked/);
assert.doesNotMatch(hb, /disabled:\s*false,\s*\n\s*deviceHint/); // must not blindly clear block

const opsCf = read("functions/npos-ops-log.js");
assert.match(opsCf, /stableKey/);
assert.match(opsCf, /deviceClass/);
assert.match(opsCf, /isEmulator/);
assert.match(opsCf, /prevBlocked/);

const diagCf = read("functions/npos-diagnose.js");
assert.match(diagCf, /stableKey/);
assert.match(diagCf, /deviceClass/);
assert.match(diagCf, /isEmulator/);
assert.match(diagCf, /prevBlocked/);

// --- BO libs / panels ---
assert.ok(existsSync(join(root, "src/lib/npos-device-class.ts")));
const cls = read("src/lib/npos-device-class.ts");
assert.match(cls, /resolveNposDeviceClass/);
assert.match(cls, /foldByDeviceClass/);
assert.match(cls, /dedupeByStableKey/);
assert.match(cls, /nposDeviceClassLabel/);

assert.match(read("src/lib/pos-devices.ts"), /setNposDeviceBlocked/);
assert.match(read("src/lib/pos-devices.ts"), /deviceClass/);
assert.match(read("src/lib/pos-devices.ts"), /isEmulator/);

assert.match(read("src/components/NposDevicesPanel.tsx"), /เครื่องหน้าร้าน|nposDeviceClassLabel/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /setNposDeviceBlocked/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /ปลดบล็อก|บล็อก/);
assert.match(read("src/components/NposOpsLogPanel.tsx"), /foldByDeviceClass/);
assert.match(read("src/components/NposOpsLogPanel.tsx"), /shortStableKey/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /foldByDeviceClass/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /dedupeByStableKey/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /liveInstallIds|liveDeviceIds|subscribePosDevicesAdmin/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /npos-pill--on|ออน/);
assert.match(read("src/lib/npos-diagnose.ts"), /disabled/);
assert.match(read("functions/npos-heartbeat.js"), /nposDiagnose.*supersededBy|supersededBy[\s\S]*nposDiagnose/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java"),
  /INTERVAL_MS|onActivityResumed/,
);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/NposApp.java"), /ForegroundHeartbeat/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuWarmup.java"), /MenuWarmup|warm/);
assert.match(read("src/lib/pos-devices.ts"), /POS_ONLINE_MS\s*=\s*5\s*\*\s*60/);
assert.match(read("src/lib/npos-device-class.ts"), /liveInstallIds/);
assert.match(read("src/lib/npos-device-class.ts"), /resolveStableKey/);
assert.match(read("src/lib/npos-device-class.ts"), /preferOnlineRows/);
assert.match(read("src/lib/npos-ops-log.ts"), /stableKey/);
assert.match(read("src/lib/npos-diagnose.ts"), /deviceClass/);
assert.match(read("src/app/globals.css"), /npos-class-section/);
assert.match(read("src/app/globals.css"), /npos-device-btn/);
assert.match(read("src/components/NposDiagnosePanel.tsx"), /สเปกจอ \+ แคปล่าสุด/);
assert.match(read("src/components/NposDevicesPanel.tsx"), /preferOnlineRows|withResolvedStableKey/);
assert.match(read("functions/npos-heartbeat.js"), /inferStableKey/);
assert.match(read("functions/npos-diagnose.js"), /inferStableKey/);
assert.match(read("functions/npos-ops-log.js"), /inferStableKey/);
assert.match(read("docs/npos-device-class-checklist.md"), /ทำไมหลังร้านดูเหมือนหลายเครื่อง/);

// --- pure fold logic (mirrors src/lib/npos-device-class.ts) ---
function resolveNposDeviceClass(input) {
  if (input.blocked === true || input.deviceClass === "blocked") return "blocked";
  if (input.deviceClass === "shop" || input.deviceClass === "dev") return input.deviceClass;
  return input.isEmulator === true ? "dev" : "shop";
}

function resolveStableKey(stableKey, installId) {
  const sk = (stableKey || "").trim().toLowerCase();
  if (sk.length >= 8) return sk;
  const compact = (installId || "").replace(/-/g, "").toLowerCase();
  const m = /^npos([a-f0-9]+)$/.exec(compact);
  if (!m) return "";
  const hex = m[1];
  if (hex.length >= 8 && hex.length <= 20) return hex;
  return "";
}

function nposGroupKey(stableKey, installId) {
  const sk = resolveStableKey(stableKey, installId);
  if (sk) return `sk:${sk}`;
  return `orphan:${installId}`;
}

function dedupeByStableKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = nposGroupKey(row.stableKey, row.id);
    const prev = byKey.get(key);
    if (!prev || row.sortAt > prev.sortAt) byKey.set(key, row);
  }
  const keyed = [];
  const orphans = [];
  for (const [key, row] of byKey) {
    if (key.startsWith("orphan:")) orphans.push(row);
    else keyed.push(row);
  }
  orphans.sort((a, b) => b.sortAt - a.sortAt);
  if (keyed.length > 0) return keyed.sort((a, b) => b.sortAt - a.sortAt);
  return orphans[0] ? [orphans[0]] : [];
}

function preferOnlineRows(rows, isOnline) {
  const blocked = rows.filter((r) => r.deviceClass === "blocked");
  const rest = rows.filter((r) => r.deviceClass !== "blocked");
  if (!rest.some(isOnline)) return rows;
  return [...rest.filter(isOnline), ...blocked];
}

function foldByDeviceClass(rows) {
  const shop = [];
  const dev = [];
  const blocked = [];
  for (const row of rows) {
    if (row.deviceClass === "blocked") blocked.push(row);
    else if (row.deviceClass === "dev") dev.push(row);
    else shop.push(row);
  }
  return { shop, dev, blocked };
}

assert.equal(resolveNposDeviceClass({ isEmulator: true }), "dev");
assert.equal(resolveNposDeviceClass({ isEmulator: false }), "shop");
assert.equal(resolveNposDeviceClass({ deviceClass: "blocked" }), "blocked");
assert.equal(
  resolveNposDeviceClass({ deviceClass: "shop", blocked: true }),
  "blocked",
);

assert.equal(resolveStableKey("", "nposabcdef01234567"), "abcdef01234567");
assert.equal(resolveStableKey("", "npos" + "a".repeat(32)), ""); // UUID orphan

// Same ANDROID_ID recovered from installId + explicit key → one machine
const sameMachine = dedupeByStableKey([
  { id: "nposabcdef01234567", stableKey: "", sortAt: 10, deviceClass: "dev" },
  { id: "nposabcdef01234567-old", stableKey: "abcdef01234567", sortAt: 5, deviceClass: "dev" },
  {
    id: "npos" + "b".repeat(32),
    stableKey: "",
    sortAt: 99,
    deviceClass: "dev",
  }, // UUID orphan — dropped when keyed exists
]);
assert.equal(sameMachine.length, 1);
assert.equal(sameMachine[0].id, "nposabcdef01234567");

// Multiple version diagnose docs → one kept
const diagnoseLike = dedupeByStableKey([
  { id: "npos1111222233334444", stableKey: "1111222233334444", sortAt: 100, deviceClass: "dev" },
  { id: "npos1111222233334444", stableKey: "", sortAt: 50, deviceClass: "dev" },
  { id: "npos" + "c".repeat(32), stableKey: "", sortAt: 80, deviceClass: "shop" },
]);
assert.equal(diagnoseLike.length, 1);

const onlinePreferred = preferOnlineRows(
  [
    { id: "1", sortAt: 1, deviceClass: "dev", on: true },
    { id: "2", sortAt: 2, deviceClass: "dev", on: false },
    { id: "3", sortAt: 3, deviceClass: "blocked", on: false },
  ],
  (r) => r.on,
);
assert.equal(onlinePreferred.length, 2);
assert.ok(onlinePreferred.some((r) => r.id === "1"));
assert.ok(onlinePreferred.some((r) => r.id === "3"));

const folded = foldByDeviceClass([
  { deviceClass: "shop", sortAt: 1 },
  { deviceClass: "dev", sortAt: 2 },
  { deviceClass: "blocked", sortAt: 3 },
  { deviceClass: "dev", sortAt: 4 },
]);
assert.equal(folded.shop.length, 1);
assert.equal(folded.dev.length, 2);
assert.equal(folded.blocked.length, 1);

console.log("OK test-npos-device-class");
