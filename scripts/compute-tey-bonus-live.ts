/**
 * Compute เตย month bonus from live Firestore (same as owner table).
 * Usage: npx tsx scripts/compute-tey-bonus-live.ts
 */
import { GoogleAuth } from "google-auth-library";
import { computeMonthBonus, parseMonthInput } from "../src/lib/bonus";
import { buildBonusDeductionLines, computeShopDeductPct } from "../src/lib/bonus-deductions";
import type { Employee } from "../src/lib/employees";
import type { OtEntry } from "../src/lib/ot";
import type { ProdEntry } from "../src/lib/production";
import type { RateScheduleEntry } from "../src/lib/rate-schedule";

const PROJECT = "mypeer-501909";
const TEY_EMP_ID = "985f6edfe50908710befc2d78cdb2b50";

async function getToken() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
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
  if ("arrayValue" in o) {
    const vals = (o.arrayValue as { values?: unknown[] })?.values || [];
    return vals.map(parseField);
  }
  if ("mapValue" in o) {
    const fields = (o.mapValue as { fields?: Record<string, unknown> })?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) out[k] = parseField(v);
    return out;
  }
  return null;
}

function docData(doc: { fields?: Record<string, unknown> }) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = parseField(v);
  return out;
}

async function listCollection(token: string, collectionId: string) {
  const rows: { id: string; data: Record<string, unknown> }[] = [];
  let pageToken = "";
  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}`,
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json()) as { documents?: { name?: string; fields?: Record<string, unknown> }[]; nextPageToken?: string };
    if (!res.ok) throw new Error(JSON.stringify(data));
    for (const doc of data.documents || []) {
      rows.push({ id: doc.name?.split("/").pop() || "", data: docData(doc) });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function getDoc(token: string, path: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return docData(data as { fields?: Record<string, unknown> });
}

function bangkokMonthKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(now))
    .replace("/", "-");
}

async function main() {
  const token = await getToken();
  const monthKey = bangkokMonthKey().replace(/(\d+)-(\d+)/, (_, y, m) => `${y}-${m}`);
  const { year, month: monthIdx } = parseMonthInput(monthKey);

  const since = Date.parse(`${monthKey}-01T00:00:00+07:00`);
  const nextM = monthIdx === 11 ? 1 : monthIdx + 2;
  const nextY = monthIdx === 11 ? year + 1 : year;
  const until = Date.parse(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00+07:00`);

  const [empDocs, otDocs, prodDocs, dedSettings, dedMonth, rateDoc, livePool] = await Promise.all([
    listCollection(token, "employees"),
    listCollection(token, "otEntries"),
    listCollection(token, "prodEntries"),
    getDoc(token, "bonusDeductionSettings/default"),
    getDoc(token, `bonusDeductionMonths/${monthKey}`),
    getDoc(token, "rateSchedule/default"),
    getDoc(token, `bonusLivePool/${monthKey}`),
  ]);

  const employees = empDocs.map((d) => ({ id: d.id, ...d.data })) as Employee[];
  const otEntries = otDocs
    .map((d) => ({ id: d.id, ...d.data }))
    .filter((r) => (r.date as number) >= since && (r.date as number) < until) as OtEntry[];
  const prodEntries = prodDocs
    .map((d) => ({ id: d.id, ...d.data }))
    .filter((r) => (r.date as number) >= since && (r.date as number) < until) as ProdEntry[];

  const rules = (dedSettings?.rules as { id: string; pct: number; label: string }[]) || [];
  const counts = (dedMonth?.counts as Record<string, number>) || {};
  const rateSchedule = ((rateDoc?.entries as RateScheduleEntry[]) || []);

  const report = computeMonthBonus(
    otEntries,
    prodEntries,
    employees,
    year,
    monthIdx,
    rules as never,
    counts as never,
    rateSchedule,
  );

  const teyRow = report.rows.find((r) => r.workerId === TEY_EMP_ID);
  if (!teyRow) {
    console.log("เตย row not found in report");
    console.log(
      "rows:",
      report.rows.map((r) => `${r.workerName} ${r.remaining}`),
    );
    return;
  }

  console.log(`=== computeMonthBonus · ${monthKey} · เตย ===`);
  console.log(`salesShare: ${teyRow.salesShare.toFixed(2)}`);
  console.log(`prodBonus:  ${teyRow.prodBonus.toFixed(2)}`);
  console.log(`otMain:     ${teyRow.otMain.toFixed(2)}`);
  console.log(`total:      ${teyRow.total.toFixed(2)}`);
  console.log(`remaining:  ${teyRow.remaining.toFixed(2)} (deduct ${teyRow.deductPct}%)`);
  console.log(`workedThisMonth: ${teyRow.workedThisMonth}`);
  console.log(`employeeCount (sales pool): ${report.employeeCount}`);
  console.log(`totalSalesPool: ${report.totalSalesPool.toFixed(2)}`);
  if (livePool) {
    console.log(`bonusLivePool: sales=${livePool.totalSalesPool} count=${livePool.employeeCount} deduct=${livePool.shopDeductPct}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
