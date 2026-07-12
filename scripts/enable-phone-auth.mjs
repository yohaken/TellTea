/**
 * Enable Firebase / Identity Platform phone sign-in for TellTea.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' node scripts/enable-phone-auth.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/enable-phone-auth.mjs
 */
const { GoogleAuth } = require("google-auth-library");

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

const AUTHORIZED_DOMAINS = [
  "localhost",
  "telltea-shop.web.app",
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

  const domains = new Set([...(config.authorizedDomains || []), ...AUTHORIZED_DOMAINS]);

  console.log("Enabling phone sign-in + TH SMS region …");
  const updated = await api(
    token,
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config?updateMask=signIn.phoneNumber.enabled,authorizedDomains,smsRegionConfig`,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          phoneNumber: { enabled: true },
        },
        authorizedDomains: [...domains],
        smsRegionConfig: {
          allowByDefault: {},
        },
      }),
    },
  );

  const phone = updated.signIn?.phoneNumber;
  console.log("Done.");
  console.log("phoneNumber.enabled:", phone?.enabled === true ? "true" : phone?.enabled);
  console.log("authorizedDomains:", updated.authorizedDomains?.join(", "));
}

main().catch((err) => {
  console.error("enable-phone-auth failed:", err.message || err);
  if (err.response) console.error(JSON.stringify(err.response, null, 2));
  process.exit(1);
});
