/**
 * Input VAT (ใบกำกับซื้อ) — เจ้าของเท่านั้น
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  computeVatFromGross,
  isDateKey,
  isMonthKey,
  normalizeMoney,
  roundMoney,
} from "./vat-sales";

export const VAT_INPUT_COL = "vatInputInvoices";

export type VatInputInvoice = {
  id: string;
  /** วันที่ในใบกำกับ YYYY-MM-DD */
  dateKey: string;
  monthKey: string;
  vendor: string;
  description: string;
  /** ยอดรวมที่จ่าย (รวม VAT) */
  grossInclusive: number;
  vatBase: number;
  vatInput: number;
  /** evp:… หรือว่าง */
  evidenceRef: string;
  note: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
};

export type VatInputInput = {
  dateKey: string;
  vendor: string;
  description?: string;
  grossInclusive: number;
  /** ถ้าใส่ vatInput โดยตรง จะใช้ค่านั้น (ไม่คำนวณจาก 7%) */
  vatInput?: number;
  evidenceRef?: string;
  note?: string;
};

function mapInvoice(id: string, data: Record<string, unknown>): VatInputInvoice {
  return {
    id,
    dateKey: String(data.dateKey || ""),
    monthKey: String(data.monthKey || ""),
    vendor: String(data.vendor || ""),
    description: String(data.description || ""),
    grossInclusive: normalizeMoney(data.grossInclusive),
    vatBase: normalizeMoney(data.vatBase),
    vatInput: normalizeMoney(data.vatInput),
    evidenceRef: String(data.evidenceRef || ""),
    note: String(data.note || ""),
    createdAt: Number(data.createdAt) || 0,
    createdBy: String(data.createdBy || ""),
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export async function listVatInputInvoices(monthKey: string): Promise<VatInputInvoice[]> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const snap = await getDocs(
    query(collection(getDb(), VAT_INPUT_COL), where("monthKey", "==", monthKey)),
  );
  return snap.docs
    .map((d) => mapInvoice(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export async function createVatInputInvoice(
  input: VatInputInput,
  by: string,
): Promise<VatInputInvoice> {
  if (!isDateKey(input.dateKey)) throw new Error("วันที่ไม่ถูกต้อง");
  const vendor = String(input.vendor || "").trim();
  if (!vendor) throw new Error("ต้องระบุผู้ขาย / ร้าน");
  const grossInclusive = normalizeMoney(input.grossInclusive);
  const computed = computeVatFromGross(grossInclusive);
  const vatInput =
    input.vatInput != null && Number.isFinite(Number(input.vatInput))
      ? normalizeMoney(input.vatInput)
      : computed.vatOutput;
  const vatBase =
    input.vatInput != null
      ? roundMoney(Math.max(0, grossInclusive - vatInput))
      : computed.vatBase;
  const now = Date.now();
  const payload = {
    dateKey: input.dateKey,
    monthKey: input.dateKey.slice(0, 7),
    vendor,
    description: String(input.description || "").trim(),
    grossInclusive,
    vatBase,
    vatInput,
    evidenceRef: String(input.evidenceRef || "").trim(),
    note: String(input.note || "").trim(),
    createdAt: now,
    createdBy: by,
    updatedAt: now,
    updatedBy: by,
  };
  const ref = await addDoc(collection(getDb(), VAT_INPUT_COL), payload);
  return mapInvoice(ref.id, payload);
}

export async function updateVatInputInvoice(
  id: string,
  patch: Partial<VatInputInput>,
  by: string,
): Promise<void> {
  const ref = doc(getDb(), VAT_INPUT_COL, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบใบกำกับ");
  const existing = mapInvoice(id, snap.data() as Record<string, unknown>);

  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
    updatedBy: by,
  };
  if (patch.dateKey) {
    if (!isDateKey(patch.dateKey)) throw new Error("วันที่ไม่ถูกต้อง");
    updates.dateKey = patch.dateKey;
    updates.monthKey = patch.dateKey.slice(0, 7);
  }
  if (patch.vendor != null) updates.vendor = String(patch.vendor).trim();
  if (patch.description != null) updates.description = String(patch.description).trim();
  if (patch.note != null) updates.note = String(patch.note).trim();
  if (patch.evidenceRef != null) updates.evidenceRef = String(patch.evidenceRef).trim();

  if (patch.grossInclusive != null || patch.vatInput != null) {
    const gross =
      patch.grossInclusive != null
        ? normalizeMoney(patch.grossInclusive)
        : existing.grossInclusive;
    updates.grossInclusive = gross;
    if (patch.vatInput != null) {
      const vatInput = normalizeMoney(patch.vatInput);
      updates.vatInput = vatInput;
      updates.vatBase = roundMoney(Math.max(0, gross - vatInput));
    } else {
      const computed = computeVatFromGross(gross);
      updates.vatBase = computed.vatBase;
      updates.vatInput = computed.vatOutput;
    }
  }
  await setDoc(ref, updates, { merge: true });
}

export async function deleteVatInputInvoice(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), VAT_INPUT_COL, id));
}

export function sumVatInput(rows: VatInputInvoice[]): {
  grossInclusive: number;
  vatBase: number;
  vatInput: number;
  count: number;
} {
  return rows.reduce(
    (acc, r) => ({
      grossInclusive: roundMoney(acc.grossInclusive + r.grossInclusive),
      vatBase: roundMoney(acc.vatBase + r.vatBase),
      vatInput: roundMoney(acc.vatInput + r.vatInput),
      count: acc.count + 1,
    }),
    { grossInclusive: 0, vatBase: 0, vatInput: 0, count: 0 },
  );
}
