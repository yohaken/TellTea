/**
 * Turn on QR ให้แต้ม (compCouponEnabled) in production member settings.
 * Idempotent — safe to run every deploy.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/enable-members-comp-coupon.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

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
  const ref = db.doc("meta/memberSettings");
  const snap = await ref.get();
  const d = snap.exists ? snap.data() || {} : {};
  const membersOn = d.enabled === true;
  const already = d.compCouponEnabled === true;
  const quota =
    typeof d.compCouponDailyQuota === "number" && d.compCouponDailyQuota > 0
      ? Math.floor(d.compCouponDailyQuota)
      : 200;
  const points =
    typeof d.compCouponPointsPerSlip === "number" && d.compCouponPointsPerSlip > 0
      ? Math.floor(d.compCouponPointsPerSlip)
      : 1;

  if (already) {
    console.log(
      `OK enable-members-comp-coupon · already on · membersEnabled=${membersOn} · quota=${quota}`,
    );
    return;
  }

  await ref.set(
    {
      compCouponEnabled: true,
      compCouponDailyQuota: quota,
      compCouponPointsPerSlip: points,
      updatedAt: Date.now(),
      updatedBy: "deploy:enable-members-comp-coupon",
    },
    { merge: true },
  );

  console.log(
    `OK enable-members-comp-coupon · enabled · membersEnabled=${membersOn} · quota=${quota} · points=${points}`,
  );
}

main().catch((err) => {
  console.error("FAIL enable-members-comp-coupon", err);
  process.exit(1);
});
