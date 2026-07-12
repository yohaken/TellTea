/**
 * Import bakery bonus CSV → prodProducts / employees / prodEntries
 * Clears existing prod* + employees collections first.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { GoogleAuth } = require("google-auth-library");

const PROJECT = "mypeer-501909";
const KEY = "/Users/peerapongyohaken/Downloads/mypeer-501909-3422f8ec89b2.json";
const CSV_PATH =
  process.argv[2] ||
  path.join(
    process.env.HOME || "",
    "Downloads",
    "TELL TEA - เบเกอรี่โบนัส.csv",
  );
const YEAR = 2026;
const CREATED_BY = "yohaken@gmail.com";

function toNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDateDM(text) {
  const t = String(text || "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(YEAR, month - 1, day).getTime();
}

function mapStatus(raw) {
  const s = String(raw || "").trim();
  if (s.includes("จ่ายโบนัสแล้ว") && !s.includes("เตรียม")) return "paid";
  if (s.includes("เตรียม")) return "pending";
  return "unpaid";
}

function firestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((v) => firestoreValue(v)),
      },
    };
  }
  throw new Error(`unsupported ${typeof value}`);
}

function docFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) fields[k] = firestoreValue(v);
  return fields;
}

async function getToken() {
  const auth = new GoogleAuth({
    keyFile: KEY,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no token");
  return token;
}

async function listDocs(token, collectionId) {
  const docs = [];
  let pageToken = "";
  for (;;) {
    const qs = new URLSearchParams({ pageSize: "300" });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    for (const d of json.documents || []) docs.push(d);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return docs;
}

async function commitWrites(token, writes) {
  if (!writes.length) return;
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ writes: chunk }),
      },
    );
    if (!res.ok) throw new Error(`commit ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
}

async function deleteCollection(token, collectionId) {
  const docs = await listDocs(token, collectionId);
  console.log(`delete ${collectionId}: ${docs.length}`);
  await commitWrites(
    token,
    docs.map((d) => ({ delete: d.name })),
  );
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parse(text, {
    relax_column_count: true,
    skip_empty_lines: false,
    trim: true,
    bom: true,
  });
  const header = rows[0] || [];
  if (!header.includes("วันที่") || !header.includes("สินค้า")) {
    throw new Error("CSV header missing วันที่/สินค้า");
  }

  const entries = [];
  const skipped = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < 15) row.push("");
    const dateRaw = row[0];
    const w1 = String(row[1] || "").trim();
    const w2 = String(row[2] || "").trim();
    const product = String(row[3] || "").trim();
    const qty = toNumber(row[4]);
    const waste = toNumber(row[5]);
    const note = String(row[6] || "").trim();
    const salesRate = toNumber(row[7]);
    const prodRate = toNumber(row[9]);
    const status = mapStatus(row[14]);

    if (!dateRaw || !product || !(qty > 0)) {
      if (dateRaw || product || row[4]) skipped.push({ row: i + 1, reason: "incomplete", dateRaw, product, qty: row[4] });
      continue;
    }
    const date = parseDateDM(dateRaw);
    if (date == null) {
      skipped.push({ row: i + 1, reason: "bad-date", dateRaw });
      continue;
    }
    const workerNames = [w1, w2].filter((n) => n && n !== "-");
    if (!workerNames.length) {
      const names = String(row[12] || "")
        .split(/[,/]/)
        .map((s) => s.trim())
        .filter((n) => n && n !== "-");
      workerNames.push(...names);
    }
    if (!workerNames.length) {
      skipped.push({ row: i + 1, reason: "no-worker", dateRaw, product });
      continue;
    }

    entries.push({
      date,
      workerNames,
      productName: product,
      salesRate,
      prodRate,
      qtyProduced: qty,
      qtyWaste: waste,
      note,
      status,
      sourceRow: i + 1,
    });
  }
  return { entries, skipped };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`missing ${CSV_PATH}`);
  if (!fs.existsSync(KEY)) throw new Error(`missing service account ${KEY}`);

  const { entries, skipped } = parseCsv(CSV_PATH);
  console.log(`parsed entries=${entries.length} skipped=${skipped.length}`);
  if (skipped.length) {
    console.log(
      "skip sample",
      skipped.slice(0, 12),
    );
  }

  const productRates = new Map();
  const workerSet = new Set();
  for (const e of entries) {
    for (const n of e.workerNames) workerSet.add(n);
    const prev = productRates.get(e.productName) || { sales: [], prod: [] };
    prev.sales.push(e.salesRate);
    prev.prod.push(e.prodRate);
    productRates.set(e.productName, prev);
  }

  function mode(arr) {
    const map = new Map();
    for (const n of arr) map.set(n, (map.get(n) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  }

  const token = await getToken();
  for (const col of ["prodEntries", "prodProducts", "employees", "prodWorkers"]) {
    await deleteCollection(token, col);
  }

  const now = Date.now();
  const productIdByName = new Map();
  const workerIdByName = new Map();

  const productWrites = [];
  for (const [name, rates] of productRates) {
    const id = randomId();
    productIdByName.set(name, id);
    productWrites.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/prodProducts/${id}`,
        fields: docFields({
          name,
          salesRate: mode(rates.sales),
          prodRate: mode(rates.prod),
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      },
    });
  }
  await commitWrites(token, productWrites);
  console.log(`products ${productWrites.length}`);

  const workerWrites = [];
  for (const name of [...workerSet].sort()) {
    const id = randomId();
    workerIdByName.set(name, id);
    workerWrites.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/employees/${id}`,
        fields: docFields({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      },
    });
  }
  await commitWrites(token, workerWrites);
  console.log(`workers ${workerWrites.length}`);

  const entryWrites = entries.map((e, i) => {
    const id = randomId();
    const workerIds = e.workerNames.map((n) => workerIdByName.get(n)).filter(Boolean);
    return {
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/prodEntries/${id}`,
        fields: docFields({
          date: e.date,
          workerIds,
          workerNames: e.workerNames,
          productId: productIdByName.get(e.productName) || "",
          productName: e.productName,
          salesRate: e.salesRate,
          prodRate: e.prodRate,
          qtyProduced: e.qtyProduced,
          qtyWaste: e.qtyWaste,
          note: e.note,
          status: e.status,
          createdBy: CREATED_BY,
          createdAt: now + i,
          updatedAt: now + i,
        }),
      },
    };
  });
  await commitWrites(token, entryWrites);
  console.log(`entries ${entryWrites.length}`);
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
