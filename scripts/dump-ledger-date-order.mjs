/**
 * Dump live ledger date order (Firestore desc vs Bangkok-day client sort).
 * Usage: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/dump-ledger-date-order.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";

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
  if (!token) throw new Error("no access token");
  return token;
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("timestampValue" in f) return Date.parse(f.timestampValue);
  return null;
}

function bangkokKey(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function formatShort(ms) {
  if (!ms) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${Number(get("day"))}/${Number(get("month"))}/${get("year")}`;
}

async function runQuery(token, orderDateDir) {
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
            { field: { fieldPath: "date" }, direction: orderDateDir },
            { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
          ],
          limit: 40,
        },
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  const rows = [];
  for (const r of data) {
    const f = r.document?.fields;
    if (!f) continue;
    const date = Number(parseField(f.date) || 0);
    const createdAt = Number(parseField(f.createdAt) || 0);
    const description = String(parseField(f.description) || "").slice(0, 48);
    const id = r.document.name?.split("/").pop() || "";
    rows.push({
      id,
      date,
      createdAt,
      description,
      bkk: bangkokKey(date),
      label: formatShort(date),
      dateType: f.date ? Object.keys(f.date).join(",") : "missing",
    });
  }
  return rows;
}

function clientSort(rows) {
  return [...rows].sort((a, b) => {
    if (a.bkk !== b.bkk) return b.bkk.localeCompare(a.bkk);
    return b.createdAt - a.createdAt;
  });
}

function isNonIncreasingLabels(rows) {
  // newest→oldest by Bangkok day: each next day key <= previous
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].bkk > rows[i - 1].bkk) return false;
  }
  return true;
}

async function main() {
  const token = await getToken();
  const desc = await runQuery(token, "DESCENDING");
  const asc = await runQuery(token, "ASCENDING");
  const client = clientSort(desc);

  console.log("=== Firestore orderBy date DESC (first 40) ===");
  desc.forEach((r, i) =>
    console.log(
      `${String(i + 1).padStart(2)} ${r.label.padEnd(8)} bkk=${r.bkk} type=${r.dateType} ms=${r.date} ${r.description}`,
    ),
  );
  console.log("desc_is_newest_first_by_bkk:", isNonIncreasingLabels(desc));

  console.log("\n=== Firestore orderBy date ASC (first 40) ===");
  asc.slice(0, 15).forEach((r, i) =>
    console.log(`${String(i + 1).padStart(2)} ${r.label.padEnd(8)} bkk=${r.bkk} ${r.description}`),
  );

  console.log("\n=== Client Bangkok sort of DESC page ===");
  client.forEach((r, i) =>
    console.log(`${String(i + 1).padStart(2)} ${r.label.padEnd(8)} bkk=${r.bkk} ${r.description}`),
  );
  console.log("client_is_newest_first_by_bkk:", isNonIncreasingLabels(client));

  const typeCounts = {};
  for (const r of desc) typeCounts[r.dateType] = (typeCounts[r.dateType] || 0) + 1;
  console.log("\ndate field types:", typeCounts);

  // Detect visual jumps in DESC query
  const jumps = [];
  for (let i = 1; i < desc.length; i++) {
    if (desc[i].bkk > desc[i - 1].bkk) {
      jumps.push(`${i}:${desc[i - 1].label}->${desc[i].label}`);
    }
  }
  console.log("bkk_forward_jumps_in_firestore_desc:", jumps);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
