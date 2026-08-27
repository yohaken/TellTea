/**
 * Verify production Firestore rules contain required staff-permission markers.
 * Fails CI if repo rules shipped but live rules are stale (Rules API 503 drift).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/verify-firestore-rules-deploy.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/verify-firestore-rules-deploy.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Must exist in live rules — staff roster → permissionLevels path */
const LIVE_MARKERS = [
  "function hasPermFromLevel",
  "function staffOwnsEmployee",
  "function canReadBonusPersonalClose",
  "function linkedLevelActive",
  "function staffHasBrokenLevelLink",
  "function resolvedStaffId",
];

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

async function getToken() {
  const credentials = loadCredentials();
  const auth = new GoogleAuth({
    credentials,
    keyFilename: credentials
      ? undefined
      : process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_KEY,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error(
      "no access token — set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS",
    );
  }
  return token;
}

async function fetchLiveRulesSource(token) {
  const listUrl = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error(`list releases: ${JSON.stringify(listData)}`);

  const cloudFirestore = (listData.releases || []).find(
    (r) => r.name?.endsWith("/releases/cloud.firestore"),
  );
  if (!cloudFirestore?.rulesetName) {
    throw new Error("no cloud.firestore release found");
  }

  const rulesetUrl = `https://firebaserules.googleapis.com/v1/${cloudFirestore.rulesetName}`;
  const rulesetRes = await fetch(rulesetUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ruleset = await rulesetRes.json();
  if (!rulesetRes.ok) throw new Error(`get ruleset: ${JSON.stringify(ruleset)}`);

  const files = ruleset.source?.files || [];
  const rulesFile = files.find((f) => f.name === "firestore.rules") || files[0];
  if (!rulesFile?.content) throw new Error("ruleset has no firestore.rules content");

  return {
    source: rulesFile.content,
    releaseTime: cloudFirestore.createTime || cloudFirestore.updateTime || "",
    rulesetName: cloudFirestore.rulesetName,
  };
}

async function main() {
  const repoRules = readFileSync(join(root, "firestore.rules"), "utf8");
  for (const marker of LIVE_MARKERS) {
    assert.match(repoRules, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const token = await getToken();
  const live = await fetchLiveRulesSource(token);

  const missing = LIVE_MARKERS.filter((m) => !live.source.includes(m));
  if (missing.length) {
    console.error("LIVE rules missing markers (stale deploy):");
    for (const m of missing) console.error(`  - ${m}`);
    console.error(`release: ${live.rulesetName} @ ${live.releaseTime}`);
    process.exit(1);
  }

  console.log(
    `OK live firestore rules · ${LIVE_MARKERS.length} markers · ${live.rulesetName} @ ${live.releaseTime}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
