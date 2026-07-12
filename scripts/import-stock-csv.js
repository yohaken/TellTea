/**
 * Import stock CSV → stock + stockMovements
 * Usage: node scripts/import-stock-csv.js "/path/TELL TEA - สต๊อกสินค้า.csv"
 * Env: STOCK_YEAR=2026 STOCK_MONTH=7 CREATED_BY=yohaken@gmail.com
 */
const fs = require("fs");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

const PROJECT = "mypeer-501909";
const KEY =
  process.env.FIREBASE_KEY ||
  "/Users/peerapongyohaken/Downloads/mypeer-501909-3422f8ec89b2.json";
const CSV_PATH =
  process.argv[2] ||
  path.join(process.env.HOME || "", "Downloads", "TELL TEA - สต๊อกสินค้า.csv");
const YEAR = Number(process.env.STOCK_YEAR || 2026);
const MONTH = Number(process.env.STOCK_MONTH || 7);
const CREATED_BY = process.env.CREATED_BY || "yohaken@gmail.com";

const DEFAULT_ITEMS = [
  { name: "ถุงเก็บความเย็น", unit: "ถุง", minQty: 50, safetyStock: 20 },
  { name: "ถุงกระดาษเบเกอรี่", unit: "ถุง", minQty: 100, safetyStock: 30 },
  { name: "แก้วชา", unit: "ใบ", minQty: 200, safetyStock: 50 },
  { name: "หลอดใหญ่", unit: "หลอด", minQty: 500, safetyStock: 100 },
  { name: "หลอดเล็ก 0.5 มล", unit: "หลอด", minQty: 500, safetyStock: 100 },
  { name: "ฝาซีล", unit: "ฝา", minQty: 300, safetyStock: 80 },
  { name: "โซดา", unit: "กระป๋อง", minQty: 24, safetyStock: 12 },
  { name: "โคน S", unit: "โคน", minQty: 30, safetyStock: 10 },
  { name: "โคน M", unit: "โคน", minQty: 30, safetyStock: 10 },
  { name: "โคน L", unit: "โคน", minQty: 30, safetyStock: 10 },
  { name: "IC.นม", unit: "ถุง", minQty: 20, safetyStock: 8 },
  { name: "IC.รสอื่นๆ", unit: "ถุง", minQty: 20, safetyStock: 8 },
];

const PRODUCT_ALIASES = [
  { canonical: "ถุงเก็บความเย็น", keys: ["ถุงเก็บความเย็น", "ถุงเก็บ"] },
  { canonical: "ถุงกระดาษเบเกอรี่", keys: ["ถุงกระดาษเบเกอรี่", "ถุงกระดาษ"] },
  { canonical: "แก้วชา", keys: ["แก้วชา"] },
  { canonical: "หลอดใหญ่", keys: ["หลอดใหญ่"] },
  { canonical: "หลอดเล็ก 0.5 มล", keys: ["หลอดเล็ก0.5มล", "หลอดเล็ก"] },
  { canonical: "ฝาซีล", keys: ["ฝาซีล"] },
  { canonical: "โซดา", keys: ["โซดา"] },
  { canonical: "โคน S", keys: ["โคนs"] },
  { canonical: "โคน M", keys: ["โคนm"] },
  { canonical: "โคน L", keys: ["โคนl"] },
  { canonical: "IC.นม", keys: ["ic.นม", "icนม"] },
  { canonical: "IC.รสอื่นๆ", keys: ["ic.รสอื่น", "icรส"] },
];

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9.]/g, "")
    .toLowerCase();
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r") i += 1;
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

