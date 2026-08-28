/**
 * ตั้ง Firebase Auth email/password ให้พนักงาน — รหัสผ่าน = เบอร์โทร 10 หลัก
 *
 * Usage:
 *   node scripts/batch-set-staff-email-password.mjs
 *   DRY_RUN=1 node scripts/batch-set-staff-email-password.mjs
 *   STAFF_ID=email@... node scripts/batch-set-staff-email-password.mjs
 */
import { createRequire } from "node:module";
import { GoogleAuth } from "google-auth-library";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const PROJECT = "mypeer-501909";
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_STAFF_ID = (process.env.STAFF_ID || "").trim();

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function initAdmin() {
  if (admin.apps.length) return;
  const cred = loadCredentials();
  if (!cred) {
    throw new Error("set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS");
  }
  admin.initializeApp({
    credential: admin.credential.cert(cred),
    projectId: PROJECT,
  });
}

function passwordFromPhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  else if (!digits.startsWith("0") && digits.length === 9) digits = `0${digits}`;
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function listStaffWithPhones() {
  const db = admin.firestore();
  const [staffSnap, empSnap] = await Promise.all([
    db.collection("staff").get(),
    db.collection("employees").get(),
  ]);
  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rows = [];
  for (const doc of staffSnap.docs) {
    if (doc.get("role") === "owner") continue;
    if (doc.get("migratedTo")) continue;
    const staffId = doc.id;
    if (ONLY_STAFF_ID && staffId !== ONLY_STAFF_ID) continue;
    const email = normalizeEmail(doc.get("email") || (staffId.includes("@") ? staffId : ""));
    const phone =
      String(doc.get("phone") || "").trim() ||
      employees.find((e) => e.linkedStaffId === staffId)?.linkedPhone ||
      "";
    const password = passwordFromPhone(phone);
    rows.push({
      staffId,
      email,
      phone,
      password,
      displayName: String(doc.get("displayName") || "").trim(),
    });
  }
  return rows;
}

async function ensureAuthUser(row) {
  const auth = admin.auth();
  const { email, password, staffId, displayName } = row;
  if (!email || !password) return { status: "skip", reason: "no email/phone" };

  let user;
  try {
    user = await auth.getUserByEmail(email);
    if (!DRY_RUN) {
      await auth.updateUser(user.uid, {
        password,
        emailVerified: true,
        displayName: displayName || user.displayName || undefined,
        disabled: false,
      });
    }
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
    if (DRY_RUN) return { status: "dry-create", email, password };
    user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: displayName || undefined,
      disabled: false,
    });
  }

  if (!DRY_RUN && user?.uid) {
    const prev = (await auth.getUser(user.uid)).customClaims || {};
    if (prev.staffId !== staffId) {
      await auth.setCustomUserClaims(user.uid, { ...prev, staffId });
    }
    const db = admin.firestore();
    await db.collection("staffEmails").doc(email).set({ staffId }, { merge: true });
  }

  return { status: DRY_RUN ? "dry" : "ok", email, uid: user?.uid };
}

async function main() {
  initAdmin();
  const rows = await listStaffWithPhones();
  console.log(`batch staff email/password · DRY_RUN=${DRY_RUN ? "1" : "0"} · count=${rows.length}`);
  for (const row of rows) {
    const label = row.displayName || row.email || row.staffId;
    if (!row.email) {
      console.log(`SKIP  ${label} — ไม่มีอีเมล`);
      continue;
    }
    if (!row.password) {
      console.log(`SKIP  ${label} — ไม่มีเบอร์/PASS ไม่ valid (${row.phone || "—"})`);
      continue;
    }
    const res = await ensureAuthUser(row);
    console.log(
      `${res.status === "ok" || res.status === "dry" || res.status === "dry-create" ? "OK   " : "FAIL "} ${label} · ${row.email} · pass=${row.password}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
