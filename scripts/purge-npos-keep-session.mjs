/**
 * Purge orphan nPos bills/mutations outside one keep sales session.
 *
 * Does NOT delete:
 *  - the keep posSessions doc
 *  - posSales with sessionId === keep session
 *  - posSaleMutations whose saleId points at a keep sale
 *  - posDevices / diagnose / ops / captures
 *
 * Recomputes meta/posMenuRank from remaining completed sales (window days).
 *
 * Dry-run by default. Apply with APPLY=1.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' KEEP_SESSION_CODE=785414397411 \
 *     node scripts/purge-npos-keep-session.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 KEEP_SESSION_CODE=785414397411 \
 *     node scripts/purge-npos-keep-session.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const KEEP_CODE = (process.env.KEEP_SESSION_CODE || "785414397411")
  .trim()
  .toUpperCase()
  .replace(/^#/, "");
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const WINDOW_DAYS = Math.min(
  14,
  Math.max(7, Number(process.env.BESTSELLER_WINDOW_DAYS || 7) || 7),
);

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

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function posSessionCode(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return "—";
  if (id.length <= 16) return id.toUpperCase();
  return id.slice(-12).toUpperCase();
}

async function commitDeletes(db, refs) {
  let deleted = 0;
  const chunkSize = 400;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + chunkSize)) {
      batch.delete(ref);
      deleted += 1;
    }
    await batch.commit();
  }
  return deleted;
}

async function recomputeRank(db) {
  const now = Date.now();
  const since = now - WINDOW_DAYS * 86_400_000;
  const [salesSnap, itemsSnap, posSnap] = await Promise.all([
    db.collection("posSales").where("createdAt", ">=", since).get(),
    db.collection("menuItems").get(),
    db.doc("meta/pos").get(),
  ]);

  const categoryIdByItem = {};
  for (const d of itemsSnap.docs) {
    const x = d.data() || {};
    if (typeof x.categoryId === "string" && x.categoryId) {
      categoryIdByItem[d.id] = x.categoryId;
    }
  }

  const itemQty = new Map();
  for (const d of salesSnap.docs) {
    const x = d.data() || {};
    if (x.status && x.status !== "completed") continue;
    const lines = Array.isArray(x.lines) ? x.lines : [];
    for (const line of lines) {
      if (!line) continue;
      const id =
        typeof line.menuItemId === "string" && line.menuItemId.trim()
          ? line.menuItemId.trim()
          : typeof line.name === "string"
            ? line.name.trim()
            : "";
      if (!id) continue;
      const qty = Math.max(0, Number(line.qty) || 0);
      if (!qty) continue;
      const categoryId =
        (typeof line.categoryId === "string" && line.categoryId) ||
        categoryIdByItem[id] ||
        "";
      const prev = itemQty.get(id) || { qty: 0, categoryId };
      prev.qty += qty;
      if (!prev.categoryId && categoryId) prev.categoryId = categoryId;
      itemQty.set(id, prev);
    }
  }

  const items = [...itemQty.entries()]
    .map(([menuItemId, v]) => ({
      menuItemId,
      categoryId: v.categoryId || "",
      qty: v.qty,
      score: v.qty,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score || a.menuItemId.localeCompare(b.menuItemId))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const catScore = new Map();
  for (const it of items) {
    if (!it.categoryId) continue;
    catScore.set(it.categoryId, (catScore.get(it.categoryId) || 0) + it.qty);
  }
  const categories = [...catScore.entries()]
    .map(([categoryId, score]) => ({ categoryId, score, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.categoryId.localeCompare(b.categoryId))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const pos = posSnap.exists ? posSnap.data() || {} : {};
  const menuArrangeMode =
    pos.menuArrangeMode === "bestsellers" ? "bestsellers" : "fix";
  const payload = {
    windowDays: WINDOW_DAYS,
    computedAt: now,
    menuArrangeMode,
    categories,
    items,
    itemCount: items.length,
    categoryCount: categories.length,
    purgedReason: `keep_session_${KEEP_CODE}`,
    purgedAt: now,
  };
  await db.doc("meta/posMenuRank").set(payload, { merge: true });
  return {
    itemCount: items.length,
    categoryCount: categories.length,
    topItems: items.slice(0, 8).map((it) => ({
      menuItemId: it.menuItemId,
      qty: it.qty,
    })),
  };
}

async function main() {
  const db = getAdminDb();
  const [sessionsSnap, salesSnap, mutationsSnap] = await Promise.all([
    db.collection("posSessions").get(),
    db.collection("posSales").get(),
    db.collection("posSaleMutations").get(),
  ]);

  const keepSessions = [];
  const sessionRefsToDelete = [];
  for (const docSnap of sessionsSnap.docs) {
    const code = posSessionCode(docSnap.id);
    if (code === KEEP_CODE) keepSessions.push(docSnap);
    else sessionRefsToDelete.push(docSnap.ref);
  }

  if (keepSessions.length === 0) {
    throw new Error(
      `ไม่พบรอบรหัส ${KEEP_CODE} — ยกเลิกเพื่อกันพลาด (ไม่ลบอะไร)`,
    );
  }
  if (keepSessions.length > 1) {
    throw new Error(
      `พบรอบรหัส ${KEEP_CODE} ซ้ำ ${keepSessions.length} อัน — ยกเลิกเพื่อกันพลาด`,
    );
  }

  const keepSession = keepSessions[0];
  const keepSessionId = keepSession.id;
  const keepSessionData = keepSession.data() || {};

  const keepSaleIds = new Set();
  const saleRefsToDelete = [];
  let keepSalesCompleted = 0;
  let keepSalesVoided = 0;
  const outsideSaleSamples = [];

  for (const docSnap of salesSnap.docs) {
    const data = docSnap.data() || {};
    const sessionId = asString(data.sessionId, 120);
    const status = asString(data.status, 24);
    if (sessionId === keepSessionId) {
      keepSaleIds.add(docSnap.id);
      if (status === "voided") keepSalesVoided += 1;
      else keepSalesCompleted += 1;
    } else {
      saleRefsToDelete.push(docSnap.ref);
      if (outsideSaleSamples.length < 25) {
        outsideSaleSamples.push({
          id: docSnap.id,
          billNo: asString(data.billNo, 40),
          sessionId,
          sessionCode: posSessionCode(sessionId),
          status: status || "—",
          total: typeof data.total === "number" ? data.total : 0,
          createdAtIso: toMs(data.createdAt)
            ? new Date(toMs(data.createdAt)).toISOString()
            : null,
          deviceId: asString(data.deviceId, 80),
        });
      }
    }
  }

  if (keepSaleIds.size === 0) {
    throw new Error(
      `รอบ ${KEEP_CODE} ไม่มีบิลใน posSales — ยกเลิก (อาจรหัสผิด)`,
    );
  }

  const mutationRefsToDelete = [];
  let mutationsKeep = 0;
  let mutationsNoSaleId = 0;
  for (const docSnap of mutationsSnap.docs) {
    const data = docSnap.data() || {};
    const saleId = asString(data.saleId, 80);
    if (saleId && keepSaleIds.has(saleId)) {
      mutationsKeep += 1;
      continue;
    }
    if (!saleId) mutationsNoSaleId += 1;
    mutationRefsToDelete.push(docSnap.ref);
  }

  const plan = {
    at: new Date().toISOString(),
    project: PROJECT,
    apply: APPLY,
    keepSessionCode: KEEP_CODE,
    keepSession: {
      id: keepSessionId,
      status: asString(keepSessionData.status, 24),
      deviceId: asString(keepSessionData.deviceId, 80),
      openedAtIso: toMs(keepSessionData.openedAt)
        ? new Date(toMs(keepSessionData.openedAt)).toISOString()
        : null,
      saleCount: keepSessionData.saleCount ?? null,
      totalSales: keepSessionData.totalSales ?? null,
    },
    willKeep: {
      sessions: 1,
      sales: keepSaleIds.size,
      salesCompleted: keepSalesCompleted,
      salesVoided: keepSalesVoided,
      mutations: mutationsKeep,
    },
    willDelete: {
      sessions: sessionRefsToDelete.length,
      sales: saleRefsToDelete.length,
      mutations: mutationRefsToDelete.length,
      mutationsNoSaleId,
    },
    outsideSaleSamples,
    safety: {
      touchesDevices: false,
      touchesKeepSession: false,
      touchesKeepSales: false,
      recomputesPosMenuRank: true,
      windowDays: WINDOW_DAYS,
    },
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!APPLY) {
    console.log("\nDRY-RUN เท่านั้น — ตั้ง APPLY=1 เพื่อลบจริง");
    return;
  }

  const deletedSessions = await commitDeletes(db, sessionRefsToDelete);
  const deletedSales = await commitDeletes(db, saleRefsToDelete);
  const deletedMutations = await commitDeletes(db, mutationRefsToDelete);
  const rank = await recomputeRank(db);

  // Verify keep session + sales still present
  const keepSessionAfter = await db.collection("posSessions").doc(keepSessionId).get();
  if (!keepSessionAfter.exists) {
    throw new Error("ผิดปกติ: รอบจริงหายหลังลบ — หยุด");
  }
  const salesAfter = await db.collection("posSales").get();
  let keepAfter = 0;
  let outsideAfter = 0;
  for (const d of salesAfter.docs) {
    const sid = asString((d.data() || {}).sessionId, 120);
    if (sid === keepSessionId) keepAfter += 1;
    else outsideAfter += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        keepSessionCode: KEEP_CODE,
        deletedSessions,
        deletedSales,
        deletedMutations,
        keptSalesAfter: keepAfter,
        outsideSalesAfter: outsideAfter,
        rank,
      },
      null,
      2,
    ),
  );

  if (outsideAfter > 0) {
    throw new Error(`ยังเหลือบิลนอกรอบจริง ${outsideAfter} ใบหลังลบ`);
  }
  if (keepAfter !== keepSaleIds.size) {
    throw new Error(
      `จำนวนบิลรอบจริงเปลี่ยน ${keepSaleIds.size} → ${keepAfter}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
