import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export const CASH_DEPOSIT_PAGE_SIZE = 40;
export const CASH_DEPOSIT_LIVE_MAX = 200;
/** Max bank-transfer slips per round (แต่ละใบมียอด + คชจ. ของตัวเอง) */
export const CASH_DEPOSIT_BANK_TRANSFER_MAX = 8;
/** Photos per bank-transfer slip (normally 1) */
export const CASH_DEPOSIT_BANK_SLIP_MAX = 2;
/** POS shift/daily summary photos per day line */
export const CASH_DEPOSIT_DAY_SLIP_MAX = 4;
/**
 * Max day-lines per round. Rounds are variable (5 / 7 / 10 …) —
 * hard cap = one full calendar month.
 */
export const CASH_DEPOSIT_DAY_MAX = 31;
export type CashSlipKind = "daily" | "shift" | "unknown";

export type CashDepositStatus = "pending" | "matched" | "mismatch" | "void";

/** Who filled a numeric/date field — AI read from slip vs staff typed */
export type CashFillSource = "ai" | "staff" | "";

/** One bank e-slip in a deposit round (may be several transfers). */
export type CashDepositBankTransfer = {
  id: string;
  /** Amount credited to shop account on this slip */
  amount: number;
  /** Fee on this slip */
  fee: number;
  bankRef: string;
  /** Optional date on this slip */
  transferDate: number;
  amountSource: CashFillSource;
  feeSource: CashFillSource;
  slipUrls: string[];
};

export type CashDepositDayLine = {
  id: string;
  /** Local midnight ms of the sales day on the slip */
  date: number;
  slipKind: CashSlipKind;
  /** Free label e.g. กะเช้า / กะเย็น — useful when slipKind is shift */
  shiftLabel: string;
  /** Cash sales from POS summary — primary figure for bank reconcile */
  cashAmount: number;
  /**
   * Optional: actual/expected cash in drawer at close (เงินปิดลิ้นชัก).
   * Useful for till variance; bank reconcile still uses cashAmount sum.
   */
  drawerCloseAmount: number;
  cashAmountSource: CashFillSource;
  drawerCloseAmountSource: CashFillSource;
  dateSource: CashFillSource;
  note: string;
  slipUrls: string[];
  /**
   * Optional link to closed posSessions — when filled from nPos remits,
   * cashAmount should equal Σ effective cash of these ids
   * (sessionActualAmounts[id] if set, else session.remitAmount).
   */
  sessionIds: string[];
  /**
   * Per-session staff override of cash counted from the physical round slip
   * (เทียบเอกสาร — not a bank transfer). Keys = sessionIds.
   * Missing key → use system remit for that session.
   */
  sessionActualAmounts: Record<string, number>;
};

export type CashDeposit = {
  id: string;
  /** When cash was transferred into the shop bank account */
  transferDate: number;
  periodStart: number;
  periodEnd: number;
  staffName: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Σ amount of all bankTransfers (เข้าบัญชีรวม) */
  bankAmount: number;
  /** Σ fee of all bankTransfers */
  transferFee: number;
  /** @deprecated aggregate source — prefer per-transfer sources */
  bankAmountSource: CashFillSource;
  /** @deprecated aggregate source — prefer per-transfer sources */
  transferFeeSource: CashFillSource;
  /** Flattened slip urls (legacy + convenience) */
  bankSlipUrls: string[];
  /** First non-empty ref (legacy) */
  bankRef: string;
  /** One row per bank e-slip (each has own amount + fee) */
  bankTransfers: CashDepositBankTransfer[];
  days: CashDepositDayLine[];
  expectedCashTotal: number;
  /**
   * Σ(เข้าบัญชี) + Σ(คชจ.) − รวมเงินสด
   * 0 = ตรง
   */
  variance: number;
  status: CashDepositStatus;
  note: string;
  ownerNote: string;
  verifiedBy: string;
  verifiedAt: number;
};

