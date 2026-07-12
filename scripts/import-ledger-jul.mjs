/**
 * Import confirmed ledger rows (Jul 10–12 2026) — skip duplicates.
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-ledger-jul.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const CREATED_BY = process.env.CREATED_BY || "yohaken@gmail.com";

/** Bangkok local midnight ms */
function bangkokDate(y, m, d) {
  return Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+07:00`,
  );
}

function guessType(description, amountIn) {
  const text = description.trim().toLowerCase();
  if (text.includes("โอนเข้า") || amountIn > 0) return "โอนเข้า";
  return "cogs";
}

/** Confirmed by owner — order matters for running balance (Jul 10–12 2026) */
const ROWS = [
  { y: 2026, m: 7, d: 10, description: "กาแฟ", amountIn: 0, amountOut: 2000 },
  { y: 2026, m: 7, d: 10, description: "ค่าน้ำแข็ง 7ถุง", amountIn: 0, amountOut: 280 },
  { y: 2026, m: 7, d: 10, description: "ค่าของจากท็อปเวิลด์", amountIn: 0, amountOut: 3828 },
  { y: 2026, m: 7, d: 10, description: "โอนเข้า", amountIn: 30000, amountOut: 0 },
  { y: 2026, m: 7, d: 11, description: "ค่าน้ำแข็ง 1ถุง", amountIn: 0, amountOut: 40 },
  { y: 2026, m: 7, d: 11, description: "ค่าของจากแม็คโคร", amountIn: 0, amountOut: 1887 },
  { y: 2026, m: 7, d: 11, description: "ค่าของจากท็อปเวิลด์", amountIn: 0, amountOut: 2751 },
  { y: 2026, m: 7, d: 11, description: "ฝาโถปั่น", amountIn: 0, amountOut: 160 },
  { y: 2026, m: 7, d: 12, description: "ไซรัป+ผงเผือก", amountIn: 0, amountOut: 1150 },
  { y: 2026, m: 7, d: 12, description: "ดอกเกลือ", amountIn: 0, amountOut: 40 },
  { y: 2026, m: 7, d: 12, description: "นมเมจิ", amountIn: 0, amountOut: 299.25 },
];

function rowKey(date, description, amountIn, amountOut) {
  return `${date}|${description.trim()}|${amountIn}|${amountOut}`;
}

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

function firestoreValue(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  throw new Error(`unsupported ${typeof v}`);
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  return null;
}

async function listLedger(token) {
  const out = [];
  let pageToken = "";
  for (;;) {
    const url =
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/ledger?pageSize=300` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    for (const doc of data.documents || []) {
      const f = doc.fields || {};
      out.push({
        date: parseField(f.date),
        description: String(parseField(f.description) || ""),
        amountIn: Number(parseField(f.amountIn) || 0),
        amountOut: Number(parseField(f.amountOut) || 0),
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function commit(token, writes) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ writes }),
    },
  );
  if (!res.ok) throw new Error(await res.text());
}

async function setMetaLedger(token, balance, totalIn, totalOut) {
  const name = `projects/${PROJECT}/databases/(default)/documents/meta/ledger`;
  const fields = {
    balance: firestoreValue(balance),
    totalIn: firestoreValue(totalIn),
    totalOut: firestoreValue(totalOut),
    updatedAt: firestoreValue(Date.now()),
  };
  const mask = "balance,totalIn,totalOut,updatedAt";
  const patchRes = await fetch(`${name}?updateMask.fieldPaths=${mask.replace(/,/g, "&updateMask.fieldPaths=")}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (patchRes.ok) return;
  if (patchRes.status !== 404) throw new Error(await patchRes.text());
  const createRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta?documentId=ledger`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );
  if (!createRes.ok) throw new Error(await createRes.text());
}

async function recomputeMeta(token, entries) {
  const totalIn = entries.reduce((s, e) => s + e.amountIn, 0);
  const totalOut = entries.reduce((s, e) => s + e.amountOut, 0);
  const balance = Math.round((totalIn - totalOut) * 100) / 100;
  await setMetaLedger(token, balance, totalIn, totalOut);
  return balance;
}

async function main() {
  const token = await getToken();
  const existing = await listLedger(token);
  const existingKeys = new Set(
    existing.map((e) => rowKey(e.date, e.description, e.amountIn, e.amountOut)),
  );

  console.log(`Existing ledger rows: ${existing.length}`);

  const toInsert = [];
  const baseCreated = Date.parse("2026-07-10T00:00:01+07:00");

  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const date = bangkokDate(r.y, r.m, r.d);
    const amountIn = r.amountIn;
    const amountOut = r.amountOut;
    const key = rowKey(date, r.description, amountIn, amountOut);
    if (existingKeys.has(key)) {
      console.log("skip (duplicate):", r.description, r.d + "/" + r.m);
      continue;
    }
    toInsert.push({
      date,
      description: r.description,
      amountIn,
      amountOut,
      type: guessType(r.description, amountIn),
      createdBy: CREATED_BY,
      createdAt: baseCreated + i * 1000,
      updatedAt: baseCreated + i * 1000,
      receiptUrl: "",
    });
    existingKeys.add(key);
  }

  if (!toInsert.length) {
    console.log("Nothing to import — all rows already exist.");
    const balance = await recomputeMeta(token, existing);
    console.log("Balance recomputed:", balance);
    return;
  }

  console.log(`Importing ${toInsert.length} new rows...`);

  const writes = toInsert.map((row) => ({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/ledger/${crypto.randomUUID().replace(/-/g, "")}`,
      fields: {
        date: firestoreValue(row.date),
        description: firestoreValue(row.description),
        amountIn: firestoreValue(row.amountIn),
        amountOut: firestoreValue(row.amountOut),
        type: firestoreValue(row.type),
        createdBy: firestoreValue(row.createdBy),
        createdAt: firestoreValue(row.createdAt),
        updatedAt: firestoreValue(row.updatedAt),
        receiptUrl: firestoreValue(row.receiptUrl),
      },
    },
  }));

  for (let i = 0; i < writes.length; i += 400) {
    await commit(token, writes.slice(i, i + 400));
  }

  const all = [...existing, ...toInsert];
  const balance = await recomputeMeta(token, all);

  console.log("Imported:", toInsert.length);
  console.log("Skipped:", ROWS.length - toInsert.length);
  console.log("Total rows:", all.length);
  console.log("Balance:", balance.toLocaleString("th-TH", { minimumFractionDigits: 2 }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
