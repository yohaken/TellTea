import { labelLedgerType } from "./ledger-labels";
import {
  accountingDayMs,
  formatDateShortBe,
  formatDateShortCe,
  formatPlainNumber,
  toEpochMs,
} from "./utils";

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Split into tokens; empty query → no tokens (match all). */
export function searchTokens(query: string): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  return q.split(/[\s,;/|]+/).filter(Boolean);
}

function haystackMatch(haystack: string, tokens: string[]) {
  const h = normalizeText(haystack);
  return tokens.every((t) => h.includes(t));
}

type DatedRow = {
  date: number;
  createdAt?: number;
};

/**
 * UI list order — Asia/Bangkok calendar day newest→oldest, then createdAt.
 * Numeric day ms (not string localeCompare) so mixed Firestore date types unify.
 */
export function sortByDateNewestFirst<T extends DatedRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDay = accountingDayMs(a.date);
    const bDay = accountingDayMs(b.date);
    if (aDay !== bDay) return bDay - aDay;
    const byCreated = toEpochMs(b.createdAt) - toEpochMs(a.createdAt);
    if (byCreated) return byCreated;
    return String((b as { id?: string }).id || "").localeCompare(
      String((a as { id?: string }).id || ""),
    );
  });
}

type SearchableOwnerRow = {
  date: number;
  description: string;
  amountOut: number;
  type?: string;
  note?: string;
  hasVat?: boolean;
  vatInput?: number;
  vatBase?: number;
  vatInvoiceNo?: string;
  createdBy?: string;
};

/**
 * ค้นทุกช่องของบช.เจ้าของ — วันที่ (/10/ · 5/10 · /69) · รายการ · ยอด (1,250 = 1250) ·
 * VAT · ฐาน VAT · เลขใบกำกับ · ประเภท · note · ผู้บันทึก
 */
export function filterOwnerBookRows<T extends SearchableOwnerRow>(
  rows: T[],
  query: string,
): T[] {
  if (!ledgerSearchTokens(query).length) return rows;
  const wrapped = rows.map((src) => ({ ...src, amountIn: 0, src }));
  return filterLedgerRowsMulti(wrapped, [query], ({ src: r }) =>
    [
      r.note || "",
      r.vatInvoiceNo || "",
      r.createdBy || "",
      r.hasVat && Number(r.vatBase) > 0 ? formatPlainNumber(Number(r.vatBase)) : "",
    ].join(" "),
  ).map((w) => w.src);
}

type SearchableLedgerRow = {
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  type?: string;
};

/**
 * คำค้นบัญชี: ไม่ตัดที่ "/" และ "," เพื่อให้ค้นวันที่ (/10/) และยอดเงิน (1,250) ได้
 */
export function ledgerSearchTokens(query: string): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  // "*" = wildcard (ค้นแบบมีคำนี้อยู่แล้ว) — "*ft" / "ft*" = "ft"
  return q
    .split(/[\s;|]+/)
    .map((t) => t.replace(/^\*+|\*+$/g, ""))
    .filter(Boolean);
}

const DATE_TOKEN = /^\/?\d{1,4}(\/\d{0,4}){0,2}\/?$/;

/**
 * รูปวันที่ทุกแบบของแถว คั่นด้วย ^…$ — คำค้น "/10/" = เดือน 10 · "5/" = วันที่ 5 ·
 * "5/10" = 5 ต.ค. · "/69" หรือ "/2569" = ปี (พ.ศ./ค.ศ.)
 */
function dateForms(ms: number): string[] {
  const be = formatDateShortBe(ms).split("/");
  const ce = formatDateShortCe(ms).split("/");
  if (be.length !== 3 || ce.length !== 3) return [];
  const [d, m, yBe2] = be as [string, string, string];
  const yCe2 = ce[2]!;
  const yBe4 = String(2500 + Number(yBe2));
  const yCe4 = String(2000 + Number(yCe2));
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  const forms: string[] = [];
  for (const day of new Set([d, dd])) {
    for (const mon of new Set([m, mm])) {
      for (const y of [yBe2, yCe2, yBe4, yCe4]) forms.push(`^${day}/${mon}/${y}$`);
    }
  }
  return forms;
}

function dateTokenMatch(token: string, forms: string[]): boolean {
  const head = token.startsWith("/") ? token : `^${token}`;
  if (head.endsWith("/")) return forms.some((f) => f.includes(head));
  // ส่วนท้ายต้องจบที่ขอบช่อง — "/10" = เดือน 10 หรือปี 10 · ไม่ใช่ /100
  return forms.some((f) => f.includes(`${head}/`) || f.includes(`${head}$`));
}

/** ยอดเงิน: "1,250" = "1250" · "1250.5" ตรงกับ 1,250.50 */
function numberTokenMatch(token: string, amounts: number[]): boolean {
  const raw = token.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) return false;
  return amounts.some((a) => {
    if (!(a > 0)) return false;
    const plain = String(Math.round(a * 100) / 100);
    return plain.includes(raw) || a.toFixed(2).includes(raw);
  });
}

type SearchableLedgerRowFull = SearchableLedgerRow & { vatInput?: number; hasVat?: boolean };

/**
 * ค้นทุกคอลัมน์บัญชี (วันที่ · รายการ · เข้า · ออก · VAT · ประเภท · ข้อความเพิ่ม เช่น ผู้จัด)
 * หลายช่องค้น = ต้องตรงทุกช่อง (AND) · ในช่องเดียวทุกคำต้องตรง
 */
export function filterLedgerRowsMulti<T extends SearchableLedgerRowFull>(
  rows: T[],
  queries: string[],
  extraText?: (row: T) => string,
): T[] {
  const tokens = queries.flatMap(ledgerSearchTokens);
  if (!tokens.length) return rows;

  return rows.filter((row) => {
    const typeLabel = row.type ? labelLedgerType(row.type) : "";
    const vat = row.hasVat ? Number(row.vatInput) || 0 : 0;
    const amounts = [row.amountIn || 0, row.amountOut || 0, vat];
    const forms = dateForms(row.date);
    const blob = normalizeText(
      [
        row.description || "",
        row.type || "",
        typeLabel,
        row.amountIn > 0 ? "เข้า เงินเข้า" : "",
        row.amountOut > 0 ? "ออก เงินออก" : "",
        vat > 0 ? "vat ภาษี" : "",
        formatDateShortBe(row.date),
        formatDateShortCe(row.date),
        ...amounts.filter((a) => a > 0).map((a) => formatPlainNumber(a)),
        extraText?.(row) || "",
      ].join(" "),
    );
    return tokens.every((t) => {
      if (t.includes("/") && DATE_TOKEN.test(t)) {
        return dateTokenMatch(t, forms) || normalizeText(row.description || "").includes(t);
      }
      if (blob.includes(t)) return true;
      return numberTokenMatch(t, amounts);
    });
  });
}

export function filterLedgerRows<T extends SearchableLedgerRow>(
  rows: T[],
  query: string,
): T[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return rows;

  return rows.filter((row) => {
    const typeLabel = row.type ? labelLedgerType(row.type) : "";
    const blob = [
      row.description || "",
      row.type || "",
      typeLabel,
      // Match both พ.ศ. UI labels and ค.ศ. typed searches.
      formatDateShortBe(row.date),
      formatDateShortCe(row.date),
      formatPlainNumber(row.amountIn || 0),
      formatPlainNumber(row.amountOut || 0),
      String(row.amountIn || ""),
      String(row.amountOut || ""),
    ].join(" ");
    return haystackMatch(blob, tokens);
  });
}
