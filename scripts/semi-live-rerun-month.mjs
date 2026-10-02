/**
 * เทสกึ่งจริง: เอาแถวบัญชีจริงของเดือน มาทำใหม่ด้วยระบบปัจจุบัน (อ่านบิล → ชื่อ/ประเภท/VAT)
 * แล้วเทียบกับค่าที่บันทึกไว้ — อ่านอย่างเดียว ไม่เขียนข้อมูล
 * ใช้ฟังก์ชันตัวในเครื่อง + helper ฝั่งหน้าจอตัวเดียวกับแอป
 *
 *   node scripts/semi-live-rerun-month.mjs [--month=2026-09] [--limit=5] [--before-day=20]
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "mypeer-501909" });
const { classifyLedgerType } = require("./classify-ledger.js");
const { extractOwnerBookFromReceipt } = require("./extract-owner-book.js");
const jiti = createJiti(import.meta.url);
const { billFieldValue, billTypeHintFromExtract, usableBillTypeHint } = await jiti.import(
  join(root, "src/lib/ledger-ai.ts"),
);

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] || d;
const month = arg("month", "2026-09");
const limit = Math.max(1, Number(arg("limit", "5")));
/** --before-day=20 → เฉพาะวันที่ 1–19 ของเดือน */
const before = Number(arg("before-day", "0")) || 0;

const bkkMonth = (ms) => {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(ms))
    .slice(0, 7);
  const y = Number(key.slice(0, 4));
  return y > 2400 ? `${y - 543}${key.slice(4)}` : key;
};
const toMs = (v) => (typeof v === "number" ? v : v?.toMillis?.() ?? Date.parse(v) ?? 0);
const bkkDay = (ms) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" }).format(
    new Date(ms),
  );
const LABEL = { cogs: "ต้นทุน", sga: "ค่าใช้จ่าย", asset: "สินทรัพย์", "อื่นๆ": "อื่นๆ" };
const lab = (t) => LABEL[t] || t || "-";
const money = (n) => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

const snap = await getFirestore().collection("ledger").orderBy("date", "desc").limit(800).get();
const pool = [];
for (const doc of snap.docs) {
  const d = doc.data();
  const urls = (Array.isArray(d.receiptUrls) ? d.receiptUrls : [d.receiptUrl])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  if (!(Number(d.amountOut) > 0) || !urls.length) continue;
  if (String(d.typeSource || "").startsWith("payroll")) continue;
  if (bkkMonth(toMs(d.date)) !== month) continue;
  if (before && Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", day: "2-digit" }).format(new Date(toMs(d.date)))) >= before) continue;
  pool.push({ id: doc.id, ...d, urls });
}

// คละแบบ: มี VAT · ค่าน้ำ/ไฟ · ป้าย «เดา» · ไม่มี VAT · ที่เหลือ
const picks = [];
const take = (fn) => {
  const r = pool.find((x) => !picks.includes(x) && fn(x));
  if (r && picks.length < limit) picks.push(r);
};
take((r) => Number(r.vatInput) > 0 && r.urls.length >= 2);
take((r) => /ค่าน้ำ|ค่าไฟ|ประปา|ไฟฟ้า/.test(r.description || ""));
take((r) => r.typeSource === "heuristic" && Number(r.vatInput) > 0);
take((r) => r.typeSource === "heuristic");
take((r) => !(Number(r.vatInput) > 0) && r.urls.length >= 2);
while (picks.length < limit && pool.some((x) => !picks.includes(x))) take(() => true);

console.log(`เดือน ${month}: แถวเงินออกที่มีรูปบิล ${pool.length} แถว · เลือกทดสอบ ${picks.length}\n`);
const summary = { name: 0, type: 0, vat: 0, amount: 0, aiCalls: 0, savedCalls: 0, fail: 0 };

for (const [i, row] of picks.entries()) {
  const t0 = Date.now();
  const head = `${i + 1}. ${bkkDay(toMs(row.date))} «${row.description}» ${money(row.amountOut)} บาท · ${row.urls.length} รูป`;
  let res;
  try {
    res = await extractOwnerBookFromReceipt.run({ imageRefs: row.urls.slice(0, 4) }, { auth: { uid: "semi-live" } });
    summary.aiCalls += 1;
  } catch (err) {
    summary.fail += 1;
    console.log(`${head}\n   อ่านบิลไม่สำเร็จ: ${err?.message || err}\n`);
    continue;
  }

  // เหมือนบันทึกใหม่: ไม่ได้พิมพ์ชื่อเอง → ชื่อจากบิล
  const newDesc = billFieldValue("", res.description, { typedByUser: false }) || row.description;
  const hint = usableBillTypeHint(billTypeHintFromExtract(res, newDesc), newDesc);
  let newType;
  let typeFrom;
  let reason;
  if (hint) {
    newType = hint.type;
    reason = hint.reason;
    typeFrom = "จากบิล (ไม่เรียก AI ซ้ำ)";
    summary.savedCalls += 1;
  } else {
    const c = await classifyLedgerType.run({ description: newDesc }, { auth: { uid: "semi-live" } });
    summary.aiCalls += 1;
    newType = c.type;
    reason = c.reason;
    typeFrom = res.slipOnly ? "สลิปอย่างเดียว → จัดจากชื่อ" : "บิลไม่ชัด → จัดจากชื่อ";
  }

  const oldVat = Number(row.vatInput) || 0;
  const newVat = Number(res.vatInput) || 0;
  const nameChanged = newDesc.trim() !== String(row.description || "").trim();
  const typeChanged = newType !== row.type;
  const vatChanged = Math.abs(oldVat - newVat) > 0.009;
  const amountChanged = res.amountOut != null && Math.abs(Number(res.amountOut) - Number(row.amountOut)) > 0.009;
  summary.name += nameChanged ? 1 : 0;
  summary.type += typeChanged ? 1 : 0;
  summary.vat += vatChanged ? 1 : 0;
  summary.amount += amountChanged ? 1 : 0;

  console.log(
    `${head} · ${((Date.now() - t0) / 1000).toFixed(0)}s · บิล=${res.docKind}\n` +
      `   ชื่อ:   «${row.description}» → «${newDesc}» ${nameChanged ? "เปลี่ยน" : "เหมือนเดิม"}\n` +
      `   ประเภท: ${lab(row.type)} (${row.typeSource || "-"}) → ${lab(newType)} ${typeChanged ? "เปลี่ยน" : "เหมือนเดิม"} · ${typeFrom} · ${reason}\n` +
      `   ยอด:   ${money(row.amountOut)} → ${money(res.amountOut)} ${amountChanged ? "ต่าง" : "ตรง"}\n` +
      `   VAT:   ${money(oldVat)}${row.vatInvoiceNo ? ` (${row.vatInvoiceNo})` : ""} → ${money(newVat)}${res.vatInvoiceNo ? ` (${res.vatInvoiceNo})` : ""} ${vatChanged ? "ต่าง" : "ตรง"}\n`,
  );
}

console.log(
  `สรุป ${picks.length} แถว: ชื่อเปลี่ยน ${summary.name} · ประเภทเปลี่ยน ${summary.type} · ยอดต่าง ${summary.amount} · VAT ต่าง ${summary.vat} · อ่านบิลพัง ${summary.fail}\n` +
    `เรียก AI ${summary.aiCalls} ครั้ง · ประหยัดการจัดประเภทซ้ำ ${summary.savedCalls} ครั้ง · ไม่ได้บันทึกอะไร`,
);
