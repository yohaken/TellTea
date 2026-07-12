/**
 * Import SOP readiness CSV → checklistRecords (vertical rows)
 * Usage: node scripts/import-checklist-csv.js "/path/TELL TEA - ความพร้อม.csv"
 * Env: CHECK_YEAR=2026 CHECK_MONTH=7
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
  path.join(process.env.HOME || "", "Downloads", "TELL TEA - ความพร้อม.csv");
const YEAR = Number(process.env.CHECK_YEAR || 2026);
const MONTH = Number(process.env.CHECK_MONTH || 7);
const CREATED_BY = process.env.CREATED_BY || "yohaken@gmail.com";
const CLEAR = process.env.CLEAR === "1";

const ITEM_MATCHERS = [
  { name: "กลุ่มเบสนม", keys: ["เบสนม", "กลุ่มเบสนม"] },
  { name: "กลุ่มเบสชา", keys: ["เบสชา", "กลุ่มเบสชา"] },
  { name: "ครีมชีส", keys: ["ครีมชีส"] },
  { name: "ขนมปัง", keys: ["ขนมปัง"] },
  { name: "ไอศกรีม", keys: ["ไอศกรีม", "ไอศรีม"] },
  { name: "นมสด", keys: ["นมสด"] },
  { name: "วัตถุดิบอื่น", keys: ["วัตถุดิบอื่น", "วัตถุดิบ"] },
  { name: "น้ำเต้าหู้", keys: ["น้ำเต้าหู้", "เต้าหู้"] },
  { name: "น้ำมะพร้าว", keys: ["น้ำมะพร้าว", "มะพร้าว"] },
  { name: "ท็อปปิ้งในตู้เย็น", keys: ["ท็อปปิ้ง"] },
  { name: "เครื่องไอศกรีม", keys: ["เครื่องไอศกรีม", "เครื่องไอศครีม"] },
  { name: "แอร์ ความเย็น", keys: ["แอร์", "ความเย็น"] },
  { name: "กลิ่นภายในร้าน", keys: ["กลิ่น"] },
  { name: "เปิดปิดเมนูตัวเลือกให้ถูกต้องทุกแอพ", keys: ["เมนู", "แอพ", "ตัวเลือก"] },
  { name: "เครื่องกาแฟ ล้าง เช็ค ปรับปรุง", keys: ["กาแฟ", "เครื่องกาแฟ"] },
];

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9]/g, "")
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

function parseShift(raw) {
  const t = String(raw || "").trim();
  if (t.includes("ดึก")) return "late";
  if (t.includes("เช้า")) return "morning";
  if (t.includes("เย็น")) return "evening";
  return null;
}

function parseStatus(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "-" || s === "—") return null;
  if (s.includes("ไม่ผ่าน")) return "fail";
  if (s.includes("ผ่าน")) return "pass";
  return null;
}

function matchItemName(header) {
  const h = norm(header);
  if (!h || h.includes("วันที่") || h.includes("ผู้ตรวจ") || h.includes("รอบ")) return null;
  for (const m of ITEM_MATCHERS) {
    for (const key of m.keys) {
      if (h.includes(norm(key))) return m.name;
    }
  }
  return null;
}

function findHeaderRow(rows) {
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const score = (rows[i] || []).filter((c) => matchItemName(c)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { headerIdx: bestIdx, score: bestScore };
}

function colIndex(headers, ...needles) {
  const idx = headers.findIndex((h) => {
    const n = norm(h);
    return needles.some((x) => n.includes(norm(x)));
  });
  return idx >= 0 ? idx : null;
}

function parseChecklistCsv(text, year, month) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  const { headerIdx, score } = findHeaderRow(rows);
  if (score < 2) throw new Error("no item headers found");

  const headers = rows[headerIdx] || [];
  const itemCols = [];
  headers.forEach((h, col) => {
    const name = matchItemName(h);
    if (name) itemCols.push({ col, itemName: name });
  });

  const dateCol = colIndex(headers, "วันที่") ?? 0;
  const inspectorCol = colIndex(headers, "ผู้ตรวจ");
  const shiftCol = colIndex(headers, "รอบงาน", "รอบ", "กะ");

  const sessions = [];
  const skipped = [];
  let carryDay = null;

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < headers.length) row.push("");

    const dayRaw = String(row[dateCol] || "").trim();
    if (dayRaw) {
      const day = Number(dayRaw.replace(/[^\d]/g, ""));
      if (day >= 1 && day <= 31) carryDay = day;
    }

    let shift = shiftCol != null ? parseShift(row[shiftCol]) : null;
    if (!shift) {
      for (const cell of row) {
        shift = parseShift(cell);
        if (shift) break;
      }
    }

    let inspector = inspectorCol != null ? String(row[inspectorCol] || "").trim() : "";
    if (!inspector) {
      for (let c = 0; c < Math.min(row.length, 4); c += 1) {
        const v = String(row[c] || "").trim();
        if (v && !parseShift(v) && !/^\d+$/.test(v) && v.length <= 20) {
          inspector = v;
          break;
        }
      }
    }
    inspector = inspector.replace(/^-\s*/, "").trim();

    if (carryDay == null) {
      skipped.push({ row: i + 1, reason: "no-day" });
      continue;
    }
    if (!shift) {
      skipped.push({ row: i + 1, reason: "no-shift" });
      continue;
    }

    const items = [];
    for (const { col, itemName } of itemCols) {
      const status = parseStatus(row[col]);
      if (!status) continue;
      items.push({ itemName, status, remark: status === "fail" ? String(row[col] || "").trim() : "" });
    }
    if (!items.length) {
      skipped.push({ row: i + 1, reason: "no-status" });
      continue;
    }

    sessions.push({
      date: new Date(year, month - 1, carryDay).getTime(),
      shift,
      inspector: inspector || "—",
      items,
    });
  }
  return { sessions, skipped };
}

