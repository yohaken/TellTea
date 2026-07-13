/**
 * Enable Firebase Anonymous sign-in for TellTea POS tablets.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' node scripts/enable-anonymous-auth.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/enable-anonymous-auth.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) {
    return JSON.parse(raw);
  }
  return undefined;
}

async function getAccessToken() {
  const credentials = loadCredentials();
  const auth = new GoogleAuth({
    credentials,
    keyFilename: credentials
      ? undefined
      : process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_KEY,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("ไม่ได้ access token — ตรวจ service account");
  return token.token;
}

async function api(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.response = data;
    throw err;
  }
  return data;
}

async function main() {
  console.log(`Project: ${PROJECT}`);
  const token = await getAccessToken();

  console.log("Enabling identitytoolkit.googleapis.com …");
  try {
    await api(
      token,
      `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/identitytoolkit.googleapis.com:enable`,
      { method: "POST" },
    );
  } catch (err) {
    const msg = String(err.message || "");
    if (!/already enabled|ALREADY_EXISTS/i.test(msg)) {
      console.warn("service enable:", msg);
    }
  }

  let config = {};
  try {
    config = await api(token, `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config`);
  } catch (err) {
    console.log("Initializing Identity Platform …");
    await api(
      token,
      `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/identityPlatform:initializeAuth`,
      { method: "POST", body: JSON.stringify({}) },
    );
    config = await api(token, `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config`);
  }

  const wasEnabled = config.signIn?.anonymous?.enabled === true;
  if (wasEnabled) {
    console.log("anonymous.enabled: already true");
    return;
  }

  console.log("Enabling anonymous sign-in for POS …");
  const updated = await api(
    token,
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config?updateMask=signIn.anonymous.enabled`,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          anonymous: { enabled: true },
        },
      }),
    },
  );

  const enabled = updated.signIn?.anonymous?.enabled === true;
  console.log("Done.");
  console.log("anonymous.enabled:", enabled ? "true" : updated.signIn?.anonymous?.enabled);
  if (!enabled) {
    throw new Error("Anonymous sign-in still disabled — เปิดมือที่ Firebase Console");
  }
}

main().catch((err) => {
  console.error("enable-anonymous-auth failed:", err.message || err);
  if (err.response) console.error(JSON.stringify(err.response, null, 2));
  process.exit(1);
});
