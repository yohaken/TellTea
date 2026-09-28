/**
 * บันทึกราคาหน้าร้านปัจจุบันเป็นจุดเริ่มต้นของประวัติราคา (menuPriceHistory)
 * — รันครั้งเดียวหลัง deploy trigger · รันซ้ำได้ (doc id คงที่ · มีแล้วข้าม)
 *
 *   node scripts/seed-menu-price-history.mjs            # dry-run (ค่าเริ่มต้น)
 *   node scripts/seed-menu-price-history.mjs --apply    # ต้องมี FIREBASE_SERVICE_ACCOUNT
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.argv.includes("--apply");
const HISTORY_COL = "menuPriceHistory";

function normPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
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
  const now = Date.now();
  const base = { change: "created", from: null, at: now, eventAt: now, source: "script", by: "baseline" };
  const docs = [];

  const items = await db.collection("menuItems").get();
  for (const d of items.docs) {
    const data = d.data();
    docs.push([
      `baseline_item_${d.id}`,
      { ...base, kind: "item", itemId: d.id, name: String(data.name || "").slice(0, 120), to: normPrice(data.price) },
    ]);
  }

  const groups = await db.collection("menuOptionGroups").get();
  for (const g of groups.docs) {
    const data = g.data();
    const options = Array.isArray(data.options) ? data.options : [];
    for (const o of options) {
      if (!o || typeof o.id !== "string" || !o.id) continue;
      docs.push([
        `baseline_opt_${g.id}_${o.id}`,
        {
          ...base,
          kind: "option",
          groupId: g.id,
          name: String(data.name || "").slice(0, 120),
          choiceId: o.id,
          choiceName: String(o.name || "").slice(0, 120),
          to: normPrice(o.priceDelta),
        },
      ]);
    }
  }

  console.log(`items=${items.size} groups=${groups.size} baselineRows=${docs.length}`);
  if (!APPLY) {
    console.log("dry-run — ใส่ --apply เพื่อเขียนจริง");
    return;
  }

  let written = 0;
  let skipped = 0;
  for (const [id, row] of docs) {
    try {
      await db.collection(HISTORY_COL).doc(id).create(row);
      written += 1;
    } catch (err) {
      if (err?.code === 6) skipped += 1;
      else throw err;
    }
  }
  console.log(`written=${written} skipped(existing)=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
