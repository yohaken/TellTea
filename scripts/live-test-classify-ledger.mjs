/**
 * รันฟังก์ชัน classifyLedgerType ตัวในเครื่อง (ยังไม่ deploy) กับ Firestore + Gemini จริง
 * อ่านอย่างเดียว: meta/aiSettings, meta/businessProfile — ไม่เขียนข้อมูล
 *
 *   node scripts/live-test-classify-ledger.mjs
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");

initializeApp({ credential: applicationDefault(), projectId: "mypeer-501909" });
const { classifyLedgerType } = require("./classify-ledger.js");

const samples = [
  ["ค่าไฟเดือนกันยายน", "sga"],
  ["นมสด 12 กล่อง", "cogs"],
  ["แก้ว 16oz 1000 ใบ", "cogs"],
  ["ซื้อตู้แช่ใหม่", "asset"],
  ["ค่าแรงพนักงาน", "sga"],
  ["ค่าน้ำแข็ง 9ถุง", "cogs"],
  ["ส่งเครื่องซ่อม", "sga"],
  ["ค่าเครื่องดื่ม", "cogs"],
  ["ค่าขนส่งแก้ว", "cogs"],
  ["ค่าเน็ตเดือนนี้", "sga"],
  ["ซื้อเครื่องชงกาแฟ", "asset"],
  ["ใบส่งสินค้า แม็คโคร", "cogs"],
  ["ไม้กวาด ถังขยะ", "sga"],
  ["ล้างแอร์", "sga"],
  ["แป้งเค้ก 5 กก.", "cogs"],
];

let ok = 0;
for (const [description, expected] of samples) {
  try {
    const res = await classifyLedgerType.run({ description }, { auth: { uid: "live-test" } });
    const hit = res.type === expected;
    if (hit) ok += 1;
    console.log(`${hit ? "OK  " : "DIFF"} ${description} → ${res.type} (คาด ${expected}) · ${res.reason}`);
  } catch (err) {
    console.log(`FAIL ${description} → ${err?.message || err}`);
  }
}
console.log(`\n${ok}/${samples.length} ตรงที่คาด`);
process.exit(ok > 0 ? 0 : 1);
