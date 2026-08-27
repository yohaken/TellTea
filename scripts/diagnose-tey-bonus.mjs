/**
 * Diagnose เตย bonus mismatch: staff identity, phone index, entry matching.
 * Usage: node scripts/diagnose-tey-bonus.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "mypeer-501909";
const TEY_EMP_ID = "985f6edfe50908710befc2d78cdb2b50";
const TEY_EMAIL = "nawarat.srikaeban@gmail.com";

async function getToken() {
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
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
  if ("arrayValue" in f) return (f.arrayValue?.values || []).map(parseField);
  if ("mapValue" in f) return f.mapValue?.fields || {};
  return null;
}

function docData(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = parseField(v);
  return out;
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
      rows.push({ id: doc.name?.split("/").pop() || "", data: docData(doc) });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("66")) return `+${digits}`;
  if (digits.startsWith("0")) return `+66${digits.slice(1)}`;
  if (digits.length === 9) return `+66${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function phoneDigitsFromE164(phone) {
  return String(phone || "").replace(/\D/g, "");
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

function namesMatch(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function entryCreditsTey(entry, tey, staffIds) {
  const reasons = [];
  const ids = entry.workerIds || [];
  const names = entry.workerNames || [];
  const createdBy = String(entry.createdBy || "").trim();

  if (ids.includes(TEY_EMP_ID)) reasons.push("workerIds");
  for (const sid of staffIds) {
    if (createdBy && createdBy === sid) reasons.push(`createdBy:${sid}`);
  }
  for (const n of names) {
    if (namesMatch(n, tey.name)) reasons.push(`name:${n}`);
    if (tey.nickname && namesMatch(n, tey.nickname)) reasons.push(`nick:${n}`);
  }
  for (const id of ids) {
    if (id !== TEY_EMP_ID) reasons.push(`otherId:${id}`);
  }
  return { match: reasons.some((r) => !r.startsWith("otherId:")), reasons };
}

async function main() {
  const token = await getToken();
  const { month, since, until } = bangkokMonthRangeMs();

  const [staff, staffPhones, staffEmails, employees, otAll, prodAll] = await Promise.all([
    listCollection(token, "staff"),
    listCollection(token, "staffPhones"),
    listCollection(token, "staffEmails"),
    listCollection(token, "employees"),
    listCollection(token, "otEntries"),
    listCollection(token, "prodEntries"),
  ]);

  const tey = employees.find((e) => e.id === TEY_EMP_ID)?.data;
  if (!tey) throw new Error("employee เตย not found");

  const lines = [];
  lines.push(`=== diagnose เตย bonus · month ${month} ===`);
  lines.push(`employee: ${tey.name} (${tey.nickname || "—"}) id=${TEY_EMP_ID}`);
  lines.push(`linkedStaffId: ${tey.linkedStaffId || "—"}`);
  lines.push(`linkedEmail: ${tey.linkedEmail || "—"}`);
  lines.push(`linkedPhone: ${tey.linkedPhone || "—"}`);
  lines.push("");

  // Staff docs related to เตย
  lines.push("--- staff docs ---");
  const relatedStaff = staff.filter((s) => {
    const d = s.data;
    const blob = JSON.stringify(d).toLowerCase();
    return (
      s.id.includes("nawarat") ||
      s.id.includes("141880") ||
      d.email === TEY_EMAIL ||
      d.linkedStaffId === TEY_EMP_ID ||
      d.employeeId === TEY_EMP_ID ||
      blob.includes("141880") ||
      blob.includes("nawarat") ||
      blob.includes("เตย") ||
      d.displayName?.includes("เตย")
    );
  });
  if (!relatedStaff.length) {
    lines.push("(no staff doc matched search — listing all staff ids)");
    for (const s of staff) {
      lines.push(
        `  ${s.id} | email=${s.data.email || "—"} phone=${s.data.phone || "—"} emp=${s.data.employeeId || "—"} name=${s.data.displayName || "—"}`,
      );
    }
  } else {
    for (const s of relatedStaff) {
      const d = s.data;
      lines.push(`id=${s.id}`);
      lines.push(`  email=${d.email || "—"} phone=${d.phone || "—"}`);
      lines.push(`  displayName=${d.displayName || "—"} employeeId=${d.employeeId || "—"}`);
      lines.push(`  permissionLevelId=${d.permissionLevelId || "—"} role=${d.role || "—"}`);
      lines.push(`  linked? employee.linkedStaffId=${tey.linkedStaffId} vs staff.id=${s.id} → ${tey.linkedStaffId === s.id ? "MATCH" : "NO"}`);
    }
  }
  lines.push("");

  // Phone indexes
  lines.push("--- staffPhones index ---");
  const phoneHits = staffPhones.filter(
    (p) =>
      p.id.includes("141880") ||
      p.id.includes("4188") ||
      String(p.data.staffId || "").includes("nawarat") ||
      String(p.data.staffId || "").includes("141880"),
  );
  if (!phoneHits.length) lines.push("(no 141880 in staffPhones — dump all):");
  for (const p of phoneHits.length ? phoneHits : staffPhones) {
    lines.push(`  phoneKey=${p.id} → staffId=${p.data.staffId || "—"}`);
  }
  lines.push("");

  lines.push("--- staffEmails index ---");
  const emailHit = staffEmails.find((e) => e.id.includes("nawarat") || e.data.staffId?.includes("nawarat"));
  if (emailHit) lines.push(`  emailKey=${emailHit.id} → staffId=${emailHit.data.staffId}`);
  else lines.push("  (no nawarat email index found)");
  lines.push("");

  const staffIds = new Set(relatedStaff.map((s) => s.id));
  if (tey.linkedStaffId) staffIds.add(tey.linkedStaffId);

  const otMonth = otAll
    .map((d) => ({ id: d.id, ...d.data }))
    .filter((r) => r.date >= since && r.date < until);
  const prodMonth = prodAll
    .map((d) => ({ id: d.id, ...d.data }))
    .filter((r) => r.date >= since && r.date < until);

  let otOwner = 0;
  let otStaffFilter = 0;
  let otCreatedByOnly = 0;
  const otMiss = [];

  for (const row of otMonth) {
    const c = entryCreditsTey(row, tey, staffIds);
    const bonus = Number(row.totalBonus || 0);
    const workers = (row.workerIds || []).length || (row.workerNames || []).length || 1;
    const perPerson = bonus / workers;

    if ((row.workerIds || []).includes(TEY_EMP_ID) ||
        (row.workerNames || []).some((n) => namesMatch(n, tey.name) || (tey.nickname && namesMatch(n, tey.nickname)))) {
      otOwner += perPerson;
    }
    if (c.match) otStaffFilter += perPerson;
    if ([...staffIds].some((sid) => row.createdBy === sid)) otCreatedByOnly += perPerson;
    if (!c.match && (row.workerIds || []).includes(TEY_EMP_ID)) otMiss.push({ id: row.id, reasons: c.reasons, names: row.workerNames, ids: row.workerIds, createdBy: row.createdBy });
  }

  let prodOwner = 0;
  let prodStaffFilter = 0;
  let prodCreatedByOnly = 0;
  const prodMiss = [];

  for (const row of prodMonth) {
    const c = entryCreditsTey(row, tey, staffIds);
    const bonus = Number(row.totalBonus || 0);
    const workers = (row.workerIds || []).length || (row.workerNames || []).length || 1;
    const perPerson = bonus / workers;

    if ((row.workerIds || []).includes(TEY_EMP_ID) ||
        (row.workerNames || []).some((n) => namesMatch(n, tey.name) || (tey.nickname && namesMatch(n, tey.nickname)))) {
      prodOwner += perPerson;
    }
    if (c.match) prodStaffFilter += perPerson;
    if ([...staffIds].some((sid) => row.createdBy === sid)) prodCreatedByOnly += perPerson;

    const ownerMatch = (row.workerIds || []).includes(TEY_EMP_ID) ||
      (row.workerNames || []).some((n) => namesMatch(n, tey.name) || (tey.nickname && namesMatch(n, tey.nickname)));
    if (ownerMatch && !c.match) {
      prodMiss.push({
        id: row.id,
        date: new Date(row.date).toISOString().slice(0, 10),
        reasons: c.reasons,
        names: row.workerNames,
        ids: row.workerIds,
        createdBy: row.createdBy,
        bonus: perPerson,
      });
    }
  }

  lines.push("--- entry counts Aug 2026 ---");
  lines.push(`OT total month: ${otMonth.length} | prod total: ${prodMonth.length}`);
  lines.push(`OT credited เตย (owner logic): ${otOwner.toFixed(2)}`);
  lines.push(`OT credited (staff filter incl createdBy): ${otStaffFilter.toFixed(2)}`);
  lines.push(`OT credited (createdBy staff only): ${otCreatedByOnly.toFixed(2)}`);
  lines.push(`Prod credited เตย (owner logic): ${prodOwner.toFixed(2)}`);
  lines.push(`Prod credited (staff filter): ${prodStaffFilter.toFixed(2)}`);
  lines.push(`Prod credited (createdBy only): ${prodCreatedByOnly.toFixed(2)}`);
  lines.push("");

  const otHits = otMonth.filter((r) => entryCreditsTey(r, tey, staffIds).match).length;
  const prodHits = prodMonth.filter((r) => entryCreditsTey(r, tey, staffIds).match).length;
  const otOwnerHits = otMonth.filter((r) =>
    (r.workerIds || []).includes(TEY_EMP_ID) ||
    (r.workerNames || []).some((n) => namesMatch(n, tey.name) || (tey.nickname && namesMatch(n, tey.nickname))),
  ).length;
  const prodOwnerHits = prodMonth.filter((r) =>
    (r.workerIds || []).includes(TEY_EMP_ID) ||
    (r.workerNames || []).some((n) => namesMatch(n, tey.name) || (tey.nickname && namesMatch(n, tey.nickname))),
  ).length;

  lines.push(`OT rows owner sees for เตย: ${otOwnerHits} | staff filter sees: ${otHits}`);
  lines.push(`Prod rows owner sees for เตย: ${prodOwnerHits} | staff filter sees: ${prodHits}`);
  lines.push("");

  if (prodMiss.length) {
    lines.push(`--- prod rows owner counts but staff filter misses (${prodMiss.length}) ---`);
    for (const m of prodMiss.slice(0, 20)) {
      lines.push(`  ${m.date} id=${m.id.slice(0, 8)}… bonus=${m.bonus.toFixed(2)} names=${JSON.stringify(m.names)} ids=${JSON.stringify(m.ids)} createdBy=${m.createdBy || "—"}`);
    }
  }

  // Sample prod rows staff DOES see
  const prodSeen = prodMonth.filter((r) => entryCreditsTey(r, tey, staffIds).match);
  lines.push("");
  lines.push(`--- prod rows staff filter matches (${prodSeen.length}) ---`);
  for (const r of prodSeen.slice(0, 10)) {
    lines.push(
      `  ${new Date(r.date).toISOString().slice(0, 10)} names=${JSON.stringify(r.workerNames)} ids=${JSON.stringify(r.workerIds || [])} createdBy=${r.createdBy || "—"}`,
    );
  }

  const text = lines.join("\n");
  console.log(text);
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(join("artifacts", "diagnose-tey-bonus.txt"), text);
  console.log("\nWrote artifacts/diagnose-tey-bonus.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
