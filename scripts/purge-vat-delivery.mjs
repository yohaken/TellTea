/**
 * ล้างยอดเดลิเวอรี่ใน vatMonthlyReturns ทุกเดือน + ลบ vatImportRows
 * (ข้อมูลค้างจากระบบนำเข้ารายวันเก่า)
 *
 * Dry-run by default. Apply with APPLY=1.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/purge-vat-delivery.mjs
 *   FIREBASE_SERVICE_ACCOUNT='{...}' APPLY=1 node scripts/purge-vat-delivery.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const ACTOR = process.env.ACTOR || "purge-vat-delivery";

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

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x * 100) / 100;
}

function emptyGp() {
  return {
    mode: "transfer",
    pct: 0,
    amount: 0,
    netTransfer: 0,
    gpVatOverride: 0,
  };
}

function sampleDelivery(data) {
  const ch = data?.delivery?.channels || {};
  const gp = data?.pnlGpByChannel || {};
  return {
    sales: {
      shopee: money(ch.shopee),
      grab: money(ch.grab),
      lineman: money(ch.lineman),
    },
    transfer: {
      shopee: money(gp.shopee?.netTransfer),
      grab: money(gp.grab?.netTransfer),
      lineman: money(gp.lineman?.netTransfer),
    },
    status: data?.status || "draft",
  };
}

async function main() {
  const db = getAdminDb();
  const monthSnap = await db.collection("vatMonthlyReturns").get();
  const importSnap = await db.collection("vatImportRows").get();

  const before = monthSnap.docs.map((d) => ({
    id: d.id,
    ...sampleDelivery(d.data() || {}),
  }));

  const report = {
    project: PROJECT,
    apply: APPLY,
    monthDocs: monthSnap.size,
    importRows: importSnap.size,
    before: before.slice(0, 12),
    cleared: [],
    importDeleted: 0,
  };

  if (!APPLY) {
    console.log(JSON.stringify({ ...report, note: "dry-run · ใส่ APPLY=1 เพื่อล้างจริง" }, null, 2));
    return;
  }

  const now = Date.now();
  for (const d of monthSnap.docs) {
    const data = d.data() || {};
    const delivery = {
      ...(data.delivery || {}),
      kind: "delivery",
      grossManual: 0,
      channels: { shopee: 0, grab: 0, lineman: 0 },
      gpVat: 0,
      useGpEstimate: false,
      reportedGross: 0,
      remitAmount: 0,
      grossSales: 0,
      partsSum: 0,
      vatBase: 0,
      outputVat: 0,
      gpEstimate: 0,
      gpVatClaimed: 0,
      ingredientVatClaimed: 0,
      inputVat: 0,
      netVat: 0,
    };
    // เก็บ ingredientVat ที่อาจอยู่ฝั่ง storefront
    const storefront = data.storefront || {};
    const gpPrev = data.pnlGpByChannel || {};
    const pnlGpByChannel = {
      shopee: emptyGp(),
      grab: emptyGp(),
      lineman: emptyGp(),
      storefront: {
        mode: gpPrev.storefront?.mode || "transfer",
        pct: money(gpPrev.storefront?.pct),
        amount: money(gpPrev.storefront?.amount),
        netTransfer: money(gpPrev.storefront?.netTransfer),
        gpVatOverride: money(gpPrev.storefront?.gpVatOverride),
      },
    };
    const sfGross = money(storefront.reportedGross || storefront.grossSales);
    await d.ref.set(
      {
        delivery,
        pnlGpByChannel,
        pnlDeliveryGpDeduct: 0,
        pnlDeliveryGpPct: 0,
        pnlDeliveryGpMode: "transfer",
        pnlIncome: money(pnlGpByChannel.storefront.netTransfer) || sfGross,
        totals: {
          grossSales: sfGross,
          vatBase: money(storefront.vatBase),
          outputVat: money(storefront.outputVat),
          inputVat: money(storefront.inputVat),
          netVat: money(storefront.netVat),
        },
        status: data.status === "filed" ? "draft" : data.status || "draft",
        filedAt: 0,
        filedBy: "",
        updatedAt: now,
        updatedBy: ACTOR,
      },
      { merge: true },
    );
    report.cleared.push(d.id);
  }

  // ลบแถวนำเข้ารายวัน
  const chunk = 400;
  const refs = importSnap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += chunk) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + chunk)) {
      batch.delete(ref);
      report.importDeleted += 1;
    }
    await batch.commit();
  }

  // เคลียร์ GP เดลิเวอรี่ใน settings (เก็บหน้าร้าน)
  const settingsRef = db.collection("meta").doc("vatMonthlySettings");
  const settingsSnap = await settingsRef.get();
  const prevSf = settingsSnap.data()?.pnlGpByChannel?.storefront || emptyGp();
  await settingsRef.set(
    {
      pnlGpByChannel: {
        shopee: emptyGp(),
        grab: emptyGp(),
        lineman: emptyGp(),
        storefront: {
          mode: prevSf.mode || "transfer",
          pct: money(prevSf.pct),
          amount: money(prevSf.amount),
          netTransfer: money(prevSf.netTransfer),
          gpVatOverride: money(prevSf.gpVatOverride),
        },
      },
      updatedAt: now,
      updatedBy: ACTOR,
    },
    { merge: true },
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