export type CashDepositInput = {
  transferDate: number;
  periodStart: number;
  periodEnd: number;
  staffName: string;
  createdBy: string;
  /** Preferred: list of bank slips; totals derived automatically */
  bankTransfers?: CashDepositBankTransfer[] | Omit<CashDepositBankTransfer, "id">[];
  /** Legacy single totals — used only if bankTransfers empty */
  bankAmount?: number;
  transferFee?: number;
  bankAmountSource?: CashFillSource;
  transferFeeSource?: CashFillSource;
  bankSlipUrls?: string[];
  bankRef?: string;
  days: Omit<CashDepositDayLine, "id">[] | CashDepositDayLine[];
  note?: string;
};

export type CashDepositPage = {
  entries: CashDeposit[];
  hasMore: boolean;
};

const STATUS_SET = new Set<CashDepositStatus>(["pending", "matched", "mismatch", "void"]);
const SLIP_KIND_SET = new Set<CashSlipKind>(["daily", "shift", "unknown"]);

export function newCashDepositDayId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newCashDepositBankId() {
  return `b${newCashDepositDayId()}`;
}

export function emptyCashDepositBankTransfer(
  transferDateMs = 0,
): CashDepositBankTransfer {
  return {
    id: newCashDepositBankId(),
    amount: 0,
    fee: 0,
    bankRef: "",
    transferDate: transferDateMs ? cashDepositDayKey(transferDateMs) : 0,
    amountSource: "",
    feeSource: "",
    slipUrls: [],
  };
}

export function sumCashDepositDays(days: Pick<CashDepositDayLine, "cashAmount">[]) {
  return days.reduce((sum, d) => sum + (Number(d.cashAmount) || 0), 0);
}

/**
 * Day amounts that count toward 「ต้องโอน」must be linked to nPos remit sessions.
 * cashAmount 0 (ร้านปิด) is allowed without sessionIds.
 */
export function assertCashDepositDaysNposLinked(
  days: Pick<CashDepositDayLine, "date" | "cashAmount" | "sessionIds">[],
): void {
  for (const d of days) {
    const amt = Number(d.cashAmount) || 0;
    if (amt <= 0) continue;
    if ((d.sessionIds || []).some((id) => String(id || "").trim())) continue;
    const label = d.date ? formatCashDayShort(d.date) : "วันนี้";
    throw new Error(
      `${label}: ยอดบิลนำส่งต้องดึงจากรอบปิด nPos เท่านั้น (กด「จากรอบ」หรือใช้บิลรอโอน)`,
    );
  }
}

export function sumBankTransferAmounts(
  rows: Pick<CashDepositBankTransfer, "amount">[],
) {
  return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

export function sumBankTransferFees(rows: Pick<CashDepositBankTransfer, "fee">[]) {
  return rows.reduce((sum, r) => sum + (Number(r.fee) || 0), 0);
}

export function flattenBankTransferUrls(
  rows: Pick<CashDepositBankTransfer, "slipUrls">[],
) {
  const out: string[] = [];
  for (const r of rows) {
    for (const u of r.slipUrls || []) {
      const t = String(u || "").trim();
      if (t) out.push(t);
    }
  }
  return out.slice(0, CASH_DEPOSIT_BANK_TRANSFER_MAX * CASH_DEPOSIT_BANK_SLIP_MAX);
}

export function sumCashDepositDrawerClose(
  days: Pick<CashDepositDayLine, "drawerCloseAmount">[],
) {
  return days.reduce((sum, d) => sum + (Number(d.drawerCloseAmount) || 0), 0);
}

/** Short round label for table column — e.g. 18–25/12 */
export function labelCashDepositRound(
  entry: Pick<CashDeposit, "periodStart" | "periodEnd" | "transferDate">,
) {
  const start = entry.periodStart || entry.transferDate;
  const end = entry.periodEnd || entry.transferDate;
  if (!start || !end) return "—";
  const a = new Date(cashDepositDayKey(start));
  const b = new Date(cashDepositDayKey(end));
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) {
    return `${a.getDate()}–${b.getDate()}/${b.getMonth() + 1}`;
  }
  return `${formatCashDayShort(start)}–${formatCashDayShort(end)}`;
}