function toNumber(v) {
  const t = String(v || "").trim();
  if (!t || t === "-" || t === "—") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function canonicalProductName(raw) {
  const n = norm(raw);
  for (const alias of PRODUCT_ALIASES) {
    for (const key of alias.keys) {
      if (n === norm(key) || n.includes(norm(key))) return alias.canonical;
    }
  }
  for (const item of DEFAULT_ITEMS) {
    if (n === norm(item.name) || n.includes(norm(item.name))) return item.name;
  }
  return String(raw || "").trim();
}

function colIndex(headers, ...needles) {
  const idx = headers.findIndex((h) => {
    const n = norm(h);
    return needles.some((x) => n.includes(norm(x)));
  });
  return idx >= 0 ? idx : null;
}

function parseDateHeader(cell, year, month) {
  const t = String(cell || "").trim();
  if (!t) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (dmy) {
    const day = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = dmy[3]
      ? dmy[3].length === 2
        ? 2000 + Number(dmy[3])
        : Number(dmy[3])
      : year;
    if (day >= 1 && day <= 31 && mo >= 1 && mo <= 12) return new Date(y, mo - 1, day).getTime();
  }
  if (/^\d{1,2}$/.test(t)) {
    const day = Number(t);
    if (day >= 1 && day <= 31) return new Date(year, month - 1, day).getTime();
  }
  return null;
}

function findHeaderRow(rows, year, month) {
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const row = rows[i] || [];
    let score = 0;
    const h0 = norm(row[0] || "");
    if (h0.includes("รายการ") || h0.includes("ชื่อ") || h0.includes("สินค้า")) score += 5;
    if (colIndex(row, "หน่วย") != null) score += 2;
    if (colIndex(row, "คงเหลือ", "qty", "stock") != null) score += 3;
    score += row.filter((c) => parseDateHeader(c, year, month)).length * 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseStockCsv(text, year, month) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  const headerIdx = findHeaderRow(rows, year, month);
  const headers = rows[headerIdx] || [];
  const skipped = [];

  const nameCol = colIndex(headers, "รายการ", "ชื่อ", "สินค้า") ?? 0;
  const unitCol = colIndex(headers, "หน่วย");
  const qtyCol = colIndex(headers, "คงเหลือ", "qty", "stock", "ยอด");
  const minCol = colIndex(headers, "จุดสั่ง", "reorder", "min", "เตือน", "สั่งซื้อ");
  const safetyCol = colIndex(headers, "สำรอง", "safety");
  const costCol = colIndex(headers, "ราคา", "cost");

  const dateCols = [];
  headers.forEach((h, col) => {
    const date = parseDateHeader(h, year, month);
    if (date != null && col !== nameCol) dateCols.push({ col, date });
  });
  dateCols.sort((a, b) => a.date - b.date);

  const products = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < headers.length) row.push("");
    const rawName = String(row[nameCol] || "").trim();
    if (!rawName || ["รายการ", "ชื่อ", "รวม", "สรุป"].some((k) => norm(rawName) === norm(k))) {
      skipped.push({ row: i + 1, reason: "skip" });
      continue;
    }
    const name = canonicalProductName(rawName);
    const def = DEFAULT_ITEMS.find((d) => d.name === name);
    const unit = unitCol != null && row[unitCol] ? String(row[unitCol]).trim() : def?.unit || "ชิ้น";
    const counts = [];
    for (const { col, date } of dateCols) {
      const val = toNumber(row[col] || "");
      if (val != null) counts.push({ date, qty: val });
    }
    let qty = qtyCol != null ? toNumber(row[qtyCol] || "") : null;
    if (qty == null && counts.length) qty = counts[counts.length - 1].qty;
    if (qty == null) {
      skipped.push({ row: i + 1, reason: "no-qty", name });
      continue;
    }
    products.push({
      name,
      unit,
      qty,
      minQty: minCol != null ? toNumber(row[minCol] || "") || def?.minQty || 0 : def?.minQty || 0,
      safetyStock:
        safetyCol != null ? toNumber(row[safetyCol] || "") || def?.safetyStock || 0 : def?.safetyStock || 0,
      unitCost: costCol != null ? toNumber(row[costCol] || "") || 0 : 0,
      counts,
    });
  }

  const movements = [];
  for (const p of products) {
    const sorted = [...p.counts].sort((a, b) => a.date - b.date);
    if (sorted.length > 1) {
      for (let i = 1; i < sorted.length; i += 1) {
        const delta = sorted[i].qty - sorted[i - 1].qty;
        if (!delta) continue;
        movements.push({
          itemName: p.name,
          type: delta > 0 ? "IN" : "OUT",
          quantity: Math.abs(delta),
          date: sorted[i].date,
          remark: `Import CSV — ${sorted[i - 1].qty} → ${sorted[i].qty}`,
        });
      }
    } else if (p.qty > 0) {
      movements.push({
        itemName: p.name,
        type: "ADJUST",
        quantity: p.qty,
        date: sorted[0]?.date || Date.now(),
        remark: "Import CSV — ยอดจากชีท",
      });
    }
  }

  return { products, movements, skipped };
}

function firestoreValue(value) {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  throw new Error(`unsupported ${typeof value}`);
}

function docFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) fields[k] = firestoreValue(v);
  return fields;
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status}`);
    const json = await res.json();
    for (const d of json.documents || []) docs.push(d);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return docs;
}

async function commitWrites(token, writes) {
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ writes: chunk }),
      },
    );
    if (!res.ok) throw new Error(`commit ${res.status} ${(await res.text()).slice(0, 400)}`);
  }
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`missing ${CSV_PATH}`);
  if (!fs.existsSync(KEY)) throw new Error(`missing service account ${KEY}`);

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const { products, movements, skipped } = parseStockCsv(text, YEAR, MONTH);
  console.log(`parsed products=${products.length} movements=${movements.length} skipped=${skipped.length}`);
  if (skipped.length) console.log("skip sample", skipped.slice(0, 10));
  if (!products.length) process.exit(1);

  products.forEach((p) =>
    console.log(`  ${p.name}: ${p.qty} ${p.unit} (min ${p.minQty}) counts=${p.counts.length}`),
  );

  const token = await getToken();
  const stockDocs = await listDocs(token, "stock");
  const byName = new Map();
  for (const d of stockDocs) {
    const name = d.fields?.name?.stringValue;
    if (name) byName.set(norm(name), d.name.split("/").pop());
  }

  const now = Date.now();
  const writes = [];
  const itemIdByName = new Map();

  for (const p of products) {
    const key = norm(p.name);
    const existingId = byName.get(key);
    const id = existingId || randomId();
    itemIdByName.set(key, id);
    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/stock/${id}`,
        fields: docFields({
          name: p.name,
          unit: p.unit,
          qty: p.qty,
          minQty: p.minQty,
          safetyStock: p.safetyStock,
          unitCost: p.unitCost,
          barcode: null,
          note: "",
          updatedAt: now,
          updatedBy: CREATED_BY,
        }),
      },
    });
  }

  for (const m of movements) {
    const itemId = itemIdByName.get(norm(m.itemName));
    if (!itemId) continue;
    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/stockMovements/${randomId()}`,
        fields: docFields({
          itemId,
          itemName: m.itemName,
          type: m.type,
          quantity: m.quantity,
          date: m.date,
          inspector: CREATED_BY,
          remark: m.remark,
          createdAt: now,
          createdBy: CREATED_BY,
        }),
      },
    });
  }

  await commitWrites(token, writes);
  console.log(`done — upsert ${products.length} products, ${movements.length} movements`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
