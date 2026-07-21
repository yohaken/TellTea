/**
 * Owner-style remote ping to POS tablets (Admin SDK).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/ping-pos-devices.mjs
 *   POS_PING_FORCE=1  → ถ้าไม่มีเครื่องออนไลน์ จะส่งไปเครื่องที่เห็นล่าสุดแทน
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const ONLINE_MS = Number(process.env.POS_ONLINE_MS || 15 * 60 * 1000);
const FORCE = process.env.POS_PING_FORCE === "1" || process.env.POS_PING_FORCE === "true";
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

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

async function main() {
  const db = getAdminDb();
  const snap = await db.collection("posDevices").get();
  const now = Date.now();
  const all = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const lastSeenAt = toMs(data.lastSeenAt);
    all.push({
      id: doc.id,
      label: typeof data.label === "string" ? data.label : "",
      pairingCode: typeof data.pairingCode === "string" ? data.pairingCode : "",
      appBuild: typeof data.appBuild === "number" ? data.appBuild : 0,
      lastSeenAt,
    });
  }
  all.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  let targets = all.filter((d) => d.lastSeenAt > 0 && now - d.lastSeenAt <= ONLINE_MS);
  let mode = "online";
  if (!targets.length && FORCE && all.length) {
    targets = all.slice(0, 3);
    mode = "force-latest";
  }

  console.log(`เครื่องทั้งหมด ${all.length} · เป้าหมาย ${targets.length} (mode=${mode})`);
  for (const d of all.slice(0, 10)) {
    const ageMin = d.lastSeenAt ? ((now - d.lastSeenAt) / 60000).toFixed(1) : "never";
    console.log(
      `- ${d.id} code=${d.pairingCode || "-"} build=${d.appBuild} lastSeenAgeMin=${ageMin}`,
    );
  }

  if (!targets.length) {
    console.log("FAIL: ไม่มีเครื่องให้ส่ง");
    process.exit(2);
  }

  for (const d of targets) {
    await db.collection("posDevices").doc(d.id).set(
      {
        ownerPingAt: now,
        ownerPingMessage: MESSAGE,
        updatedAt: now,
        updatedBy: "owner-ping-script",
      },
      { merge: true },
    );
    console.log(`OK ping → ${d.id} code=${d.pairingCode || "-"}`);
  }
  console.log("\nDONE — เปิด TellTea POS (build 61+) บนแท็บเล็ต ควรเด้งป๊อป");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
