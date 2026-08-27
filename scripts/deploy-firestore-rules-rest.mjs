/**
 * Deploy Firestore rules via Rules REST API (skips firebase-tools :test step).
 * Use when `firebase deploy --only firestore:rules` fails with 503 on :test.
 *
 * Env:
 *   FIRESTORE_RULES_FILE=firestore.rules.emergency  — slim rules when full file 503s
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const RELEASE = `projects/${PROJECT}/releases/cloud.firestore`;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function fingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("base64");
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function createRulesetWithRetry(token, content, attempts = 8) {
  const url = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`;
  const body = {
    source: {
      files: [
        {
          name: "firestore.rules",
          content,
          fingerprint: fingerprint(content),
        },
      ],
    },
  };
  for (let i = 1; i <= attempts; i++) {
    try {
      return await api(token, "POST", url, body);
    } catch (err) {
      const retryable = String(err.message).includes("503");
      if (!retryable || i === attempts) throw err;
      const wait = 2000 * i;
      console.warn(`ruleset create 503 — retry ${i}/${attempts} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function patchReleaseWithRetry(token, rulesetName, attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await api(
        token,
        "PATCH",
        `https://firebaserules.googleapis.com/v1/${RELEASE}?updateMask=rulesetName`,
        { release: { name: RELEASE, rulesetName } },
      );
      return;
    } catch (patchErr) {
      const retryable = String(patchErr.message).includes("503");
      if (!retryable && i === 1) {
        await api(
          token,
          "POST",
          `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`,
          { name: RELEASE, rulesetName },
        );
        return;
      }
      if (!retryable || i === attempts) throw patchErr;
      const wait = 2000 * i;
      console.warn(`release patch 503 — retry ${i}/${attempts} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function deployFile(token, fileName) {
  const rulesPath = join(root, fileName);
  const content = readFileSync(rulesPath, "utf8");
  console.log(`REST deploy ${fileName} · ${content.length} chars`);
  const ruleset = await createRulesetWithRetry(token, content);
  const rulesetName = ruleset.name;
  if (!rulesetName) throw new Error("ruleset create returned no name");
  console.log(`ruleset created: ${rulesetName}`);
  await patchReleaseWithRetry(token, rulesetName);
  console.log(`release patched: ${RELEASE}`);
}

async function main() {
  const token = await getToken();
  const forced = process.env.FIRESTORE_RULES_FILE;

  if (forced) {
    await deployFile(token, forced);
    console.log("OK REST firestore rules deploy");
    return;
  }

  try {
    await deployFile(token, "firestore.rules");
    console.log("OK REST firestore rules deploy (full)");
  } catch (err) {
    const retryable = String(err.message).includes("503");
    if (!retryable) throw err;
    console.warn("full rules 503 — deploying firestore.rules.emergency");
    await deployFile(token, "firestore.rules.emergency");
    console.log("OK REST firestore rules deploy (emergency)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
