/**
 * Dump live staff lastSeenAt (BO presence / เข้าหลังสุด).
 * Usage: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/dump-staff-presence.mjs
 *
 * Writes artifacts/staff-presence-dump.txt when OUT_DIR is set (CI).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";

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
  if ("booleanValue" in f) return f.booleanValue;
  if ("timestampValue" in f) return Date.parse(f.timestampValue);
  return null;
}

function formatIct(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ms));
}

function formatAge(ms, now) {
  if (!ms) return "never";
  const sec = Math.max(0, Math.floor((now - ms) / 1000));
  if (sec < 60) return "เมื่อกี้";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}น`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}ช`;
  return `${Math.floor(hr / 24)}ว`;
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
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

async function main() {
  const now = Date.now();
  const token = await getToken();
  const [staffDocs, empDocs] = await Promise.all([
    listCollection(token, "staff"),
    listCollection(token, "employees"),
  ]);

  const empByStaffId = new Map();
  const empById = new Map();
  for (const e of empDocs) {
    const f = e.fields;
    const name = String(parseField(f.name) || "");
    const nickname = parseField(f.nickname) ? String(parseField(f.nickname)) : "";
    const linkedStaffId = parseField(f.linkedStaffId)
      ? String(parseField(f.linkedStaffId))
      : "";
    const row = { id: e.id, name, nickname, linkedStaffId };
    empById.set(e.id, row);
    if (linkedStaffId) empByStaffId.set(linkedStaffId, row);
  }

  const rows = staffDocs.map((d) => {
    const f = d.fields;
    const role = String(parseField(f.role) || "staff");
    const displayName = parseField(f.displayName)
      ? String(parseField(f.displayName))
      : "";
    const email = parseField(f.email) ? String(parseField(f.email)) : "";
    const phone = parseField(f.phone) ? String(parseField(f.phone)) : "";
    const employeeId = parseField(f.employeeId)
      ? String(parseField(f.employeeId))
      : "";
    const lastSeenAt = Number(parseField(f.lastSeenAt) || 0);
    const emp =
      (employeeId && empById.get(employeeId)) || empByStaffId.get(d.id) || null;
    const label =
      (emp?.nickname || emp?.name || displayName || email || phone || d.id).trim();
    return {
      id: d.id,
      role,
      label,
      email,
      phone,
      lastSeenAt,
      lastSeenIct: formatIct(lastSeenAt),
      age: formatAge(lastSeenAt, now),
    };
  });

  rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    if (a.lastSeenAt !== b.lastSeenAt) {
      if (!a.lastSeenAt) return 1;
      if (!b.lastSeenAt) return -1;
      return b.lastSeenAt - a.lastSeenAt;
    }
    return a.label.localeCompare(b.label, "th");
  });

  const lines = [];
  lines.push(`staff presence dump · now ICT ${formatIct(now)}`);
  lines.push(`staff docs: ${staffDocs.length} · employees: ${empDocs.length}`);
  lines.push("");
  lines.push(
    "role".padEnd(7) +
      "age".padEnd(8) +
      "lastSeen ICT".padEnd(28) +
      "label".padEnd(18) +
      "id",
  );
  lines.push("-".repeat(90));
  for (const r of rows) {
    lines.push(
      r.role.padEnd(7) +
        r.age.padEnd(8) +
        r.lastSeenIct.padEnd(28) +
        r.label.slice(0, 16).padEnd(18) +
        r.id,
    );
  }

  const withSeen = rows.filter((r) => r.role === "staff" && r.lastSeenAt > 0);
  const never = rows.filter((r) => r.role === "staff" && !r.lastSeenAt);
  const afterFix = rows.filter(
    (r) => r.role === "staff" && r.lastSeenAt >= Date.parse("2026-08-03T07:29:00.000Z"),
  );
  lines.push("");
  lines.push(`staff with lastSeenAt: ${withSeen.length}`);
  lines.push(`staff never seen: ${never.length}`);
  lines.push(
    `staff lastSeenAt after presence fix deploy (~07:29Z / 14:29 ICT): ${afterFix.length}`,
  );
  if (withSeen[0]) {
    lines.push(
      `most recent staff login: ${withSeen[0].label} · ${withSeen[0].lastSeenIct} (${withSeen[0].age})`,
    );
  }


  // Recent stock count rounds — who wrote stock while presence may be stale
  try {
    const stockDocs = await listCollection(token, "stockCountSessions");
    const stockRows = stockDocs
      .map((d) => {
        const f = d.fields;
        const submittedAt = Number(parseField(f.submittedAt) || 0);
        const updatedAt = Number(parseField(f.updatedAt) || 0);
        const createdAt = Number(parseField(f.createdAt) || 0);
        const sortAt = Math.max(submittedAt, updatedAt, createdAt);
        return {
          id: d.id,
          inspector: String(parseField(f.inspector) || ""),
          inspectorId: parseField(f.inspectorId) ? String(parseField(f.inspectorId)) : "",
          createdBy: String(parseField(f.createdBy) || ""),
          updatedBy: parseField(f.updatedBy) ? String(parseField(f.updatedBy)) : "",
          dayOfMonth: Number(parseField(f.dayOfMonth) || 0),
          year: Number(parseField(f.year) || 0),
          month: Number(parseField(f.month) || 0),
          submittedAt,
          updatedAt,
          createdAt,
          sortAt,
          when: formatIct(sortAt),
          age: formatAge(sortAt, now),
        };
      })
      .filter((r) => r.sortAt > now - 3 * 24 * 60 * 60 * 1000)
      .sort((a, b) => b.sortAt - a.sortAt);
    lines.push("");
    lines.push(`=== stockCountSessions last 3d (${stockRows.length}) ===`);
    for (const r of stockRows.slice(0, 30)) {
      lines.push(
        `${r.age.padEnd(6)} ${r.when.padEnd(26)} inspector=${r.inspector || "—"} createdBy=${r.createdBy || "—"} updatedBy=${r.updatedBy || "—"} id=${r.id}`,
      );
    }
    globalThis.__stockRows = stockRows;
  } catch (err) {
    lines.push("");
    lines.push(`stockCountSessions dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }


  const text = lines.join("\n");
  console.log(text);

  const outDir = process.env.OUT_DIR || "";
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "staff-presence-dump.txt"), `${text}\n`, "utf8");
    writeFileSync(
      join(outDir, "staff-presence-dump.json"),
      `${JSON.stringify({ now, rows, stockRows: globalThis.__stockRows || [] }, null, 2)}\n`,
      "utf8",
    );
    console.log(`\nwrote ${outDir}/staff-presence-dump.{txt,json}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
