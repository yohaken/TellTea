import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  buildExpenseVatPayerPayload,
  normalizeExpenseVatPayer,
  type ExpenseVatPayerFields,
} from "./expense-vat";
import {
  reconcileExpenseVatInputInvoice,
  withSyncedVatInputId,
} from "./expense-vat-sync";
import { guessTypeFromDescription } from "./ledger-labels";
import { addOwnerBookEntry, updateOwnerBookEntry } from "./owner-books";

export const BILL_NOTICE_PAGE_SIZE = 40;
export const BILL_NOTICE_LIVE_MAX = 200;
/** Max bill photos per notice row */
export const BILL_NOTICE_RECEIPT_MAX = 6;

export type BillNoticeStatus = "pending" | "accepted" | "rejected" | "void";

export type BillNotice = {
  id: string;
  date: number;
  description: string;
  amountOut: number;
  type: string;
  typeSource: string;
  typeAiReason: string;
  note: string;
  receiptUrl: string;
  receiptUrls: string[];
  createdBy: string;
  staffName: string;
  createdAt: number;
  updatedAt: number;
  status: BillNoticeStatus;
  ownerNote: string;
  verifiedBy: string;
  verifiedAt: number;
  /** Set when accepted into บช.เจ้าของ */
  ownerBookId: string;
} & ExpenseVatPayerFields;

export type BillNoticeInput = {
  date: number;
  description: string;
  amountOut: number;
  type?: string;
  typeSource?: string;
  typeAiReason?: string;
  note?: string;
  receiptUrl?: string;
  receiptUrls?: string[];
  createdBy: string;
  staffName: string;
} & Partial<ExpenseVatPayerFields>;

export type BillNoticePage = {
  entries: BillNotice[];
  hasMore: boolean;
};

export type BillNoticeSummary = {
  pendingCount: number;
  pendingSum: number;
  acceptedCount: number;
  acceptedSum: number;
  rejectedCount: number;
  voidCount: number;
  /** Group pending+accepted by description bucket */
  byLabel: { label: string; count: number; sum: number }[];
};

const STATUS_SET = new Set<BillNoticeStatus>([
  "pending",
  "accepted",
  "rejected",
  "void",
]);

/** Quick chips for staff — utilities + other. */
export const BILL_NOTICE_PRESETS = [
  "ค่าไฟ",
  "ค่าน้ำ",
  "ค่าแก๊ส",
  "ค่าเน็ต",
  "อื่นๆ",
] as const;

function billNoticesCol() {
  return collection(getDb(), "billNotices");
}

function normalizeUrls(urls: unknown, max: number): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map(String).map((u) => u.trim()).filter(Boolean).slice(0, max);
}

function normalizeReceiptFields(input: {
  receiptUrl?: string;
  receiptUrls?: string[];
}): { receiptUrl: string; receiptUrls: string[] } {
  const fromList = normalizeUrls(input.receiptUrls, BILL_NOTICE_RECEIPT_MAX);
  const legacy = (input.receiptUrl || "").trim();
  const urls = (fromList.length ? fromList : legacy ? [legacy] : []).slice(
    0,
    BILL_NOTICE_RECEIPT_MAX,
  );
  return { receiptUrl: urls[0] || "", receiptUrls: urls };
}

export function getBillNoticeReceiptUrls(
  entry?: Pick<BillNotice, "receiptUrl" | "receiptUrls"> | null,
): string[] {
  if (!entry) return [];
  return normalizeReceiptFields(entry).receiptUrls;
}

function mapData(id: string, data: Record<string, unknown>): BillNotice {
  const createdAt = Number(data.createdAt) || 0;
  const { receiptUrl, receiptUrls } = normalizeReceiptFields({
    receiptUrl: typeof data.receiptUrl === "string" ? data.receiptUrl : "",
    receiptUrls: data.receiptUrls as string[] | undefined,
  });
  const statusRaw = String(data.status || "pending") as BillNoticeStatus;
  const vat = normalizeExpenseVatPayer(data);
  return {
    id,
    date: Number(data.date) || 0,
    description: typeof data.description === "string" ? data.description : "",
    amountOut: Number(data.amountOut) || 0,
    type: typeof data.type === "string" ? data.type : "",
    typeSource: typeof data.typeSource === "string" ? data.typeSource : "",
    typeAiReason: typeof data.typeAiReason === "string" ? data.typeAiReason : "",
    note: typeof data.note === "string" ? data.note : "",
    receiptUrl,
    receiptUrls,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    staffName: typeof data.staffName === "string" ? data.staffName : "",
    createdAt,
    updatedAt: Number(data.updatedAt) || createdAt,
    status: STATUS_SET.has(statusRaw) ? statusRaw : "pending",
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : "",
    verifiedBy: typeof data.verifiedBy === "string" ? data.verifiedBy : "",
    verifiedAt: Number(data.verifiedAt) || 0,
    ownerBookId: typeof data.ownerBookId === "string" ? data.ownerBookId : "",
    ...vat,
  };
}

