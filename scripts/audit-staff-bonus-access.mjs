/**
 * Audit staff access: permissions (shop read) + employee link (own bonus/pay filter).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/audit-staff-bonus-access.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/audit-staff-bonus-access.mjs
 *
 * Optional:
 *   APPLY=1  — sync staff.employeeId + employees.linkedStaffId when safe auto-match exists
 *   OUT_DIR=artifacts  — also write audit-staff-bonus-access.txt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const APPLY = process.env.APPLY === "1";

const PERMISSION_KEYS = [
  "ledger",
  "stock",
  "production",
  "otBonus",
  "checklist",
  "assignTasks",
  "bonus",
  "ownerBooks",
  "pnl",
  "transferIn",
  "exportData",
  "staffManage",
  "payrollPay",
  "membersView",
  "membersManage",
  "membersAdjustPoints",
];

const EMPTY_PERMS = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));
const DEFAULT_STAFF_PERMS = {
  ...EMPTY_PERMS,
  production: true,
  otBonus: true,
  checklist: true,
  bonus: true,
};
const OWNER_PERMS = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));

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
  if (!token) throw new Error("no access token — set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS");
  return token;
}

function parseField(f) {
  if (f == null) return null;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("booleanValue" in f) return f.booleanValue;
  if ("timestampValue" in f) return Date.parse(f.timestampValue);
  if ("mapValue" in f) return f.mapValue?.fields || {};
  if ("arrayValue" in f) return (f.arrayValue?.values || []).map(parseField);
  return null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  let national = digits;
  if (digits.startsWith("66")) national = digits;
  else if (digits.startsWith("0")) national = `66${digits.slice(1)}`;
  else if (digits.length === 9) national = `66${digits}`;
  else return "";
  if (national.length < 10 || national.length > 12) return "";
  return `+${national}`;
}

function materializePermissions(input) {
  const out = { ...EMPTY_PERMS };
  if (!input || typeof input !== "object") return out;
  for (const key of PERMISSION_KEYS) {
    const raw = input[key];
    if (raw && typeof raw === "object" && "booleanValue" in raw) {
      out[key] = raw.booleanValue === true;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return out;
}

/** Mirror resolveEffectivePermissions (permissions.ts) */
function resolveEffectivePermissions(member, levels) {
  if (!member) return { ...EMPTY_PERMS };
  if (member.role === "owner") return { ...OWNER_PERMS };

  const levelId = (member.permissionLevelId || "").trim();
  const customized = member.permissionsCustomized === true;

  if (!customized && levelId && levels?.length) {
    const level = levels.find((l) => l.id === levelId);
    if (level && level.active !== false) {
      return materializePermissions(level.permissions);
    }
  }

  if (member.permissions && typeof member.permissions === "object") {
    return materializePermissions(member.permissions);
  }

  if (!customized && levelId && levels?.length) {
    return { ...EMPTY_PERMS };
  }

  return { ...DEFAULT_STAFF_PERMS };
}

function isLinkedToStaff(emp, staff) {
  if (emp.linkedStaffId) return emp.linkedStaffId === staff.id;
  if (staff.email && emp.linkedEmail) {
    return normalizeEmail(emp.linkedEmail) === normalizeEmail(staff.email);
  }
  if (staff.phone && emp.linkedPhone) {
    try {
      return normalizePhone(emp.linkedPhone) === normalizePhone(staff.phone);
    } catch {
      return false;
    }
  }
  return false;
}

/** Mirror resolveLinkedEmployee — returns { emp, via } */
function resolveLinkedEmployee(employees, staff) {
  if (!staff || !employees.length) return { emp: null, via: "" };
  const byLink = employees.find((e) => isLinkedToStaff(e, staff));
  if (byLink) {
    if (byLink.linkedStaffId === staff.id) return { emp: byLink, via: "linkedStaffId" };
    if (staff.email && byLink.linkedEmail) return { emp: byLink, via: "linkedEmail" };
    return { emp: byLink, via: "linkedPhone" };
  }
  if (staff.employeeId) {
    const byId = employees.find((e) => e.id === staff.employeeId);
    if (byId) return { emp: byId, via: "employeeId" };
  }
  const name = (staff.displayName || "").trim().toLowerCase();
  if (!name) return { emp: null, via: "" };
  const byName = employees.find((e) => {
    if (e.active === false) return false;
    if (e.name.trim().toLowerCase() === name) return true;
    const nick = (e.nickname || "").trim().toLowerCase();
    return !!nick && nick === name;
  });
  if (byName) return { emp: byName, via: "displayName" };
  return { emp: null, via: "" };
}

