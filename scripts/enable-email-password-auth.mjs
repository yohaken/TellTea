/**
 * Enable Firebase email/password sign-in for staff BO login.
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

const AUTHORIZED_DOMAINS = [
  "localhost",
  "telltea-bo.web.app",
  "telltea-shop.web.app",
  "telltea-pos.web.app",
  "mypeer-501909.firebaseapp.com",
  "mypeer-501909.web.app",
];

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
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
  if (!token.token) throw new Error("no access token");
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
  } catch {
    await api(
      token,
      `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/identityPlatform:initializeAuth`,
      { method: "POST", body: JSON.stringify({}) },
    );
    config = await api(token, `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config`);
  }

  const domains = new Set([...(config.authorizedDomains || []), ...AUTHORIZED_DOMAINS]);
  const updated = await api(
    token,
    `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config?updateMask=signIn.email.enabled,authorizedDomains`,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          email: { enabled: true, passwordRequired: true },
        },
        authorizedDomains: [...domains],
      }),
    },
  );

  console.log("email.enabled:", updated.signIn?.email?.enabled === true);
}

main().catch((err) => {
  console.error("enable-email-password-auth failed:", err.message || err);
  process.exit(1);
});