function mapEntry(d: QueryDocumentSnapshot): BillNotice {
  return mapData(d.id, d.data() as Record<string, unknown>);
}

function sortNewestFirst(entries: BillNotice[]): BillNotice[] {
  return [...entries].sort((a, b) => {
    if (b.date !== a.date) return b.date - a.date;
    return b.createdAt - a.createdAt;
  });
}

export function labelBillNoticeStatus(status: BillNoticeStatus) {
  switch (status) {
    case "accepted":
      return "เข้าร้านแล้ว";
    case "rejected":
      return "ไม่รับ";
    case "void":
      return "ยกเลิก";
    default:
      return "รอเจ้าของ";
  }
}

/** Compact single-line status for slim table */
export function shortLabelBillNoticeStatus(status: BillNoticeStatus) {
  switch (status) {
    case "accepted":
      return "เข้าแล้ว";
    case "rejected":
      return "ไม่รับ";
    case "void":
      return "ยกเลิก";
    default:
      return "รอ";
  }
}

/** Bucket label for analysis (ค่าไฟ / ค่าน้ำ / …). */
export function billNoticeBucketLabel(description: string): string {
  const t = description.trim().toLowerCase();
  if (!t) return "อื่นๆ";
  if (t.includes("ค่าไฟ") || t.includes("ไฟฟ้า") || t === "ไฟ") return "ค่าไฟ";
  if (t.includes("ค่าน้ำ") || t.includes("ประปา") || t === "น้ำ") return "ค่าน้ำ";
  if (t.includes("ค่าแก๊ส") || t.includes("แก๊ส") || t.includes("gas")) return "ค่าแก๊ส";
  if (
    t.includes("ค่าเน็ต") ||
    t.includes("เน็ต") ||
    t.includes("อินเทอร์เน็ต") ||
    t.includes("internet") ||
    t.includes("wifi")
  ) {
    return "ค่าเน็ต";
  }
  return "อื่นๆ";
}

/**
 * Ready to merge into บช.เจ้าของ when date / description / amount / bill photo
 * are present in the correct shape.
 */
export function isBillNoticeReadyForOwnerBooks(
  entry: Pick<BillNotice, "date" | "description" | "amountOut" | "receiptUrl" | "receiptUrls">,
): { ok: true } | { ok: false; message: string } {
  if (!(Number(entry.date) > 0)) {
    return { ok: false, message: "ต้องใส่วันที่บิล" };
  }
  if (!String(entry.description || "").trim()) {
    return { ok: false, message: "ต้องใส่รายการ" };
  }
  if (!(Number(entry.amountOut) > 0)) {
    return { ok: false, message: "ต้องใส่จำนวนเงินออก" };
  }
  const urls = getBillNoticeReceiptUrls(entry);
  if (!urls.length) {
    return { ok: false, message: "ต้องอัพรูปบิลก่อนรวมเข้า บช.เจ้าของ" };
  }
  if (urls.some((u) => u.startsWith("data:"))) {
    return { ok: false, message: "รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่" };
  }
  return { ok: true };
}

