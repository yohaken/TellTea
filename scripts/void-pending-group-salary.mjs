/**
 * One-shot / on-demand: ยกเลิกคิวเงินเดือนกลุ่มที่ยังรอโอน
 * (salary_mid + salary_month_end) — ไม่แตะโบนัส / จ่ายแยก / ที่จ่ายแล้ว
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/void-pending-group-salary.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 node scripts/void-pending-group-salary.mjs
 *   FORCE=1 APPLY=1 …  — รันซ้ำแม้เคยทำแล้ว
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const ACTOR = "system:void-pending-salary-regen";
const FLAG_DOC = "meta/oneShotVoidPendingGroupSalary";
const KINDS = new Set(["salary_mid", "salary_month_end"]);

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

async function main() {
  const db = getAdminDb();
  const flagRef = db.doc(FLAG_DOC);
  const flagSnap = await flagRef.get();
  if (flagSnap.exists && flagSnap.data()?.done === true && process.env.FORCE !== "1") {
    console.log(
      `OK skip — already done at ${flagSnap.data()?.doneAt || "?"} · voided=${flagSnap.data()?.voided ?? "?"}`,
    );
    console.log("Set FORCE=1 APPLY=1 to run again.");
    return;
  }

  const snap = await db.collection("payrollItems").where("status", "==", "pending").get();
  const targets = [];
  for (const d of snap.docs) {
    const data = d.data() || {};
    const kind = String(data.kind || "");
    if (!KINDS.has(kind)) continue;
    targets.push({
      id: d.id,
      name: String(data.employeeName || ""),
      kind,
      periodMonth: String(data.periodMonth || ""),
      amount: Number(data.amount) || 0,
      note: String(data.note || "").trim(),
    });
  }

  targets.sort(
    (a, b) =>
      a.periodMonth.localeCompare(b.periodMonth) ||
      a.name.localeCompare(b.name, "th") ||
      a.kind.localeCompare(b.kind),
  );

  console.log(`Found ${targets.length} pending group-salary row(s) (of ${snap.size} pending total)`);
  for (const t of targets.slice(0, 50)) {
    console.log(
      ` - ${t.periodMonth} · ${t.name} · ${t.kind} · ฿${t.amount} · ${t.id}`,
    );
  }
  if (targets.length > 50) console.log(` ... +${targets.length - 50} more`);

  if (!APPLY) {
    console.log("Dry-run only. Re-run with APPLY=1 to void.");
    return;
  }

  const now = Date.now();
  let batch = db.batch();
  let ops = 0;
  let voided = 0;

  for (const t of targets) {
    const note = t.note.includes("ยกเลิกเพื่อสร้างใหม่")
      ? t.note
      : [t.note, "ยกเลิกเพื่อสร้างใหม่ (ระบบ)"]
          .filter(Boolean)
          .join(" · ");
    batch.update(db.collection("payrollItems").doc(t.id), {
      status: "void",
      paidBy: ACTOR,
      paidAt: now,
      updatedAt: now,
      note,
    });
    ops += 1;
    voided += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await flagRef.set(
    {
      done: true,
      doneAt: now,
      voided,
      kinds: [...KINDS],
      actor: ACTOR,
    },
    { merge: true },
  );

  console.log(`OK voided ${voided} pending group-salary item(s)`);
  console.log("Next: /bonus/ → รอโอน → สร้างเงินเดือน (โบนัสเมื่อหักนิ่ง)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
