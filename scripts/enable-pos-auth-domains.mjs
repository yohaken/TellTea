/**
 * Add telltea-pos.web.app to Firebase Auth authorized domains (POS tablets).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='...' node scripts/enable-pos-auth-domains.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

const POS_AUTHORIZED_DOMAINS = [
  "localhost",
  "telltea-shop.web.app",
  "telltea-pos.web.app",
  "mypeer-501909.firebaseapp.com",
  "mypeer-501909.web.app",
];

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

  const domains = new Set([...(config.authorizedDomains || []), ...POS_AUTHORIZED_DOMAINS]);

  const updated = await api(
    token,
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config?updateMask=authorizedDomains`,
    {
      method: "PATCH",
      body: JSON.stringify({
        authorizedDomains: [...domains],
      }),
    },
  );

  console.log("authorizedDomains:", updated.authorizedDomains?.join(", "));
  if (!updated.authorizedDomains?.includes("telltea-pos.web.app")) {
    throw new Error("telltea-pos.web.app not in authorizedDomains");
  }
  console.log("OK POS auth domains");
}

main().catch((err) => {
  console.error("enable-pos-auth-domains failed:", err.message || err);
  if (err.response) console.error(JSON.stringify(err.response, null, 2));
  process.exit(1);
});