/**
 * ผลต่างหลังคิดค่าธรรมเนียม:
 * (ยอดเข้าบัญชี + ค่าธรรมเนียม) − รวมเงินสดจากสลิป
 * = 0 แปลว่าตรง
 *
 * พนักงานมัดรวมหลายบิลแล้วโอนครั้งเดียว:
 * ยอดโอนเข้าบช. = มัดรวมจริง − คชจ.โอน (ไม่ต้องเบิกคชจ.แยก)
 */
export function cashDepositVariance(
  bankAmount: number,
  expectedCashTotal: number,
  transferFee = 0,
) {
  const bank = Number(bankAmount) || 0;
  const fee = Math.max(0, Number(transferFee) || 0);
  const cash = Number(expectedCashTotal) || 0;
  return Math.round((bank + fee - cash) * 100) / 100;
}

/** ยอดที่ควรโอนเข้าบัญชี = มัดรวมบิลนำส่ง − คชจ.โอน */
export function suggestedNetBankTransfer(
  bundleCashTotal: number,
  transferFee = 0,
) {
  const cash = Number(bundleCashTotal) || 0;
  const fee = Math.max(0, Number(transferFee) || 0);
  return Math.round(Math.max(0, cash - fee) * 100) / 100;
}

export function normalizeCashFillSource(raw: unknown): CashFillSource {
  const s = String(raw || "").trim();
  if (s === "ai" || s === "staff") return s;
  return "";
}

export function labelCashDepositStatus(status: CashDepositStatus) {
  switch (status) {
    case "matched":
      return "โอนแล้ว";
    case "mismatch":
      return "ไม่ตรง";
    case "void":
      return "ยกเลิก";
    default:
      // legacy rows only — new saves auto-match (no owner verify)
      return "โอนแล้ว";
  }
}

export function labelCashSlipKind(kind: CashSlipKind) {
  switch (kind) {
    case "daily":
      return "สรุปรายวัน";
    case "shift":
      return "สลิปกะ";
    default:
      return "ไม่แน่ใจ";
  }
}

function cashDepositsCol() {
  return collection(getDb(), "cashDeposits");
}

function normalizeUrls(urls: unknown, max: number): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(String).map((u) => u.trim()).filter(Boolean).slice(0, max);
}

function normalizeDay(raw: unknown): CashDepositDayLine | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const cashAmount = Number(d.cashAmount) || 0;
  if (!(cashAmount >= 0)) return null;
  const slipKindRaw = String(d.slipKind || "unknown") as CashSlipKind;
  const slipKind = SLIP_KIND_SET.has(slipKindRaw) ? slipKindRaw : "unknown";
  const sessionIds = Array.isArray(d.sessionIds)
    ? d.sessionIds
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 40)
    : [];
  const sessionActualAmounts = normalizeSessionActualAmounts(
    d.sessionActualAmounts,
    sessionIds,
  );
  return {
    id: String(d.id || newCashDepositDayId()),
    date: Number(d.date) || 0,
    slipKind,
    shiftLabel: typeof d.shiftLabel === "string" ? d.shiftLabel : "",
    cashAmount,
    drawerCloseAmount: Math.max(0, Number(d.drawerCloseAmount) || 0),
    cashAmountSource: normalizeCashFillSource(d.cashAmountSource),
    drawerCloseAmountSource: normalizeCashFillSource(d.drawerCloseAmountSource),
    dateSource: normalizeCashFillSource(d.dateSource),
    note: typeof d.note === "string" ? d.note : "",
    slipUrls: normalizeUrls(d.slipUrls, CASH_DEPOSIT_DAY_SLIP_MAX),
    sessionIds,
    sessionActualAmounts,
  };
}

/** Keep only non-negative finite overrides for known session ids. */
export function normalizeSessionActualAmounts(
  raw: unknown,
  sessionIds: string[],
): Record<string, number> {
  const allow = new Set(
    sessionIds.map((id) => String(id || "").trim()).filter(Boolean),
  );
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (!allow.size) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || "").trim();
    if (!id || !allow.has(id)) continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) continue;
    out[id] = Math.round(n * 100) / 100;
  }
  return out;
}

