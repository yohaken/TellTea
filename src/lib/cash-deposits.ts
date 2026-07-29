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
/** Bank e-slip photos per deposit */
export const CASH_DEPOSIT_BANK_SLIP_MAX = 6;
/** POS shift/daily summary photos per day line */
export const CASH_DEPOSIT_DAY_SLIP_MAX = 4;
/** Typical batch is 7–10 days; hard cap keeps Firestore docs small */
export const CASH_DEPOSIT_DAY_MAX = 14;

export type CashSlipKind = "daily" | "shift" | "unknown";

export type CashDepositStatus = "pending" | "matched" | "mismatch" | "void";

export type CashDepositDayLine = {
  id: string;
  /** Local midnight ms of the sales day on the slip */
  date: number;
  slipKind: CashSlipKind;
  /** Free label e.g. กะเช้า / กะเย็น — useful when slipKind is shift */
  shiftLabel: string;
  /** Cash amount read from the POS summary slip */
  cashAmount: number;
  note: string;
  slipUrls: string[];
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
  /** Amount on the bank transfer slip */
  bankAmount: number;
  bankSlipUrls: string[];
  bankRef: string;
  days: CashDepositDayLine[];
  expectedCashTotal: number;
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
  bankAmount: number;
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

export function sumCashDepositDays(days: Pick<CashDepositDayLine, "cashAmount">[]) {
  return days.reduce((sum, d) => sum + (Number(d.cashAmount) || 0), 0);
}

export function cashDepositVariance(bankAmount: number, expectedCashTotal: number) {
  return Math.round((Number(bankAmount) - Number(expectedCashTotal)) * 100) / 100;
}

export function labelCashDepositStatus(status: CashDepositStatus) {
  switch (status) {
    case "matched":
      return "ตรง";
    case "mismatch":
      return "ไม่ตรง";
    case "void":
      return "ยกเลิก";
    default:
      return "รอตรวจ";
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
  return {
    id: String(d.id || newCashDepositDayId()),
    date: Number(d.date) || 0,
    slipKind,
    shiftLabel: typeof d.shiftLabel === "string" ? d.shiftLabel : "",
    cashAmount,
    note: typeof d.note === "string" ? d.note : "",
    slipUrls: normalizeUrls(d.slipUrls, CASH_DEPOSIT_DAY_SLIP_MAX),
  };
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
  const bankAmount = Number(data.bankAmount) || 0;
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
    bankSlipUrls: normalizeUrls(data.bankSlipUrls, CASH_DEPOSIT_BANK_SLIP_MAX),
    bankRef: typeof data.bankRef === "string" ? data.bankRef : "",
    days,
    expectedCashTotal,
    variance:
      Number.isFinite(Number(data.variance))
        ? Number(data.variance)
        : cashDepositVariance(bankAmount, expectedCashTotal),
    status: STATUS_SET.has(statusRaw) ? statusRaw : "pending",
    note: typeof data.note === "string" ? data.note : "",
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : "",
    verifiedBy: typeof data.verifiedBy === "string" ? data.verifiedBy : "",
    verifiedAt: Number(data.verifiedAt) || 0,
  };
}

function validateDays(days: CashDepositDayLine[]) {
  if (!days.length) throw new Error("ต้องมีอย่างน้อย 1 วันจากสลิป POS");
  if (days.length > CASH_DEPOSIT_DAY_MAX) {
    throw new Error(`ช่วงเงินสดยาวเกินไป (สูงสุด ${CASH_DEPOSIT_DAY_MAX} วัน)`);
  }
  for (const day of days) {
    if (!day.date) throw new Error("ต้องใส่วันที่บนสลิปทุกแถว");
    if (!(day.cashAmount > 0)) throw new Error("ยอดเงินสดในสลิปต้องมากกว่า 0");
  }
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

function buildPayload(input: CashDepositInput) {
  if (!input.createdBy.trim()) throw new Error("ไม่พบผู้บันทึก");
  if (!input.staffName.trim()) throw new Error("ต้องใส่ชื่อพนักงานที่โอน");
  if (!input.transferDate) throw new Error("ต้องใส่วันที่โอนเข้าบัญชี");
  if (!(input.bankAmount > 0)) throw new Error("ต้องใส่ยอดโอนธนาคาร");
  const days = normalizeInputDays(input.days);
  validateDays(days);
  const periodStart = input.periodStart || Math.min(...days.map((d) => d.date));
  const periodEnd = input.periodEnd || Math.max(...days.map((d) => d.date));
  if (periodEnd < periodStart) throw new Error("ช่วงวันไม่ถูกต้อง");
  const expectedCashTotal = sumCashDepositDays(days);
  const bankSlipUrls = normalizeUrls(input.bankSlipUrls, CASH_DEPOSIT_BANK_SLIP_MAX);
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
    bankAmount: Number(input.bankAmount),
    bankSlipUrls,
    bankRef: (input.bankRef || "").trim(),
    days,
    expectedCashTotal,
    variance: cashDepositVariance(input.bankAmount, expectedCashTotal),
    note: (input.note || "").trim(),
  };
}

export function subscribeCashDepositsPage(
  limitCount: number,
  onPage: (page: CashDepositPage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, CASH_DEPOSIT_LIVE_MAX));
  const q = query(
    cashDepositsCol(),
    orderBy("transferDate", "desc"),
    orderBy("createdAt", "desc"),
    limit(size),
  );
  return onSnapshot(
    q,
    (snap) => {
      onPage({
        entries: snap.docs.map(mapEntry),
        hasMore: snap.docs.length >= size,
      });
    },
    (err) => onError?.(err as Error),
  );
}

export async function listCashDeposits(max = CASH_DEPOSIT_LIVE_MAX) {
  const q = query(
    cashDepositsCol(),
    orderBy("transferDate", "desc"),
    orderBy("createdAt", "desc"),
    limit(Math.max(1, Math.min(max, CASH_DEPOSIT_LIVE_MAX))),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapEntry);
}

export async function addCashDeposit(input: CashDepositInput) {
  const payload = buildPayload(input);
  const now = Date.now();
  const ref = await addDoc(cashDepositsCol(), {
    ...payload,
    status: "pending" satisfies CashDepositStatus,
    ownerNote: "",
    verifiedBy: "",
    verifiedAt: 0,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export type CashDepositUpdateInput = Omit<CashDepositInput, "createdBy">;

export async function updateCashDeposit(id: string, input: CashDepositUpdateInput) {
  // createdBy is immutable — pass a placeholder only for shared validation.
  const payload = buildPayload({ ...input, createdBy: "_" });
  const { createdBy: _omit, ...rest } = payload;
  void _omit;
  await updateDoc(doc(getDb(), "cashDeposits", id), {
    ...rest,
    updatedAt: Date.now(),
    // Editing resets verify state — owner must re-check.
    status: "pending" satisfies CashDepositStatus,
    verifiedBy: "",
    verifiedAt: 0,
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

/** Suggest period start = transferDate − 9 days (≈10 calendar days incl. transfer day). */
export function defaultCashPeriodStart(transferDateMs: number) {
  const d = new Date(transferDateMs);
  d.setDate(d.getDate() - 9);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function emptyCashDepositDay(dateMs: number): CashDepositDayLine {
  return {
    id: newCashDepositDayId(),
    date: dateMs,
    slipKind: "unknown",
    shiftLabel: "",
    cashAmount: 0,
    note: "",
    slipUrls: [],
  };
}
