/**
 * Import OT bonus CSV → employees (missing names) + otEntries
 * Day-only dates → YEAR/MONTH (default Jul 2026).
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { GoogleAuth } = require("google-auth-library");

const PROJECT = "mypeer-501909";
const KEY = "/Users/peerapongyohaken/Downloads/mypeer-501909-3422f8ec89b2.json";
const CSV_PATH =
  process.argv[2] ||
  path.join(process.env.HOME || "", "Downloads", "TELL TEA - โบนัสOT.csv");
const YEAR = Number(process.env.OT_YEAR || 2026);
const MONTH = Number(process.env.OT_MONTH || 7); // 1-12, default July
const CREATED_BY = "yohaken@gmail.com";

function toNumber(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/฿/g, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseShift(raw) {
  const t = String(raw || "").trim();
  if (t.includes("ดึก")) return "late";
  if (t.includes("เช้า")) return "morning";
  if (t.includes("เย็น")) return "evening";
  return null;
}

function firestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((v) => firestoreValue(v)) } };
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

  const entries = [];
  const skipped = [];
  let carryDay = null;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < 21) row.push("");

    // cols: 0 date, 1 w1, 2 w2, 3 shift, 4 machine, 5 empty,
    // 6 other, 7 cone, 8 bread, 9 claim, 10 ded, 11 dedR, 12 add, 13 addR,
    // 14 summary, 15 rate, 16 bonus, 17 per, 18 names, 19 count
    const dayRaw = String(row[0] || "").trim();
    if (dayRaw) {
      const day = Number(dayRaw);
      if (day >= 1 && day <= 31) carryDay = day;
      else {
        skipped.push({ row: i + 1, reason: "bad-day", dayRaw });
        continue;
      }
    }
    if (carryDay == null) {
      skipped.push({ row: i + 1, reason: "no-day" });
      continue;
    }

    const shift = parseShift(row[3]);
    const w1 = String(row[1] || "").trim();
    const w2 = String(row[2] || "").trim();
    const workerNames = [w1, w2].filter((n) => n && n !== "-");

    const machineCount = toNumber(row[4]);
    const otherCups = toNumber(row[6]);
    const iceCreamCones = toNumber(row[7]);
    const breadSlices = toNumber(row[8]);
    const claimCups = toNumber(row[9]);
    const deductQty = toNumber(row[10]);
    const deductReason = String(row[11] || "").trim();
    const addQty = toNumber(row[12]);
    const addReason = String(row[13] || "").trim();
    const bonusRate = toNumber(row[15]) || 0.6;

    if (!shift) {
      skipped.push({ row: i + 1, reason: "no-shift" });
      continue;
    }
    if (!workerNames.length) {
      skipped.push({ row: i + 1, reason: "no-worker", day: carryDay, shift });
      continue;
    }

    const summaryQty =
      machineCount + otherCups + iceCreamCones + breadSlices - claimCups - deductQty + addQty;
    if (summaryQty <= 0 && machineCount <= 0) {
      skipped.push({ row: i + 1, reason: "empty-qty", day: carryDay, shift });
      continue;
    }

    const date = new Date(YEAR, MONTH - 1, carryDay).getTime();
    entries.push({
      date,
      shift,
      workerNames,
      machineCount,
      otherCups,
      iceCreamCones,
      breadSlices,
      claimCups,
      deductQty,
      deductReason,
      addQty,
      addReason,
      bonusRate,
      sourceRow: i + 1,
    });
  }
  return { entries, skipped };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`missing ${CSV_PATH}`);
  if (!fs.existsSync(KEY)) throw new Error(`missing service account ${KEY}`);

  const { entries, skipped } = parseCsv(CSV_PATH);
  console.log(`parsed entries=${entries.length} skipped=${skipped.length} month=${YEAR}-${MONTH}`);
  if (skipped.length) console.log("skip sample", skipped.slice(0, 15));

  const token = await getToken();
  await deleteCollection(token, "otEntries");

  const empDocs = await listDocs(token, "employees");
  const workerIdByName = new Map();
  for (const d of empDocs) {
    const id = d.name.split("/").pop();
    const name = d.fields?.name?.stringValue;
    if (name) workerIdByName.set(name, id);
  }

  const needed = new Set();
  for (const e of entries) for (const n of e.workerNames) needed.add(n);

  const now = Date.now();
  const newEmpWrites = [];
  for (const name of [...needed].sort()) {
    if (workerIdByName.has(name)) continue;
    const id = randomId();
    workerIdByName.set(name, id);
    newEmpWrites.push({
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
  await commitWrites(token, newEmpWrites);
  console.log(`new employees ${newEmpWrites.length}`, [...needed].filter((n) => !empDocs.some((d) => d.fields?.name?.stringValue === n)));

  // settings
  await commitWrites(token, [
    {
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/meta/otSettings`,
        fields: docFields({ bonusRate: 0.6, updatedAt: now }),
      },
    },
  ]);

  const entryWrites = entries.map((e, i) => {
    const id = randomId();
    const workerIds = e.workerNames.map((n) => workerIdByName.get(n)).filter(Boolean);
    return {
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/otEntries/${id}`,
        fields: docFields({
          date: e.date,
          shift: e.shift,
          workerIds,
          workerNames: e.workerNames,
          machineCount: e.machineCount,
          otherCups: e.otherCups,
          iceCreamCones: e.iceCreamCones,
          breadSlices: e.breadSlices,
          claimCups: e.claimCups,
          deductQty: e.deductQty,
          deductReason: e.deductReason,
          addQty: e.addQty,
          addReason: e.addReason,
          bonusRate: e.bonusRate,
          status: "pending",
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
