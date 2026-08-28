/**
 * สร้าง/ซ่อม permissionLevels/full_access (สิทธิเต็ม = OWNER) แล้วผูกพนักงานทุกคน
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/assign-staff-full-access.mjs
 *   APPLY=1 FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/assign-staff-full-access.mjs
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const APPLY = process.env.APPLY === "1";
const LEVEL_ID = "full_access";

const OWNER_PERMISSIONS = {
  ledger: true,
  stock: true,
  production: true,
  otBonus: true,
  checklist: true,
  assignTasks: false,
  bonus: true,
  ownerBooks: true,
  pnl: true,
  transferIn: true,
  exportData: true,
  staffManage: true,
  payrollPay: true,
  membersView: true,
  membersManage: true,
  membersAdjustPoints: true,
};

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

async function getToken() {
  const credentials = loadCredentials();
  const auth = new GoogleAuth({
    credentials,
    keyFilename: credentials
      ? undefined
      : process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_KEY,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token");
  return token;
}

function fieldsFromObject(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (typeof v === "number") fields[k] = { integerValue: String(v) };
    else if (typeof v === "string") fields[k] = { stringValue: v };
  }
  return fields;
}

function permFields(perms) {
  const inner = {};
  for (const [k, v] of Object.entries(perms)) {
    inner[k] = { booleanValue: v === true };
  }
  return { mapValue: { fields: inner } };
}

async function patchDoc(token, path, fields, updateMask) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}?${updateMask.map((f) => `updateMask.fieldPaths=${f}`).join("&")}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function setDoc(token, path, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function listStaff(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/staff?pageSize=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.documents || [];
}

async function main() {
  const token = await getToken();
  const now = Date.now();

  console.log(`${APPLY ? "APPLY" : "DRY"} · ensure permissionLevels/${LEVEL_ID}`);
  const levelFields = {
    name: { stringValue: "สิทธิเต็ม (เท่าเจ้าของ)" },
    sortOrder: { integerValue: "90" },
    active: { booleanValue: true },
    isSystem: { booleanValue: true },
    permissions: permFields(OWNER_PERMISSIONS),
    updatedAt: { integerValue: String(now) },
    createdAt: { integerValue: String(now) },
  };
  if (APPLY) {
    await setDoc(token, `permissionLevels/${LEVEL_ID}`, levelFields);
  }

  const staffDocs = await listStaff(token);
  const targets = staffDocs.filter((d) => {
    const role = d.fields?.role?.stringValue;
    return role !== "owner";
  });

  console.log(`staff to assign: ${targets.length}`);
  for (const doc of targets) {
    const id = doc.name.split("/").pop();
    const name = doc.fields?.displayName?.stringValue || id;
    const prev = doc.fields?.permissionLevelId?.stringValue || "—";
    console.log(`  ${name} (${id}) ${prev} → ${LEVEL_ID}`);
    if (!APPLY) continue;
    await patchDoc(
      token,
      `staff/${encodeURIComponent(id)}`,
      {
        permissionLevelId: { stringValue: LEVEL_ID },
        permissionsCustomized: { booleanValue: false },
        permissions: permFields(OWNER_PERMISSIONS),
        updatedAt: { integerValue: String(now) },
      },
      ["permissionLevelId", "permissionsCustomized", "permissions", "updatedAt"],
    );
  }

  console.log(APPLY ? "OK applied" : "DRY RUN — set APPLY=1 to write");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
