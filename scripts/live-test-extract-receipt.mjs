/**
 * รันฟังก์ชันอ่านบิล extractOwnerBookFromReceipt ตัวในเครื่อง กับรูปบิลจริงใน ledger + Gemini จริง
 * อ่านอย่างเดียว — ไม่เขียนข้อมูล
 *
 *   node scripts/live-test-extract-receipt.mjs [--limit=8]
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "mypeer-501909" });
const { extractOwnerBookFromReceipt } = require("./extract-owner-book.js");

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1]) || 8);

const db = getFirestore();
const snap = await db.collection("ledger").orderBy("date", "desc").limit(300).get();
const seen = new Set();
const rows = [];
for (const doc of snap.docs) {
  const d = doc.data();
  const urls = (Array.isArray(d.receiptUrls) ? d.receiptUrls : [d.receiptUrl])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (!(Number(d.amountOut) > 0) || !urls.length) continue;
  const key = String(d.description || "").replace(/\s+/g, "");
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ id: doc.id, ...d, urls });
  if (rows.length >= limit) break;
}

let ok = 0;
let typeSame = 0;
for (const row of rows) {
  const t0 = Date.now();
  try {
    const res = await extractOwnerBookFromReceipt.run(
      { imageRefs: row.urls.slice(0, 4) },
      { auth: { uid: "live-test" } },
    );
    ok += 1;
    const amountHit = Number(res.amountOut) === Number(row.amountOut);
    const vatHit = Number(res.vatInput || 0) === Number(row.vatInput || 0);
    if (res.type === row.type) typeSame += 1;
    console.log(
      `OK   ${row.description} (${row.urls.length} รูป, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
        `     อ่านได้: «${res.description}» ${res.amountOut} บาท ${amountHit ? "✓" : `✗ (บัญชี ${row.amountOut})`}` +
        ` · VAT ${res.vatInput ?? "-"} ${vatHit ? "✓" : `✗ (บัญชี ${row.vatInput || 0})`}` +
        ` · ${res.docKind}\n` +
        `     ประเภท: ${res.type} (บัญชี ${row.type || "-"} / ${row.typeSource || "-"}) · ${res.reason}`,
    );
  } catch (err) {
    console.log(`FAIL ${row.description} → ${err?.message || err}`);
  }
}
console.log(`\nอ่านสำเร็จ ${ok}/${rows.length} · ประเภทตรงกับบัญชี ${typeSame}/${ok}`);
process.exit(ok > 0 ? 0 : 1);
