/**
 * Deploy Firestore rules via Rules REST API (skips firebase-tools :test step).
 * Use when `firebase deploy --only firestore:rules` fails with 503 on :test.
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

async function main() {
  const rulesPath = join(root, "firestore.rules");
  const content = readFileSync(rulesPath, "utf8");
  const token = await getToken();

  console.log(`REST deploy firestore rules · ${content.length} chars`);

  const ruleset = await api(
    token,
    "POST",
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`,
    {
      source: {
        files: [
          {
            name: "firestore.rules",
            content,
            fingerprint: fingerprint(content),
          },
        ],
      },
    },
  );

  const rulesetName = ruleset.name;
  if (!rulesetName) throw new Error("ruleset create returned no name");

  console.log(`ruleset created: ${rulesetName}`);

  // PATCH release — works when release already exists
  try {
    await api(
      token,
      "PATCH",
      `https://firebaserules.googleapis.com/v1/${RELEASE}?updateMask=rulesetName`,
      { release: { name: RELEASE, rulesetName } },
    );
    console.log(`release patched: ${RELEASE}`);
  } catch (patchErr) {
    console.warn("PATCH failed, trying POST create:", patchErr.message);
    await api(
      token,
      "POST",
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`,
      { name: RELEASE, rulesetName },
    );
    console.log(`release created: ${RELEASE}`);
  }

  console.log("OK REST firestore rules deploy");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
