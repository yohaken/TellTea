/**
 * Owner-style remote ping to online POS tablets (Admin SDK).
 * Proves back-office → device channel without opening Settings UI.
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/ping-pos-devices.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const ONLINE_MS = Number(process.env.POS_ONLINE_MS || 15 * 60 * 1000);
const MESSAGE =
  process.env.POS_PING_MESSAGE ||
  "ถ้าเห็นข้อความนี้ ให้ทักบอกพี่ หรือถ่ายรูปหน้าจอนี้ส่งมา — แปลว่าระบบอัปเดตจากร้านทำงานแล้ว";

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
  const snap = await db.collection("posDevices").get();
  const now = Date.now();
  const online = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const lastSeenAt = typeof data.lastSeenAt === "number" ? data.lastSeenAt : 0;
    if (lastSeenAt > 0 && now - lastSeenAt <= ONLINE_MS) {
      online.push({ id: doc.id, label: data.label || "", pairingCode: data.pairingCode || "", lastSeenAt });
    }
  }

  if (!online.length) {
    console.log("FAIL: ไม่มีเครื่อง POS ออนไลน์ตอนนี้");
    console.log(`เกณฑ์ออนไลน์ = สัญญาณภายใน ${Math.round(ONLINE_MS / 60000)} นาที`);
    console.log("รายการเครื่องทั้งหมด:");
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const lastSeenAt = typeof data.lastSeenAt === "number" ? data.lastSeenAt : 0;
      const ageMin = lastSeenAt ? ((now - lastSeenAt) / 60000).toFixed(1) : "never";
      console.log(
        `- ${doc.id} code=${data.pairingCode || "-"} label=${data.label || "-"} appBuild=${data.appBuild || 0} lastSeenAgeMin=${ageMin}`,
      );
    }
    process.exit(2);
  }

  console.log(`พบเครื่องออนไลน์ ${online.length} เครื่อง — ส่งป๊อปทดสอบ`);
  for (const d of online) {
    await db.collection("posDevices").doc(d.id).set(
      {
        ownerPingAt: now,
        ownerPingMessage: MESSAGE,
        updatedAt: now,
        updatedBy: "owner-ping-script",
      },
      { merge: true },
    );
    console.log(
      `OK ping → ${d.id} code=${d.pairingCode || "-"} label=${d.label || "-"} lastSeen=${new Date(d.lastSeenAt).toISOString()}`,
    );
  }
  console.log("\nDONE — หน้าจอ POS (POS 61+) ควรเด้งป๊อปทันที");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