function normalizeBankTransfer(raw: unknown): CashDepositBankTransfer | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const amount = Math.max(0, Number(d.amount) || 0);
  const fee = Math.max(0, Number(d.fee) || 0);
  return {
    id: String(d.id || newCashDepositBankId()),
    amount,
    fee,
    bankRef: typeof d.bankRef === "string" ? d.bankRef.trim().slice(0, 80) : "",
    transferDate: Number(d.transferDate) || 0,
    amountSource: normalizeCashFillSource(d.amountSource),
    feeSource: normalizeCashFillSource(d.feeSource),
    slipUrls: normalizeUrls(d.slipUrls, CASH_DEPOSIT_BANK_SLIP_MAX),
  };
}

/** Migrate legacy single bankAmount/fee/urls → bankTransfers[] */
export function coerceBankTransfers(
  data: {
    bankTransfers?: unknown;
    bankAmount?: unknown;
    transferFee?: unknown;
    bankSlipUrls?: unknown;
    bankRef?: unknown;
    transferDate?: unknown;
    bankAmountSource?: unknown;
    transferFeeSource?: unknown;
  },
): CashDepositBankTransfer[] {
  const fromList = Array.isArray(data.bankTransfers)
    ? data.bankTransfers
        .map(normalizeBankTransfer)
        .filter((x): x is CashDepositBankTransfer => !!x)
        .slice(0, CASH_DEPOSIT_BANK_TRANSFER_MAX)
    : [];
  if (fromList.length) return fromList;

  const amount = Math.max(0, Number(data.bankAmount) || 0);
  const fee = Math.max(0, Number(data.transferFee) || 0);
  const urls = normalizeUrls(data.bankSlipUrls, CASH_DEPOSIT_BANK_SLIP_MAX);
  const ref = typeof data.bankRef === "string" ? data.bankRef.trim() : "";
  if (!(amount > 0) && !urls.length && !ref) return [];
  return [
    {
      id: newCashDepositBankId(),
      amount,
      fee,
      bankRef: ref.slice(0, 80),
      transferDate: Number(data.transferDate) || 0,
      amountSource: normalizeCashFillSource(data.bankAmountSource),
      feeSource: normalizeCashFillSource(data.transferFeeSource),
      slipUrls: urls,
    },
  ];
}

function mapEntry(d: QueryDocumentSnapshot): CashDeposit {
  const data = d.data() as Record<string, unknown>;
  const createdAt = Number(data.createdAt) || 0;
  const daysRaw = Array.isArray(data.days) ? data.days : [];
  const days = daysRaw
    .map(normalizeDay)
    .filter((x): x is CashDepositDayLine => !!x)
    .slice(0, CASH_DEPOSIT_DAY_MAX);
  const expectedCashTotal =
    Number(data.expectedCashTotal) || sumCashDepositDays(days);
  const bankTransfers = coerceBankTransfers(data);
  const bankAmount =
    bankTransfers.length > 0
      ? sumBankTransferAmounts(bankTransfers)
      : Number(data.bankAmount) || 0;
  const transferFee =
    bankTransfers.length > 0
      ? sumBankTransferFees(bankTransfers)
      : Math.max(0, Number(data.transferFee) || 0);
  const bankSlipUrls = flattenBankTransferUrls(bankTransfers);
  const bankRef =
    bankTransfers.map((t) => t.bankRef).find((r) => r.trim()) ||
    (typeof data.bankRef === "string" ? data.bankRef : "");
  const statusRaw = String(data.status || "pending") as CashDepositStatus;
  return {
    id: d.id,
    transferDate: Number(data.transferDate) || 0,
    periodStart: Number(data.periodStart) || 0,
    periodEnd: Number(data.periodEnd) || 0,
    staffName: typeof data.staffName === "string" ? data.staffName : "",
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt,
    updatedAt: Number(data.updatedAt) || createdAt,
    bankAmount,
    transferFee,
    bankAmountSource: normalizeCashFillSource(data.bankAmountSource),
    transferFeeSource: normalizeCashFillSource(data.transferFeeSource),
    bankSlipUrls,
    bankRef,
    bankTransfers,
    days,
    expectedCashTotal,
    variance:
      Number.isFinite(Number(data.variance))
        ? Number(data.variance)
        : cashDepositVariance(bankAmount, expectedCashTotal, transferFee),
    status: STATUS_SET.has(statusRaw) ? statusRaw : "pending",
    note: typeof data.note === "string" ? data.note : "",
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : "",
    verifiedBy: typeof data.verifiedBy === "string" ? data.verifiedBy : "",
    verifiedAt: Number(data.verifiedAt) || 0,
  };
}