function firestoreValue(value) {
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

function shiftHour(shift) {
  if (shift === "morning") return 8;
  if (shift === "evening") return 17;
  return 1;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`missing ${CSV_PATH}`);
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const { sessions, skipped } = parseChecklistCsv(text, YEAR, MONTH);
  console.log(`parsed sessions=${sessions.length} skipped=${skipped.length} ${YEAR}-${MONTH}`);
  if (skipped.length) console.log("skip sample", skipped.slice(0, 10));
  if (!sessions.length) process.exit(1);

  const token = await getToken();
  if (CLEAR) {
    const old = await listDocs(token, "checklistRecords");
    console.log(`clear checklistRecords ${old.length}`);
    await commitWrites(token, old.map((d) => ({ delete: d.name })));
  }

  const empDocs = await listDocs(token, "employees");
  const empByName = new Map();
  for (const d of empDocs) {
    const id = d.name.split("/").pop();
    const name = d.fields?.name?.stringValue;
    if (name) empByName.set(name, id);
  }

  const now = Date.now();
  const empWrites = [];
  for (const s of sessions) {
    if (!s.inspector || s.inspector === "—" || empByName.has(s.inspector)) continue;
    const id = randomId();
    empByName.set(s.inspector, id);
    empWrites.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/employees/${id}`,
        fields: docFields({ name: s.inspector, active: true, createdAt: now, updatedAt: now }),
      },
    });
  }
  await commitWrites(token, empWrites);
  console.log(`new employees ${empWrites.length}`);

  const writes = [];
  for (const s of sessions) {
    const checkId = randomId();
    const inspectorId = empByName.get(s.inspector) || "";
    const submittedAt = s.date + shiftHour(s.shift) * 3600000;
    for (const item of s.items) {
      writes.push({
        update: {
          name: `projects/${PROJECT}/databases/(default)/documents/checklistRecords/${randomId()}`,
          fields: docFields({
            checkId,
            date: s.date,
            shift: s.shift,
            inspector: s.inspector,
            inspectorId,
            itemId: item.itemName,
            itemName: item.itemName,
            status: item.status,
            remark: item.remark,
            imageUrl: "",
            submittedAt,
            createdBy: CREATED_BY,
            createdAt: now,
          }),
        },
      });
    }
  }
  await commitWrites(token, writes);
  console.log(`records ${writes.length} DONE`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
