/**
 * ตั้ง PIN เข้าระบบพนักงานจากเบอร์โทร (6 หลักท้าย local 0xxxxxxxxx)
 *
 * Usage:
 *   node scripts/batch-set-staff-pin-from-phone.mjs
 *   DRY_RUN=1 node scripts/batch-set-staff-pin-from-phone.mjs
 *   STAFF_ID=pmapmamashunter27@gmail.com node scripts/batch-set-staff-pin-from-phone.mjs
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS (same as audit script)
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { GoogleAuth } from "google-auth-library";

const require = createRequire(import.meta.url);
const { _hashPin, _nickKey } = require("../functions/staff-pin-login.js");

const PROJECT = "mypeer-501909";
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_STAFF_ID = (process.env.STAFF_ID || "").trim();

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

async function getToken() {
  const credentials = loadCredentials();
  const auth = new GoogleAuth({
    credentials,
    keyFilename: credentials
      ? undefined
      : process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_KEY,
    scopes: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error(
      "no access token — set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS",
    );
  }
  return token;
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("booleanValue" in f) return f.booleanValue;
  if ("mapValue" in f) return f.mapValue?.fields || {};
  return null;
}

function pinFromPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  } else if (!digits.startsWith("0") && digits.length === 9) {
    digits = `0${digits}`;
  }
  const pin = digits.slice(-6);
  return /^\d{4,6}$/.test(pin) ? pin : null;
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function collectLoginNames(staffId, staffFields, employees) {
  const names = [];
  const display = String(parseField(staffFields.displayName) || "").trim();
  if (display) names.push(display);
  const email = String(parseField(staffFields.email) || "")
    .trim()
    .toLowerCase();
  if (email.includes("@")) names.push(email.split("@")[0]);
  const empId = String(parseField(staffFields.employeeId) || "").trim();
  for (const emp of employees) {
    if (empId && emp.id === empId) {
      if (emp.nickname) names.push(emp.nickname);
      if (emp.name) names.push(emp.name);
    }
    if (emp.linkedStaffId === staffId) {
      if (emp.nickname) names.push(emp.nickname);
      if (emp.name) names.push(emp.name);
    }
  }
  return [...new Set(names.map((n) => _nickKey(n)).filter(Boolean))];
}

async function listCollection(token, collectionId) {
  const rows = [];
  let pageToken = "";
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}`,
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    for (const doc of data.documents || []) {
      const id = doc.name?.split("/").pop() || "";
      rows.push({ id, fields: doc.fields || {} });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function patchDoc(token, collectionId, docId, fields) {
  const name = `projects/${PROJECT}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}`;
  const url = `https://firestore.googleapis.com/v1/${name}`;
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => {
        if (typeof v === "string") return [k, { stringValue: v }];
        if (typeof v === "boolean") return [k, { booleanValue: v }];
        if (typeof v === "number") return [k, { integerValue: String(Math.trunc(v)) }];
        if (v === null) return [k, { nullValue: null }];
        return [k, { stringValue: String(v) }];
      }),
    ),
  };
  const res = await fetch(`${url}?${mask}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PATCH ${collectionId}/${docId}: ${JSON.stringify(data)}`);
  return data;
}

async function setDoc(token, collectionId, docId, fields) {
  const name = `projects/${PROJECT}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}`;
  const url = `https://firestore.googleapis.com/v1/${name}`;
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => {
        if (typeof v === "string") return [k, { stringValue: v }];
        if (typeof v === "number") return [k, { integerValue: String(Math.trunc(v)) }];
        return [k, { stringValue: String(v) }];
      }),
    ),
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`SET ${collectionId}/${docId}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const token = await getToken();
  const now = Date.now();
  const [staffDocs, empDocs] = await Promise.all([
    listCollection(token, "staff"),
    listCollection(token, "employees"),
  ]);

  const employees = empDocs.map((d) => ({
    id: d.id,
    name: String(parseField(d.fields.name) || ""),
    nickname: String(parseField(d.fields.nickname) || ""),
    linkedStaffId: String(parseField(d.fields.linkedStaffId) || ""),
    linkedPhone: String(parseField(d.fields.linkedPhone) || ""),
  }));

  const lines = [`batch staff PIN from phone · DRY_RUN=${DRY_RUN ? "1" : "0"}`, ""];

  for (const doc of staffDocs) {
    const staffId = doc.id;
    if (ONLY_STAFF_ID && staffId !== ONLY_STAFF_ID) continue;
    const role = String(parseField(doc.fields.role) || "");
    if (role === "owner") continue;
    if (parseField(doc.fields.migratedTo)) continue;

    const phone =
      String(parseField(doc.fields.phone) || "").trim() ||
      employees.find((e) => e.linkedStaffId === staffId)?.linkedPhone ||
      "";
    const pin = pinFromPhone(phone);
    const label =
      String(parseField(doc.fields.displayName) || "").trim() || staffId;

    if (!pin) {
      lines.push(`SKIP  ${label} (${staffId}) — ไม่มีเบอร์/PIN ไม่ valid`);
      continue;
    }

    const names = collectLoginNames(staffId, doc.fields, employees);
    if (DRY_RUN) {
      lines.push(`DRY   ${label} (${staffId}) pin=${pin} names=${names.join(",")}`);
      continue;
    }

    const salt = newSalt();
    const hash = _hashPin(pin, salt);
    await setDoc(token, "staffLoginSecrets", staffId, {
      salt,
      hash,
      algo: "scrypt",
      updatedAt: now,
    });
    await patchDoc(token, "staff", staffId, {
      loginPinSetAt: now,
      loginPinClearedAt: null,
    });
    for (const nick of names) {
      await setDoc(token, "staffNicknames", nick, {
        staffId,
        updatedAt: now,
      });
    }
    lines.push(`OK    ${label} (${staffId}) pin=${pin} names=${names.join(",")}`);
  }

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
