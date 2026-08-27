/** Compare partial vs full bonus for เตย */
import { GoogleAuth } from "google-auth-library";
import { computeMonthBonus, parseMonthInput } from "../src/lib/bonus";
import { computeOtBonus } from "../src/lib/ot";
import { computeProdBonus } from "../src/lib/production";
import { workEntryCreditsEmployee } from "../src/lib/work-entry-mine";
import type { Employee } from "../src/lib/employees";

const PROJECT = "mypeer-501909";
const TEY = "985f6edfe50908710befc2d78cdb2b50";
const STAFF = "nawarat.srikaeban@gmail.com";

async function getToken() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/datastore"] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no token");
  return token;
}

function parseField(f: unknown): unknown {
  if (f == null || typeof f !== "object") return null;
  const o = f as Record<string, unknown>;
  if ("stringValue" in o) return o.stringValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return o.doubleValue;
  if ("booleanValue" in o) return o.booleanValue;
  if ("arrayValue" in o) return ((o.arrayValue as { values?: unknown[] }).values || []).map(parseField);
  if ("mapValue" in o) {
    const fields = (o.mapValue as { fields?: Record<string, unknown> }).fields || {};
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseField(v)]));
  }
  return null;
}

async function list(col: string) {
  const token = await getToken();
  const rows: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json()) as { documents?: { name?: string; fields?: Record<string, unknown> }[]; nextPageToken?: string };
    for (const doc of data.documents || []) {
      const id = doc.name?.split("/").pop() || "";
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doc.fields || {})) fields[k] = parseField(v);
      rows.push({ id, ...fields });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function main() {
  const monthKey = "2026-08";
  const { year, month } = parseMonthInput(monthKey);
  const since = Date.parse("2026-08-01T00:00:00+07:00");
  const until = Date.parse("2026-09-01T00:00:00+07:00");

  const [employees, otAll, prodAll] = await Promise.all([
    list("employees"),
    list("otEntries"),
    list("prodEntries"),
  ]);
  const tey = employees.find((e) => e.id === TEY) as Employee;
  const ot = otAll.filter((r) => (r.date as number) >= since && (r.date as number) < until);
  const prod = prodAll.filter((r) => (r.date as number) >= since && (r.date as number) < until);

  let otSum = 0;
  let prodSum = 0;
  for (const row of ot) {
    if (!workEntryCreditsEmployee(row as never, tey, employees as Employee[], STAFF)) continue;
    otSum += computeOtBonus(row as never).bonusPerPerson;
  }
  for (const row of prod) {
    if (!workEntryCreditsEmployee(row as never, tey, employees as Employee[], STAFF)) continue;
    prodSum += computeProdBonus(row as never).bonusPerPerson;
  }

  const salesPool = 299.8;
  console.log("=== DB truth (Aug 2026) ===");
  console.log(`Full match: sales~${salesPool} prod=${prodSum.toFixed(2)} ot=${otSum.toFixed(2)} total~${(salesPool + prodSum + otSum).toFixed(2)}`);
  console.log(`OT rows: ${ot.filter((r) => workEntryCreditsEmployee(r as never, tey, employees as Employee[], STAFF)).length}/${ot.length}`);
  console.log(`Prod rows: ${prod.filter((r) => workEntryCreditsEmployee(r as never, tey, employees as Employee[], STAFF)).length}/${prod.length}`);

  const aug23 = Date.parse("2026-08-23T00:00:00+07:00");
  const aug28 = Date.parse("2026-08-28T00:00:00+07:00");
  let p3 = 0;
  let o3 = 0;
  for (const row of prod) {
    const d = row.date as number;
    if (d < aug23 || d >= aug28) continue;
    if (workEntryCreditsEmployee(row as never, tey, employees as Employee[], STAFF)) {
      p3 += computeProdBonus(row as never).bonusPerPerson;
    }
  }
  for (const row of ot) {
    const d = row.date as number;
    if (d < aug23 || d >= aug28) continue;
    if (workEntryCreditsEmployee(row as never, tey, employees as Employee[], STAFF)) {
      o3 += computeOtBonus(row as never).bonusPerPerson;
    }
  }
  console.log(`\nOnly Aug 23-27 (3 prod days user saw): prod=${p3.toFixed(2)} ot=${o3.toFixed(2)} total=${(salesPool + p3 + o3).toFixed(2)}`);

  // Brute: find prod subset closest to 156.25
  const prodRows = prod
    .filter((r) => workEntryCreditsEmployee(r as never, tey, employees as Employee[], STAFF))
    .map((r) => ({ id: r.id, date: r.date, bonus: computeProdBonus(r as never).bonusPerPerson }))
    .sort((a, b) => (a.date as number) - (b.date as number));

  console.log("\nProd bonuses by date (เตย):");
  for (const r of prodRows) {
    console.log(`  ${new Date(r.date as number).toISOString().slice(0, 10)}  ${r.bonus.toFixed(2)}`);
  }

  const report = computeMonthBonus(ot as never[], prod as never[], employees as Employee[], year, month, [], {}, []);
  const row = report.rows.find((r) => r.workerId === TEY);
  console.log("\ncomputeMonthBonus (owner):", row && {
    sales: row.salesShare,
    prod: row.prodBonus,
    ot: row.otMain,
    total: row.total,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
