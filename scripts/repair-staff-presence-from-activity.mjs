/**
 * Backfill staff.lastSeenAt from recent work writes (stock / prod / ot)
 * when activity is newer than the stored presence timestamp.
 *
 * Usage: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/repair-staff-presence-from-activity.mjs
 * CI: commit message contains [repair-staff-presence]
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token");
  return token;
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("timestampValue" in f) return Date.parse(f.timestampValue);
  return null;
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
      rows.push({ id: doc.name.split("/").pop(), fields: doc.fields || {} });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function patchLastSeen(token, staffId, lastSeenAt) {
  const path = `projects/${PROJECT}/databases/(default)/documents/staff/${encodeURIComponent(staffId)}`;
  const url = `https://firestore.googleapis.com/v1/${path}?updateMask.fieldPaths=lastSeenAt`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: { lastSeenAt: { integerValue: String(Math.round(lastSeenAt)) } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${staffId}: ${JSON.stringify(data)}`);
}

function isStaffDocId(id) {
  const s = String(id || "").trim();
  if (!s || s.startsWith("+")) return false;
  return s.includes("@") || s.startsWith("p_");
}

function bump(map, staffId, at) {
  if (!isStaffDocId(staffId) || !at) return;
  const prev = map.get(staffId) || 0;
  if (at > prev) map.set(staffId, at);
}

async function main() {
  const now = Date.now();
  const since = now - LOOKBACK_MS;
  const token = await getToken();
  const [staffDocs, stockDocs, prodDocs, otDocs] = await Promise.all([
    listCollection(token, "staff"),
    listCollection(token, "stockCountSessions"),
    listCollection(token, "prodEntries"),
    listCollection(token, "otEntries"),
  ]);

  const activity = new Map();
  for (const d of stockDocs) {
    const f = d.fields;
    // สต็อก: ใช้เวลาบันทึกรอบ — updatedAt (แก้รอบ) หรือ submittedAt (สร้าง)
    const at = Math.max(
      Number(parseField(f.updatedAt) || 0),
      Number(parseField(f.submittedAt) || 0),
    );
    if (at < since) continue;
    bump(activity, parseField(f.updatedBy) || parseField(f.createdBy), at);
  }
  for (const d of [...prodDocs, ...otDocs]) {
    const f = d.fields;
    // ห้ามใช้ updatedAt — สคริปต์ซ่อมเรท/แบตช์มักเขียน updatedAt พร้อมกันหลายแถว
    // ทำให้หลายคนได้ lastSeen เดียวกันทั้งที่ไม่ได้ล็อกอิน
    const at = Number(parseField(f.createdAt) || 0);
    if (at < since) continue;
    bump(activity, parseField(f.createdBy), at);
  }

  const current = new Map();
  for (const d of staffDocs) {
    current.set(d.id, Number(parseField(d.fields.lastSeenAt) || 0));
  }

  const repairs = [];
  for (const [staffId, at] of activity) {
    const prev = current.get(staffId) || 0;
    if (at > prev) repairs.push({ staffId, at, prev });
  }
  repairs.sort((a, b) => b.at - a.at);

  console.log(`activity actors (7d): ${activity.size}`);
  console.log(`repairs needed: ${repairs.length}`);
  for (const r of repairs) {
    const ageH = ((now - r.at) / 3600000).toFixed(1);
    console.log(
      `repair ${r.staffId} lastSeen ${new Date(r.prev).toISOString()} → ${new Date(r.at).toISOString()} (${ageH}h ago)`,
    );
    await patchLastSeen(token, r.staffId, r.at);
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