/** Local calendar midnight for a Date/ms (shop day key). */
export function cashDepositDayKey(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addCalendarDays(ms: number, delta: number): number {
  const d = new Date(cashDepositDayKey(ms));
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

export function calendarDaysInclusive(startMs: number, endMs: number): number[] {
  const start = cashDepositDayKey(startMs);
  const end = cashDepositDayKey(endMs);
  if (end < start) return [];
  const out: number[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

export function daysInCalendarMonth(ms: number): number {
  const d = new Date(cashDepositDayKey(ms));
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function monthKeyFromMs(ms: number): string {
  const d = new Date(cashDepositDayKey(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type CashDayIssueCode =
  | "empty"
  | "too_long"
  | "bad_amount"
  | "duplicate"
  | "gap"
  | "overlap"
  | "month_overflow";

export type CashDayIssue = {
  code: CashDayIssueCode;
  message: string;
  dateMs?: number;
};

export type CashDayCoverage = {
  issues: CashDayIssue[];
  /** Unique sorted day keys in this round */
  sortedDates: number[];
  periodStart: number;
  periodEnd: number;
  dayCount: number;
};

/**
 * มัดรวมบิล nPos · วันอาจไม่ต่อเนื่องได้เมื่อ allowGaps (ค่าเริ่มต้น true)
 * ตรวจ: ว่าง · ยอดติดลบ · วันซ้ำในรอบ · ชนรอบอื่น · เกินวันในเดือน
 */
export function analyzeCashDepositDays(
  days: Pick<CashDepositDayLine, "date" | "cashAmount">[],
  opts?: {
    /** dateKey → deposit id that already claims it (non-void) */
    occupiedByDepositId?: Map<number, string>;
    excludeDepositId?: string;
    /** Other deposits' day keys by month for month-cap (excluding self) */
    occupiedMonthCounts?: Map<string, number>;
    /**
     * false = บังคับวันต่อเนื่องแบบระบบเดิม
     * true/omit = มัดรวมบิลข้ามวันได้ (ค่าเริ่มต้น)
     */
    allowGaps?: boolean;
  },
): CashDayCoverage {
  const issues: CashDayIssue[] = [];
  if (!days.length) {
    issues.push({ code: "empty", message: "ต้องมีอย่างน้อย 1 บิลนำส่งในมัดรวม" });
    return { issues, sortedDates: [], periodStart: 0, periodEnd: 0, dayCount: 0 };
  }
  if (days.length > CASH_DEPOSIT_DAY_MAX) {
    issues.push({
      code: "too_long",
      message: `มัดรวมหนึ่งมีได้สูงสุด ${CASH_DEPOSIT_DAY_MAX} วัน`,
    });
  }

  if (days.some((day) => !day.date)) {
    issues.push({ code: "empty", message: "ทุกบิลต้องมีวันที่รอบขาย" });
  }
  if (days.some((day) => Number(day.cashAmount) < 0)) {
    issues.push({
      code: "bad_amount",
      message: "ยอดบิลนำส่งติดลบไม่ได้",
    });
  }
  if (!days.some((day) => Number(day.cashAmount) > 0)) {
    issues.push({
      code: "bad_amount",
      message: "มัดรวมต้องมียอดบิลนำส่งรวมมากกว่า 0 — กด「ใส่บิลนี้」",
    });
  }

  const keyed = days.map((d) => cashDepositDayKey(d.date)).filter((n) => n > 0);
  const seen = new Map<number, number>();
  for (const key of keyed) {
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push({
        code: "duplicate",
        message: `วันซ้ำ ${formatCashDayShort(key)} ในมัดรวม — รวมบิลวันเดียวกันไว้แถวเดียว`,
        dateMs: key,
      });
    }
  }

  const sortedDates = [...seen.keys()].sort((a, b) => a - b);
  const periodStart = sortedDates[0] || 0;
  const periodEnd = sortedDates[sortedDates.length - 1] || 0;

  if (opts?.allowGaps === false && sortedDates.length >= 2) {
    const expected = calendarDaysInclusive(periodStart, periodEnd);
    const have = new Set(sortedDates);
    const missing = expected.filter((d) => !have.has(d));
    if (missing.length) {
      const sample = missing.slice(0, 3).map(formatCashDayShort).join(", ");
      issues.push({
        code: "gap",
        message:
          `ข้ามวันในรอบ (${missing.length} วัน) เช่น ${sample}` +
          (missing.length > 3 ? "…" : "") +
          " — รอบต้องต่อเนื่องไม่มีช่องว่าง",
        dateMs: missing[0],
      });
    }
  }

  const occupied = opts?.occupiedByDepositId;
  if (occupied) {
    for (const key of sortedDates) {
      const otherId = occupied.get(key);
      if (otherId && otherId !== opts.excludeDepositId) {
        issues.push({
          code: "overlap",
          message: `วันที่ ${formatCashDayShort(key)} ถูกใช้ในรอบอื่นแล้ว — ห้ามบิลซ้ำข้ามรอบ`,
          dateMs: key,
        });
      }
    }
  }

  // Per-month: days in this round + other rounds ≤ calendar days in that month
  const monthLocal = new Map<string, number>();
  for (const key of sortedDates) {
    const mk = monthKeyFromMs(key);
    monthLocal.set(mk, (monthLocal.get(mk) || 0) + 1);
  }
  for (const [mk, localCount] of monthLocal) {
    const others = opts?.occupiedMonthCounts?.get(mk) || 0;
    // When occupiedMonthCounts already excludes self, just add local.
    // When built from all deposits including self, pass excludeDepositId path via buildOccupiedMaps.
    const total = localCount + others;
    const sampleMs = sortedDates.find((d) => monthKeyFromMs(d) === mk) || periodStart;
    const cap = daysInCalendarMonth(sampleMs);
    if (total > cap) {
      issues.push({
        code: "month_overflow",
        message: `เดือน ${mk} มีบิล ${total} วัน เกินจำนวนวันในเดือน (${cap})`,
      });
    }
  }

  return {
    issues,
    sortedDates,
    periodStart,
    periodEnd,
    dayCount: sortedDates.length,
  };
}

/** Short day label for cash-in UI — พ.ศ. e.g. 22/7/68 (storage stays CE). */
export function formatCashDayShort(ms: number) {
  if (!ms) return "—";
  const d = new Date(cashDepositDayKey(ms));
  const beYear = d.getFullYear() + 543;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(beYear).slice(-2)}`;
}

/** Build occupancy maps from existing deposits (skip void). */
export function buildCashDepositOccupancy(
  entries: Pick<CashDeposit, "id" | "status" | "days">[],
  excludeDepositId?: string,
): {
  occupiedByDepositId: Map<number, string>;
  occupiedMonthCounts: Map<string, number>;
} {
  const occupiedByDepositId = new Map<number, string>();
  const occupiedMonthCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status === "void") continue;
    if (excludeDepositId && entry.id === excludeDepositId) continue;
    const seenMonthDay = new Set<string>();
    for (const day of entry.days || []) {
      const key = cashDepositDayKey(day.date);
      if (!key) continue;
      if (!occupiedByDepositId.has(key)) occupiedByDepositId.set(key, entry.id);
      const mk = monthKeyFromMs(key);
      const stamp = `${mk}:${key}`;
      if (!seenMonthDay.has(stamp)) {
        seenMonthDay.add(stamp);
        occupiedMonthCounts.set(mk, (occupiedMonthCounts.get(mk) || 0) + 1);
      }
    }
  }
  return { occupiedByDepositId, occupiedMonthCounts };
}

function normalizeInputDays(
  days: CashDepositInput["days"],
): CashDepositDayLine[] {
  return days
    .map((d) =>
      normalizeDay({
        ...d,
        id: "id" in d && d.id ? d.id : newCashDepositDayId(),
      }),
    )
    .filter((x): x is CashDepositDayLine => !!x)
    .slice(0, CASH_DEPOSIT_DAY_MAX);
}

function buildPayload(
  input: CashDepositInput,
  occupancy?: ReturnType<typeof buildCashDepositOccupancy>,
  excludeDepositId?: string,
) {
  if (!input.createdBy.trim()) throw new Error("ไม่พบผู้บันทึก");
  if (!input.staffName.trim()) throw new Error("ต้องใส่ชื่อพนักงานที่โอน");
  if (!input.transferDate) throw new Error("ต้องใส่วันที่โอนเข้าบัญชี");
  const days = normalizeInputDays(input.days);
  const coverage = analyzeCashDepositDays(days, {
    occupiedByDepositId: occupancy?.occupiedByDepositId,
    occupiedMonthCounts: occupancy?.occupiedMonthCounts,
    excludeDepositId,
  });
  if (coverage.issues.length) {
    throw new Error(coverage.issues[0]!.message);
  }
  const periodStart = coverage.periodStart;
  const periodEnd = coverage.periodEnd;
  if (!periodStart || periodEnd < periodStart) throw new Error("ช่วงวันไม่ถูกต้อง");
  const expectedCashTotal = sumCashDepositDays(days);

  const bankTransfers = coerceBankTransfers({
    bankTransfers: input.bankTransfers,
    bankAmount: input.bankAmount,
    transferFee: input.transferFee,
    bankSlipUrls: input.bankSlipUrls,
    bankRef: input.bankRef,
    transferDate: input.transferDate,
    bankAmountSource: input.bankAmountSource,
    transferFeeSource: input.transferFeeSource,
  }).slice(0, CASH_DEPOSIT_BANK_TRANSFER_MAX);

  if (!bankTransfers.length) {
    throw new Error("ต้องมีอย่างน้อย 1 สลิปโอนเข้าบัญชี");
  }
  for (const t of bankTransfers) {
    if (!(t.amount > 0)) throw new Error("ยอดเข้าบัญชีในแต่ละสลิปโอนต้องมากกว่า 0");
  }
  const bankAmount = sumBankTransferAmounts(bankTransfers);
  const transferFee = sumBankTransferFees(bankTransfers);
  const bankSlipUrls = flattenBankTransferUrls(bankTransfers);
  const bankRef =
    bankTransfers.map((t) => t.bankRef).find((r) => r.trim()) ||
    (input.bankRef || "").trim();

  if (bankSlipUrls.some((u) => u.startsWith("data:"))) {
    throw new Error("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่");
  }
  for (const day of days) {
    if (day.slipUrls.some((u) => u.startsWith("data:"))) {
      throw new Error("รูปสลิป POS เก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่");
    }
  }
  return {
    transferDate: input.transferDate,
    periodStart,
    periodEnd,
    staffName: input.staffName.trim(),
    createdBy: input.createdBy.trim(),
    bankAmount,
    transferFee,
    bankAmountSource: normalizeCashFillSource(input.bankAmountSource),
    transferFeeSource: normalizeCashFillSource(input.transferFeeSource),
    bankSlipUrls,
    bankRef,
    bankTransfers,
    days: [...days].sort((a, b) => a.date - b.date),
    expectedCashTotal,
    variance: cashDepositVariance(bankAmount, expectedCashTotal, transferFee),
    note: (input.note || "").trim(),
  };
}

async function loadOccupancy(excludeDepositId?: string) {
  const entries = await listCashDeposits();
  return buildCashDepositOccupancy(entries, excludeDepositId);
}

/** Newest-first for UI — transferDate then createdAt (client-side). */
function sortCashDepositsNewestFirst(entries: CashDeposit[]): CashDeposit[] {
  return [...entries].sort((a, b) => {
    if (b.transferDate !== a.transferDate) return b.transferDate - a.transferDate;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Single orderBy(createdAt) — no composite index required.
 * (transferDate+createdAt composite may still be building in Firebase Console.)
 */
export function subscribeCashDepositsPage(
  limitCount: number,
  onPage: (page: CashDepositPage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, CASH_DEPOSIT_LIVE_MAX));
  const q = query(cashDepositsCol(), orderBy("createdAt", "desc"), limit(size));
  return onSnapshot(
    q,
    (snap) => {
      onPage({
        entries: sortCashDepositsNewestFirst(snap.docs.map(mapEntry)),
        hasMore: snap.docs.length >= size,
      });
    },
    (err) => onError?.(err as Error),
  );
}

export async function listCashDeposits(max = CASH_DEPOSIT_LIVE_MAX) {
  const q = query(
    cashDepositsCol(),
    orderBy("createdAt", "desc"),
    limit(Math.max(1, Math.min(max, CASH_DEPOSIT_LIVE_MAX))),
  );
  const snap = await getDocs(q);
  return sortCashDepositsNewestFirst(snap.docs.map(mapEntry));
}

export async function addCashDeposit(input: CashDepositInput) {
  const occupancy = await loadOccupancy();
  const payload = buildPayload(input, occupancy);
  const now = Date.now();
  const actor = (input.createdBy || "").trim();
  const ref = await addDoc(cashDepositsCol(), {
    ...payload,
    // พนักงานบันทึก = โอนตามระบบแล้ว · ไม่รอเจ้าของตรวจ
    status: "matched" satisfies CashDepositStatus,
    ownerNote: "",
    verifiedBy: actor,
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export type CashDepositUpdateInput = Omit<CashDepositInput, "createdBy">;

export async function updateCashDeposit(id: string, input: CashDepositUpdateInput) {
  const occupancy = await loadOccupancy(id);
  // createdBy is immutable — pass a placeholder only for shared validation.
  const payload = buildPayload({ ...input, createdBy: "_" }, occupancy, id);
  const { createdBy: _omit, ...rest } = payload;
  void _omit;
  const now = Date.now();
  await updateDoc(doc(getDb(), "cashDeposits", id), {
    ...rest,
    updatedAt: now,
    // ไม่รีเซ็ตเป็นรอตรวจ — พนักงานแก้แล้วยังถือว่าโอนตามระบบ
    status: "matched" satisfies CashDepositStatus,
    verifiedAt: now,
  });
}

export async function verifyCashDeposit(input: {
  id: string;
  status: Exclude<CashDepositStatus, "pending">;
  ownerNote?: string;
  verifiedBy: string;
}) {
  if (!input.verifiedBy.trim()) throw new Error("ไม่พบผู้ตรวจ");
  if (input.status !== "matched" && input.status !== "mismatch" && input.status !== "void") {
    throw new Error("สถานะตรวจไม่ถูกต้อง");
  }
  await updateDoc(doc(getDb(), "cashDeposits", input.id), {
    status: input.status,
    ownerNote: (input.ownerNote || "").trim(),
    verifiedBy: input.verifiedBy.trim(),
    verifiedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function deleteCashDeposit(id: string) {
  await deleteDoc(doc(getDb(), "cashDeposits", id));
}

/** Suggest period start for a round of `dayCount` ending on transferDate (inclusive). */
export function defaultCashPeriodStart(transferDateMs: number, dayCount = 7) {
  const n = Math.max(1, Math.min(CASH_DEPOSIT_DAY_MAX, Math.round(dayCount)));
  return addCalendarDays(cashDepositDayKey(transferDateMs), -(n - 1));
}

export function emptyCashDepositDay(dateMs: number): CashDepositDayLine {
  return {
    id: newCashDepositDayId(),
    date: cashDepositDayKey(dateMs),
    slipKind: "unknown",
    shiftLabel: "",
    cashAmount: 0,
    drawerCloseAmount: 0,
    cashAmountSource: "",
    drawerCloseAmountSource: "",
    dateSource: "",
    note: "",
    slipUrls: [],
    sessionIds: [],
    sessionActualAmounts: {},
  };
}

/** Build N contiguous empty day lines ending on endMs (inclusive). */
export function buildCashDepositRoundDays(endMs: number, dayCount: number): CashDepositDayLine[] {
  const n = Math.max(1, Math.min(CASH_DEPOSIT_DAY_MAX, Math.round(dayCount)));
  const end = cashDepositDayKey(endMs);
  const start = addCalendarDays(end, -(n - 1));
  return calendarDaysInclusive(start, end).map((date) => emptyCashDepositDay(date));
}