export function summarizeBillNotices(entries: BillNotice[]): BillNoticeSummary {
  let pendingCount = 0;
  let pendingSum = 0;
  let acceptedCount = 0;
  let acceptedSum = 0;
  let rejectedCount = 0;
  let voidCount = 0;
  const bucket = new Map<string, { count: number; sum: number }>();

  for (const e of entries) {
    const out = Number(e.amountOut) || 0;
    if (e.status === "pending") {
      pendingCount += 1;
      pendingSum += out;
    } else if (e.status === "accepted") {
      acceptedCount += 1;
      acceptedSum += out;
    } else if (e.status === "rejected") {
      rejectedCount += 1;
    } else if (e.status === "void") {
      voidCount += 1;
    }

    if (e.status === "pending" || e.status === "accepted") {
      const label = billNoticeBucketLabel(e.description);
      const prev = bucket.get(label) || { count: 0, sum: 0 };
      bucket.set(label, { count: prev.count + 1, sum: prev.sum + out });
    }
  }

  const order = ["ค่าไฟ", "ค่าน้ำ", "ค่าแก๊ส", "ค่าเน็ต", "อื่นๆ"];
  const byLabel = order
    .filter((label) => bucket.has(label))
    .map((label) => {
      const b = bucket.get(label)!;
      return { label, count: b.count, sum: b.sum };
    });

  return {
    pendingCount,
    pendingSum,
    acceptedCount,
    acceptedSum,
    rejectedCount,
    voidCount,
    byLabel,
  };
}

function validatePayload(payload: {
  description: string;
  amountOut: number;
  createdBy: string;
  date: number;
}) {
  if (!payload.createdBy.trim()) throw new Error("ไม่พบผู้บันทึก");
  if (!(payload.date > 0)) throw new Error("ต้องใส่วันที่บิล");
  if (!payload.description.trim()) throw new Error("ต้องใส่รายการ");
  if (!(payload.amountOut > 0)) throw new Error("ต้องใส่จำนวนเงินออก");
}

function buildPayload(input: BillNoticeInput) {
  const { receiptUrl, receiptUrls } = normalizeReceiptFields({
    receiptUrl: input.receiptUrl,
    receiptUrls: input.receiptUrls,
  });
  if (receiptUrls.some((u) => u.startsWith("data:"))) {
    throw new Error("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่");
  }
  const description = input.description.trim();
  const guessed =
    (input.type || "").trim() || guessTypeFromDescription(description) || "sga";
  // Bill notices are owner utilities — never default free-text to cogs.
  const type = guessed === "cogs" ? "sga" : guessed;
  const amountOut = Number(input.amountOut) || 0;
  const vat = buildExpenseVatPayerPayload(input, amountOut);
  const payload = {
    date: Number(input.date) || 0,
    description,
    amountOut,
    type,
    typeSource: (input.typeSource || (input.type ? "staff" : "heuristic")).trim(),
    typeAiReason: (input.typeAiReason || "").trim(),
    note: (input.note || "").trim(),
    receiptUrl,
    receiptUrls,
    createdBy: input.createdBy.trim(),
    staffName: input.staffName.trim(),
    ...vat,
  };
  validatePayload(payload);
  return payload;
}

/**
 * Single orderBy(createdAt) — no composite index required.
 * Client re-sorts by date then createdAt.
 */
