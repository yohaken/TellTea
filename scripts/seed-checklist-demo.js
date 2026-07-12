/**
 * Seed demo SmartCheck records (Jul 1 → today by default).
 *
 * Usage:
 *   node scripts/seed-checklist-demo.js
 *   CHECK_START=2026-07-01 CHECK_END=2026-07-12 node scripts/seed-checklist-demo.js
 *
 * Env: FIREBASE_KEY or GOOGLE_APPLICATION_CREDENTIALS, SKIP_EXISTING=1 (default)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

const PROJECT = "mypeer-501909";
const KEY =
  process.env.FIREBASE_KEY ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(os.homedir(), "Downloads", "mypeer-501909-3422f8ec89b2.json");
const CREATED_BY = process.env.CREATED_BY || "yohaken@gmail.com";
const START = process.env.CHECK_START || "2026-07-01";
const END = process.env.CHECK_END || todayBangkok();
const SKIP_EXISTING = process.env.SKIP_EXISTING !== "0";
const FAIL_RATE = Number(process.env.CHECK_FAIL_RATE || 0.06);

const SHIFTS = [
  { id: "morning", hour: 8 },
  { id: "evening", hour: 17 },
  { id: "late", hour: 1 },
];

const DEFAULT_ITEMS = [
  "กลุ่มเบสนม",
  "กลุ่มเบสชา",
  "ครีมชีส",
  "ขนมปัง",
  "ไอศกรีม",
  "นมสด",
  "วัตถุดิบอื่น",
  "น้ำเต้าหู้",
  "น้ำมะพร้าว",
  "ท็อปปิ้งในตู้เย็น",
  "เครื่องไอศกรีม",
  "แอร์ ความเย็น",
  "กลิ่นภายในร้าน",
  "เปิดปิดเมนูตัวเลือกให้ถูกต้องทุกแอพ",
  "เครื่องกาแฟ ล้าง เช็ค ปรับปรุง",
];

const DEMO_INSPECTORS = ["น้องมิ้นท์", "น้องบีม", "น้องแป้ง", "พี่โอ", "น้องเฟิร์น"];

const FAIL_REMARKS = [
  "ไม่ผ่าน — ต้องแก้ก่อนเปิดร้าน",
  "ของหมด / ยังไม่เติม",
  "แอพเปิดเมนูไม่ครบ",
  "อุณหภูมิไม่ถึง",
  "ต้องทำความสะอาดเพิ่ม",
];

function todayBangkok() {
  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = bangkok.getUTCFullYear();
  const m = String(bangkok.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bangkok.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmd(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function eachLocalDay(startMs, endMs) {
  const days = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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
  if (process.env.FIREBASE_TOKEN) return process.env.FIREBASE_TOKEN;
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

function buildSessions({ itemNames, inspectors, existingKeys, startMs, endMs }) {
  const rand = mulberry32(startMs ^ endMs);
  const sessions = [];
  let skipped = 0;
  let inspectorIdx = 0;
  let dayIdx = 0;

  for (const dateMs of eachLocalDay(startMs, endMs)) {
    for (const shift of SHIFTS) {
      const key = `${dateMs}:${shift.id}`;
      if (SKIP_EXISTING && existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const inspector = inspectors[inspectorIdx % inspectors.length];
      inspectorIdx += 1;
      const items = itemNames.map((itemName, itemIdx) => {
        const status = rand() < FAIL_RATE ? "fail" : "pass";
        const remark =
          status === "fail"
            ? FAIL_REMARKS[(dayIdx + itemIdx + inspectorIdx) % FAIL_REMARKS.length]
            : "";
        return { itemName, status, remark };
      });
      sessions.push({ dateMs, shift: shift.id, shiftHour: shift.hour, inspector, items });
    }
    dayIdx += 1;
  }
  return { sessions, skipped };
}

async function main() {
  if (!fs.existsSync(KEY) && !process.env.FIREBASE_TOKEN) {
    throw new Error(`missing Firebase key at ${KEY}`);
  }

  const startMs = parseYmd(START);
  const endMs = parseYmd(END);
  if (startMs > endMs) throw new Error("CHECK_START must be <= CHECK_END");

  const token = await getToken();

  const itemDocs = await listDocs(token, "checklistItems");
  let itemNames = itemDocs
    .filter((d) => d.fields?.active?.booleanValue !== false)
    .map((d) => d.fields?.name?.stringValue)
    .filter(Boolean);
  if (!itemNames.length) itemNames = DEFAULT_ITEMS;

  const empDocs = await listDocs(token, "employees");
  const empByName = new Map();
  for (const d of empDocs) {
    const id = d.name.split("/").pop();
    const name = d.fields?.name?.stringValue;
    if (name && d.fields?.active?.booleanValue !== false) empByName.set(name, id);
  }
  const inspectors = empByName.size ? [...empByName.keys()] : DEMO_INSPECTORS;

  const recordDocs = await listDocs(token, "checklistRecords");
  const existingKeys = new Set();
  for (const d of recordDocs) {
    const date = Number(d.fields?.date?.integerValue || d.fields?.date?.doubleValue || 0);
    const shift = d.fields?.shift?.stringValue;
    if (date && shift) existingKeys.add(`${date}:${shift}`);
  }
  console.log(`existing sessions=${existingKeys.size} items=${itemNames.length} range ${START} → ${END}`);

  const { sessions, skipped } = buildSessions({
    itemNames,
    inspectors,
    existingKeys,
    startMs,
    endMs,
  });
  console.log(`generate sessions=${sessions.length} skipped=${skipped}`);
  if (!sessions.length) return;

  const now = Date.now();
  const empWrites = [];
  for (const s of sessions) {
    if (!s.inspector || empByName.has(s.inspector)) continue;
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
    const submittedAt = s.dateMs + s.shiftHour * 3600000;
    for (const item of s.items) {
      writes.push({
        update: {
          name: `projects/${PROJECT}/databases/(default)/documents/checklistRecords/${randomId()}`,
          fields: docFields({
            checkId,
            date: s.dateMs,
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
