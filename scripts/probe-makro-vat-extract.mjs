/**
 * Probe latest Makro / ค่าขนส่ง ledger rows and re-run extractOwnerBook CF locally
 * against stored receipt refs (needs admin + callable auth via service account is NOT
 * enough for onCall — this dumps rows + receipt counts for diagnosis).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/probe-makro-vat-extract.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const LIMIT = Number(process.env.PROBE_LIMIT || 80);

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

async function getToken() {
  const credentials = loadCredentials();
  const auth = new GoogleAuth({
    credentials,
    keyFilename: credentials
      ? undefined
      : process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_KEY,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token — set FIREBASE_SERVICE_ACCOUNT");
  return token;
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue;
  if ("timestampValue" in f) return Date.parse(f.timestampValue);
  if ("arrayValue" in f) {
    return (f.arrayValue.values || []).map((v) => parseField(v));
  }
  return null;
}

function receiptUrlsFromFields(f) {
  const multi = parseField(f.receiptUrls);
  if (Array.isArray(multi) && multi.length) {
    return multi.map(String).filter((u) => u.trim());
  }
  const legacy = String(parseField(f.receiptUrl) || "").trim();
  return legacy ? [legacy] : [];
}

async function run() {
  const token = await getToken();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "ledger" }],
          orderBy: [
            { field: { fieldPath: "date" }, direction: "DESCENDING" },
            { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
          ],
          limit: LIMIT,
        },
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 400));

  const rows = [];
  for (const r of data) {
    const f = r.document?.fields;
    if (!f) continue;
    const description = String(parseField(f.description) || "");
    const hit =
      /แม็คโคร|makro|ค่าขนส่ง/i.test(description) ||
      /แม็คโคร|makro/i.test(String(parseField(f.note) || ""));
    if (!hit) continue;
    const urls = receiptUrlsFromFields(f);
    rows.push({
      id: r.document.name?.split("/").pop() || "",
      description,
      amountOut: Number(parseField(f.amountOut) || 0),
      hasVat: Boolean(parseField(f.hasVat)),
      vatInput: Number(parseField(f.vatInput) || 0),
      vatSource: String(parseField(f.vatSource) || ""),
      vatVerified: Boolean(parseField(f.vatVerified)),
      photoCount: urls.length,
      urlsPreview: urls.map((u) => u.slice(0, 48)),
      date: Number(parseField(f.date) || 0),
    });
  }

  console.log(JSON.stringify({ scanned: LIMIT, makroHits: rows.length, rows }, null, 2));

  const with3 = rows.filter((r) => r.photoCount >= 3);
  const vatMiss = rows.filter((r) => r.photoCount >= 2 && !r.hasVat);
  console.log("---");
  console.log(`rows_with_3plus_photos: ${with3.length}`);
  console.log(`multi_photo_without_vat: ${vatMiss.length}`);
  if (with3[0]) {
    console.log(
      "latest_3plus:",
      with3[0].id,
      with3[0].description,
      `photos=${with3[0].photoCount}`,
      `hasVat=${with3[0].hasVat}`,
      `vatInput=${with3[0].vatInput}`,
    );
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