export function subscribeBillNoticesPage(
  limitCount: number,
  onPage: (page: BillNoticePage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, BILL_NOTICE_LIVE_MAX));
  const q = query(billNoticesCol(), orderBy("createdAt", "desc"), limit(size));
  return onSnapshot(
    q,
    (snap) => {
      onPage({
        entries: sortNewestFirst(snap.docs.map(mapEntry)),
        hasMore: snap.docs.length >= size,
      });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function addBillNotice(input: BillNoticeInput): Promise<string> {
  const payload = buildPayload(input);
  const now = Date.now();
  const ref = await addDoc(billNoticesCol(), {
    ...payload,
    status: "pending" satisfies BillNoticeStatus,
    ownerNote: "",
    verifiedBy: "",
    verifiedAt: 0,
    ownerBookId: "",
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export type BillNoticeUpdateInput = Omit<BillNoticeInput, "createdBy" | "staffName"> & {
  staffName?: string;
};

export async function updateBillNotice(
  id: string,
  input: BillNoticeUpdateInput,
): Promise<void> {
  const entryRef = doc(getDb(), "billNotices", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการแจ้งบิล");
  const prev = mapData(prevSnap.id, prevSnap.data() as Record<string, unknown>);
  if (prev.status !== "pending") {
    throw new Error("แก้ได้เฉพาะรายการที่รอเจ้าของ");
  }
  const payload = buildPayload({
    ...input,
    createdBy: prev.createdBy || "_",
    staffName: (input.staffName ?? prev.staffName) || "",
  });
  const { createdBy: _omit, ...rest } = payload;
  void _omit;
  await updateDoc(entryRef, {
    ...rest,
    updatedAt: Date.now(),
    status: "pending" satisfies BillNoticeStatus,
    verifiedBy: "",
    verifiedAt: 0,
    ownerBookId: "",
  });
}

/**
 * Owner accepts a pending bill → create บช.เจ้าของ row, mark notice accepted.
 * Requires ownerBooks permission (client + rules).
 */
export async function acceptBillNotice(input: {
  id: string;
  verifiedBy: string;
  ownerNote?: string;
  /** Override type when accepting (owner) */
  type?: string;
}): Promise<string> {
  if (!input.verifiedBy.trim()) throw new Error("ไม่พบผู้รับบิล");
  const entryRef = doc(getDb(), "billNotices", input.id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการแจ้งบิล");
  const prev = mapData(prevSnap.id, prevSnap.data() as Record<string, unknown>);
  if (prev.status !== "pending") {
    throw new Error("รับได้เฉพาะรายการที่รอเจ้าของ");
  }
  const ready = isBillNoticeReadyForOwnerBooks(prev);
  if (!ready.ok) throw new Error(ready.message);

  const type =
    (input.type || "").trim() ||
    prev.type ||
    guessTypeFromDescription(prev.description) ||
    "sga";

  const vat = buildExpenseVatPayerPayload(prev, prev.amountOut);
  const note = [prev.note, input.ownerNote]
    .filter((s) => String(s || "").trim())
    .join(" · ");
  const ownerBookId = await addOwnerBookEntry({
    date: prev.date,
    description: prev.description.trim(),
    amountOut: prev.amountOut,
    type,
    typeSource: input.type ? "owner" : prev.typeSource || "staff",
    typeAiReason: prev.typeAiReason || "",
    createdBy: input.verifiedBy.trim(),
    receiptUrl: prev.receiptUrl,
    receiptUrls: prev.receiptUrls,
    note,
    ...vat,
  });

  let linkedVat = vat;
  try {
    const synced = await reconcileExpenseVatInputInvoice(
      {
        dateMs: prev.date,
        amountOut: prev.amountOut,
        description: prev.description.trim(),
        note,
        evidenceRef: prev.receiptUrl || prev.receiptUrls[0] || "",
        fields: vat,
      },
      input.verifiedBy.trim(),
    );
    linkedVat = withSyncedVatInputId(vat, synced.vatInputInvoiceId);
    if (linkedVat.vatInputInvoiceId !== vat.vatInputInvoiceId) {
      await updateOwnerBookEntry(ownerBookId, linkedVat);
    }
  } catch {
    /* ภาษีซื้อลิงก์ไม่สำเร็จ — บิลยังรับเข้าแล้ว */
  }

  await updateDoc(entryRef, {
    status: "accepted" satisfies BillNoticeStatus,
    ownerBookId,
    ownerNote: (input.ownerNote || "").trim(),
    verifiedBy: input.verifiedBy.trim(),
    verifiedAt: Date.now(),
    updatedAt: Date.now(),
    type,
    ...linkedVat,
  });

  return ownerBookId;
}

export async function rejectBillNotice(input: {
  id: string;
  verifiedBy: string;
  ownerNote?: string;
  status?: "rejected" | "void";
}): Promise<void> {
  if (!input.verifiedBy.trim()) throw new Error("ไม่พบผู้ตรวจ");
  const nextStatus = input.status || "rejected";
  if (nextStatus !== "rejected" && nextStatus !== "void") {
    throw new Error("สถานะไม่ถูกต้อง");
  }
  const entryRef = doc(getDb(), "billNotices", input.id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการแจ้งบิล");
  const prev = mapData(prevSnap.id, prevSnap.data() as Record<string, unknown>);
  if (prev.status !== "pending") {
    throw new Error("ตรวจได้เฉพาะรายการที่รอเจ้าของ");
  }
  await updateDoc(entryRef, {
    status: nextStatus,
    ownerNote: (input.ownerNote || "").trim(),
    verifiedBy: input.verifiedBy.trim(),
    verifiedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function deleteBillNotice(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "billNotices", id));
}
