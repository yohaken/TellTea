#!/usr/bin/env node
/**
 * Seed Firestore ledger from รายวันเดิมรายการ.xlsx
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/import-xlsx.mjs
 */
const fs = require("fs");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");
const XLSX = require("xlsx");

const PROJECT = "mypeer-501909";
const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "รายวันเดิมรายการ.xlsx");

function excelSerialToLocalMidnight(serial) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerIndex = rows.findIndex(
    (r) => Array.isArray(r) && r.includes("วันที่") && r.includes("รายการ"),
  );
  if (headerIndex < 0) throw new Error("header not found");
  const header = {};
  rows[headerIndex].forEach((c, i) => {
    if (c) header[String(c).trim()] = i;
  });
  const out = [];
  const base = Date.UTC(2020, 0, 1);
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const description = String(row[header["รายการ"]] ?? "").trim();
    if (!description) continue;
    const amountIn = toNumber(row[header["เข้า"]]);
    const amountOut = toNumber(row[header["ออก"]]);
    if (amountIn <= 0 && amountOut <= 0) continue;
    const serial = row[header["วันที่"]];
    if (typeof serial !== "number") throw new Error(`bad date row ${i + 1}`);
    let type = String(row[header["type"]] ?? "").trim();
    if (!type && amountIn > 0) {
      type = description.includes("ยกมา") ? "ยอดยกมา" : "โอนเข้า";
    }
    out.push({
      date: excelSerialToLocalMidnight(serial),
      description,
      amountIn,
      amountOut,
      type,
      createdBy: "yohaken@gmail.com",
      createdAt: base + out.length,
    });
  }
  return out;
}

function toFirestoreValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  throw new Error("unsupported " + typeof v);
}

async function main() {
  if (!fs.existsSync(FILE)) throw new Error("missing " + FILE);
  const rows = parseFile(FILE);
  const sumIn = rows.reduce((s, r) => s + r.amountIn, 0);
  const sumOut = rows.reduce((s, r) => s + r.amountOut, 0);
  console.log("rows", rows.length, "balance", +(sumIn - sumOut).toFixed(2));

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;

  // delete existing
  let deleted = 0;
  for (;;) {
    const listRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/ledger?pageSize=300`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const list = await listRes.json();
    const docs = list.documents || [];
    if (!docs.length) break;
    const writes = docs.map((d) => ({ delete: d.name }));
    const delRes = await fetch(
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
    if (!delRes.ok) throw new Error(await delRes.text());
    deleted += docs.length;
    console.log("deleted", deleted);
  }

  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const writes = chunk.map((row) => ({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/ledger/${crypto.randomUUID().replace(/-/g, "")}`,
        fields: {
          date: toFirestoreValue(row.date),
          description: toFirestoreValue(row.description),
          amountIn: toFirestoreValue(row.amountIn),
          amountOut: toFirestoreValue(row.amountOut),
          type: toFirestoreValue(row.type),
          createdBy: toFirestoreValue(row.createdBy),
          createdAt: toFirestoreValue(row.createdAt),
        },
      },
    }));
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
    console.log("imported", Math.min(i + chunk.length, rows.length), "/", rows.length);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
