/**
 * nPos deviceClass — shop / dev / blocked wiring + fold helpers.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 220/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+16/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.11\.0"/);
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
assert.match(read("src/lib/npos-ops-log.ts"), /stableKey/);
assert.match(read("src/lib/npos-diagnose.ts"), /deviceClass/);
assert.match(read("src/app/globals.css"), /npos-class-section/);
assert.match(read("src/app/globals.css"), /npos-device-btn/);

// --- pure fold logic (mirrors src/lib/npos-device-class.ts) ---
function resolveNposDeviceClass(input) {
  if (input.blocked === true || input.deviceClass === "blocked") return "blocked";
  if (input.deviceClass === "shop" || input.deviceClass === "dev") return input.deviceClass;
  return input.isEmulator === true ? "dev" : "shop";
}

function nposGroupKey(stableKey, installId) {
  const sk = (stableKey || "").trim();
  if (sk) return `sk:${sk}`;
  return `id:${installId}`;
}

function dedupeByStableKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = nposGroupKey(row.stableKey, row.id);
    const prev = byKey.get(key);
    if (!prev || row.sortAt > prev.sortAt) byKey.set(key, row);
  }
  return [...byKey.values()];
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

const deduped = dedupeByStableKey([
  { id: "a1", stableKey: "abc", sortAt: 10, deviceClass: "shop" },
  { id: "a2", stableKey: "abc", sortAt: 20, deviceClass: "shop" },
  { id: "b1", stableKey: "", sortAt: 5, deviceClass: "dev" },
]);
assert.equal(deduped.length, 2);
assert.equal(deduped.find((r) => r.stableKey === "abc")?.id, "a2");

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