function bangkokMonthRangeMs(now = Date.now()) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const [y, m] = key.split("-").map(Number);
  const startKey = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endKey = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return {
    month: `${y}-${String(m).padStart(2, "0")}`,
    since: Date.parse(`${startKey}T00:00:00+07:00`),
    until: Date.parse(`${endKey}T00:00:00+07:00`),
  };
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
      rows.push({ id, fields: doc.fields || {}, name: doc.name });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function patchDoc(token, collectionId, docId, fields) {
  const name = `projects/${PROJECT}/databases/(default)/documents/${collectionId}/${docId}`;
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const body = {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => {
        if (typeof v === "string") return [k, { stringValue: v }];
        if (typeof v === "boolean") return [k, { booleanValue: v }];
        if (typeof v === "number") return [k, { integerValue: String(Math.trunc(v)) }];
        return [k, { stringValue: String(v) }];
      }),
    ),
  };
  const res = await fetch(`${name}?${mask}`, {
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

function yn(v) {
  return v ? "ใช่" : "ไม่";
}

function pad(s, n) {
  const t = String(s ?? "");
  if (t.length >= n) return t.slice(0, n);
  return t + " ".repeat(n - t.length);
}

async function main() {
  const now = Date.now();
  const { month, since, until } = bangkokMonthRangeMs(now);
  const token = await getToken();

  const [staffDocs, empDocs, levelDocs, otDocs, payrollDocs] = await Promise.all([
    listCollection(token, "staff"),
    listCollection(token, "employees"),
    listCollection(token, "permissionLevels"),
    listCollection(token, "otEntries"),
    listCollection(token, "payrollItems"),
  ]);

  const levels = levelDocs.map((d) => {
    const f = d.fields;
    return {
      id: d.id,
      active: parseField(f.active) !== false,
      permissions: parseField(f.permissions) || {},
      name: String(parseField(f.name) || d.id),
    };
  });

  const employees = empDocs.map((d) => {
    const f = d.fields;
    return {
      id: d.id,
      name: String(parseField(f.name) || ""),
      nickname: parseField(f.nickname) ? String(parseField(f.nickname)) : "",
      active: parseField(f.active) !== false,
      linkedStaffId: parseField(f.linkedStaffId) ? String(parseField(f.linkedStaffId)) : "",
      linkedEmail: parseField(f.linkedEmail) ? String(parseField(f.linkedEmail)) : "",
      linkedPhone: parseField(f.linkedPhone) ? String(parseField(f.linkedPhone)) : "",
    };
  });

  const otMonth = otDocs
    .map((d) => {
      const f = d.fields;
      const date = Number(parseField(f.date) || 0);
      const workerIds = Array.isArray(parseField(f.workerIds))
        ? parseField(f.workerIds).map(String)
        : [];
      const workerNames = Array.isArray(parseField(f.workerNames))
        ? parseField(f.workerNames).map(String)
        : [];
      return { id: d.id, date, workerIds, workerNames };
    })
    .filter((r) => r.date >= since && r.date < until);

  const payrollMonth = payrollDocs
    .map((d) => {
      const f = d.fields;
      const employeeId = String(parseField(f.employeeId) || "");
      const dueDate = Number(parseField(f.dueDate) || 0);
      const status = String(parseField(f.status) || "");
      return { id: d.id, employeeId, dueDate, status };
    })
    .filter((r) => r.dueDate >= since - 40 * 86400000); // ~13 months lookback light: keep recent

  const staffMembers = staffDocs.map((d) => {
    const f = d.fields;
    return {
      id: d.id,
      role: String(parseField(f.role) || "staff"),
      displayName: parseField(f.displayName) ? String(parseField(f.displayName)) : "",
      email: parseField(f.email) ? String(parseField(f.email)) : "",
      phone: parseField(f.phone) ? String(parseField(f.phone)) : "",
      employeeId: parseField(f.employeeId) ? String(parseField(f.employeeId)) : "",
      permissionLevelId: parseField(f.permissionLevelId)
        ? String(parseField(f.permissionLevelId))
        : "",
      permissionsCustomized: parseField(f.permissionsCustomized) === true,
      permissions: parseField(f.permissions) || null,
      lastSeenAt: Number(parseField(f.lastSeenAt) || 0),
    };
  });

  const rows = [];
  const applied = [];

  for (const staff of staffMembers) {
    const perms = resolveEffectivePermissions(staff, levels);
    const { emp, via } = resolveLinkedEmployee(employees, staff);

    let linkStatus = "ไม่ผูก";
    if (staff.role === "owner") {
      linkStatus = "N/A เจ้าของ";
    } else if (emp) {
      if (via === "employeeId" && !emp.linkedStaffId && !emp.linkedEmail && !emp.linkedPhone) {
        linkStatus = "employeeId อย่างเดียว";
      } else if (staff.employeeId && emp.id !== staff.employeeId && via !== "employeeId") {
        linkStatus = `OK (${via}) · employeeId ค้าง`;
      } else {
        linkStatus = `OK (${via})`;
      }
    }

    const canOt = staff.role === "owner" || perms.otBonus === true;
    const canProd = staff.role === "owner" || perms.production === true;
    const canBonus = staff.role === "owner" || perms.bonus === true;
    const linked = !!emp;
    const isOwner = staff.role === "owner";

    const seeOt = canOt;
    // เจ้าของเห็นทั้งร้าน · พนักงานต้องมีสิทธิ์ bonus + ผูกชื่อ
    const seeBonusSelf = isOwner ? true : canBonus && linked;
    const seePayrollSelf = isOwner ? true : linked;

    const otHits = emp
      ? otMonth.filter(
          (r) =>
            r.workerIds.includes(emp.id) ||
            r.workerNames.some(
              (n) =>
                n.trim().toLowerCase() === emp.name.trim().toLowerCase() ||
                (emp.nickname &&
                  n.trim().toLowerCase() === emp.nickname.trim().toLowerCase()),
            ),
        ).length
      : 0;
    const payHits = emp
      ? payrollMonth.filter((r) => r.employeeId === emp.id).length
      : 0;

    const fixes = [];
    if (staff.role !== "owner") {
      if (!canOt) fixes.push("เปิดสิทธิ์ otBonus");
      if (!canProd) fixes.push("เปิดสิทธิ์ production");
      if (!canBonus) fixes.push("เปิดสิทธิ์ bonus");
      if (!linked) fixes.push("ผูกบัญชีกับรายชื่อร้าน");
      else if (staff.employeeId !== emp.id) fixes.push(`sync employeeId→${emp.id}`);
      else if (!emp.linkedStaffId) fixes.push(`ตั้ง linkedStaffId→${staff.id}`);
    }

    // Safe APPLY: sync employeeId + linkedStaffId when resolve found a unique link
    if (APPLY && staff.role !== "owner" && emp) {
      if (staff.employeeId !== emp.id) {
        await patchDoc(token, "staff", staff.id, {
          employeeId: emp.id,
          displayName: emp.name || staff.displayName,
          updatedAt: now,
        });
        applied.push(`staff/${staff.id} employeeId=${emp.id}`);
        staff.employeeId = emp.id;
      }
      if (!emp.linkedStaffId) {
        const conflict = employees.find(
          (e) => e.linkedStaffId === staff.id && e.id !== emp.id,
        );
        if (!conflict) {
          await patchDoc(token, "employees", emp.id, {
            linkedStaffId: staff.id,
            updatedAt: now,
          });
          applied.push(`employees/${emp.id} linkedStaffId=${staff.id}`);
          emp.linkedStaffId = staff.id;
          linkStatus = "OK (linkedStaffId)";
          fixes.length = 0;
          if (!canOt) fixes.push("เปิดสิทธิ์ otBonus");
          if (!canProd) fixes.push("เปิดสิทธิ์ production");
          if (!canBonus) fixes.push("เปิดสิทธิ์ bonus");
        }
      }
    }

    const account = staff.email || staff.phone || staff.id;
    const label = (emp?.nickname || emp?.name || staff.displayName || account).trim();

    rows.push({
      id: staff.id,
      role: staff.role,
      label,
      account,
      level: staff.permissionLevelId || (staff.role === "owner" ? "owner" : "—"),
      canOt,
      canProd,
      canBonus,
      linkStatus,
      empId: emp?.id || "",
      empName: emp ? `${emp.name}${emp.nickname ? ` (${emp.nickname})` : ""}` : "—",
      seeOt,
      seeBonusSelf,
      seePayrollSelf,
      otHits,
      payHits,
      fix: fixes.join(" · ") || "—",
      red: fixes.length > 0,
    });
  }

  rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    if (a.red !== b.red) return a.red ? -1 : 1;
    return a.label.localeCompare(b.label, "th");
  });

  const lines = [];
  lines.push(`staff bonus/access audit · month ${month} · APPLY=${APPLY ? "1" : "0"}`);
  lines.push(
    `staff=${staffMembers.length} · employees=${employees.length} · levels=${levels.length} · otMonth=${otMonth.length} · payrollRecent=${payrollMonth.length}`,
  );
  lines.push("");
  lines.push(
    pad("สถานะ", 6) +
      pad("ชื่อ", 14) +
      pad("ชง", 4) +
      pad("ผลิต", 5) +
      pad("โบนัส", 5) +
      pad("ผูก roster", 22) +
      pad("เห็นชง", 6) +
      pad("เห็นโบนัส", 8) +
      pad("เห็นจ่าย", 8) +
      pad("OTด.นี้", 7) +
      pad("คิว", 5) +
      "ต้องแก้",
  );
  lines.push("-".repeat(120));

  for (const r of rows) {
    lines.push(
      pad(r.red ? "แดง" : "OK", 6) +
        pad(r.label, 14) +
        pad(yn(r.canOt), 4) +
        pad(yn(r.canProd), 5) +
        pad(yn(r.canBonus), 5) +
        pad(r.linkStatus, 22) +
        pad(yn(r.seeOt), 6) +
        pad(yn(r.seeBonusSelf), 8) +
        pad(yn(r.seePayrollSelf), 8) +
        pad(String(r.otHits), 7) +
        pad(String(r.payHits), 5) +
        r.fix,
    );
  }

  const red = rows.filter((r) => r.red);
  lines.push("");
  lines.push(`=== สรุปแดง ${red.length}/${rows.filter((r) => r.role !== "owner").length} พนักงาน ===`);
  if (!red.length) {
    lines.push("ไม่มีคนแดง — สิทธิ์ + ผูกชื่อครบ");
  } else {
    for (const r of red) {
      lines.push(
        `- ${r.label} · ${r.account} · roster=${r.empName} · ${r.fix}`,
      );
    }
  }

  if (applied.length) {
    lines.push("");
    lines.push(`=== APPLY patched ${applied.length} ===`);
    for (const a of applied) lines.push(`  ${a}`);
  }

  lines.push("");
  lines.push("=== รายละเอียด ===");
  for (const r of rows) {
    lines.push(
      `${r.role === "owner" ? "OWNER" : r.red ? "RED" : "OK"} ${r.label} id=${r.id} level=${r.level} emp=${r.empId || "—"} account=${r.account}`,
    );
  }

  const text = lines.join("\n");
  console.log(text);

  if (process.env.OUT_DIR) {
    mkdirSync(process.env.OUT_DIR, { recursive: true });
    const out = join(process.env.OUT_DIR, "audit-staff-bonus-access.txt");
    writeFileSync(out, text + "\n", "utf8");
    console.log(`\nWrote ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
