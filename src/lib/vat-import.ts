/**
 * VAT นำเข้าไฟล์จริง — แถววัน × ช่องทาง · Firebase Storage
 * สเปก: docs/vat-import-phases.md (I0–I2)
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { getDb, getFirebaseAuth, getFirebaseStorage } from "./firebase";
import {
  isMonthKey,
  normalizeMoney,
  type DeliveryChannel,
} from "./vat-sales";

export const VAT_IMPORT_ROWS_COL = "vatImportRows";
export const VAT_IMPORT_STORAGE_PREFIX = "vat-imports";

/** ขีดจำกัดไฟล์นำเข้า (ไบต์) */
export const VAT_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

export type VatImportChannel = DeliveryChannel | "storefront";

export type VatImportRowKind = "sales" | "transfer" | "tax_invoice";

export type VatImportRowStatus = "draft" | "applied" | "skipped";

export const VAT_IMPORT_CHANNEL_LABELS: Record<VatImportChannel, string> = {
  shopee: "ShopeeFood",
  grab: "Grab",
  lineman: "LINE MAN",
  storefront: "หน้าร้าน",
};

export const VAT_IMPORT_KIND_LABELS: Record<VatImportRowKind, string> = {
  sales: "ยอดขาย",
  transfer: "ยอดโอน",
  tax_invoice: "ใบกำกับ",
};

export type VatImportRow = {
  id: string;
  monthKey: string;
  dateKey: string;
  channel: VatImportChannel;
  rowKind: VatImportRowKind;
  grossInclusive: number;
  fee: number;
  netTransfer: number;
  gpVat: number;
  invoiceNo: string;
  invoiceDate: string;
  sellerTaxId: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  contentHash: string;
  adapterId: string;
  adapterVersion: string;
  externalId: string;
  status: VatImportRowStatus;
  note: string;
  appliedAt: number | null;
  appliedToMonth: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type VatImportRowInput = Partial<
  Omit<VatImportRow, "id" | "createdAt" | "updatedAt" | "updatedBy">
> & {
  monthKey: string;
  dateKey: string;
  channel: VatImportChannel;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function monthKeyFromDateKey(dateKey: string): string {
  if (!isDateKey(dateKey)) return "";
  return dateKey.slice(0, 7);
}

export function mapVatImportChannel(raw: unknown): VatImportChannel {
  if (
    raw === "shopee" ||
    raw === "grab" ||
    raw === "lineman" ||
    raw === "storefront"
  ) {
    return raw;
  }
  return "grab";
}

export function mapVatImportRowKind(raw: unknown): VatImportRowKind {
  if (raw === "transfer" || raw === "tax_invoice" || raw === "sales") return raw;
  return "sales";
}

export function mapVatImportStatus(raw: unknown): VatImportRowStatus {
  if (raw === "applied" || raw === "skipped" || raw === "draft") return raw;
  return "draft";
}

/** คีย์ไม่ซ้ำตามสเปก I0 */
export function vatImportDedupeKey(row: {
  channel: VatImportChannel;
  externalId?: string;
  invoiceNo?: string;
  dateKey: string;
  rowKind: VatImportRowKind;
}): string {
  const ch = row.channel;
  const ext = String(row.externalId || "").trim();
  if (ext) return `${ch}|ext:${ext}`;
  const inv = String(row.invoiceNo || "").trim();
  if (inv) return `${ch}|inv:${inv}`;
  return `${ch}|${row.dateKey}|${row.rowKind}`;
}

export function emptyVatImportRow(
  monthKey: string,
  patch: Partial<VatImportRowInput> = {},
): VatImportRowInput {
  const dateKey =
    patch.dateKey && isDateKey(patch.dateKey)
      ? patch.dateKey
      : isMonthKey(monthKey)
        ? `${monthKey}-01`
        : "";
  return {
    monthKey: isMonthKey(monthKey) ? monthKey : monthKeyFromDateKey(dateKey),
    dateKey,
    channel: mapVatImportChannel(patch.channel),
    rowKind: mapVatImportRowKind(patch.rowKind),
    grossInclusive: 0,
    fee: 0,
    netTransfer: 0,
    gpVat: 0,
    invoiceNo: "",
    invoiceDate: "",
    sellerTaxId: "",
    storagePath: "",
    downloadUrl: "",
    fileName: "",
    contentType: "",
    contentHash: "",
    adapterId: "manual",
    adapterVersion: "1",
    externalId: "",
    status: "draft",
    note: "",
    appliedAt: null,
    appliedToMonth: "",
    ...patch,
  };
}

function mapRow(id: string, raw: DocumentData): VatImportRow {
  const dateKey = String(raw.dateKey || "");
  const monthKey = isMonthKey(String(raw.monthKey || ""))
    ? String(raw.monthKey)
    : monthKeyFromDateKey(dateKey);
  return {
    id,
    monthKey,
    dateKey,
    channel: mapVatImportChannel(raw.channel),
    rowKind: mapVatImportRowKind(raw.rowKind),
    grossInclusive: normalizeMoney(raw.grossInclusive),
    fee: normalizeMoney(raw.fee),
    netTransfer: normalizeMoney(raw.netTransfer),
    gpVat: normalizeMoney(raw.gpVat),
    invoiceNo: String(raw.invoiceNo || "").trim(),
    invoiceDate: String(raw.invoiceDate || "").trim(),
    sellerTaxId: String(raw.sellerTaxId || "").trim(),
    storagePath: String(raw.storagePath || "").trim(),
    downloadUrl: String(raw.downloadUrl || "").trim(),
    fileName: String(raw.fileName || "").trim(),
    contentType: String(raw.contentType || "").trim(),
    contentHash: String(raw.contentHash || "").trim(),
    adapterId: String(raw.adapterId || "manual").trim() || "manual",
    adapterVersion: String(raw.adapterVersion || "1").trim() || "1",
    externalId: String(raw.externalId || "").trim(),
    status: mapVatImportStatus(raw.status),
    note: String(raw.note || "").trim(),
    appliedAt:
      typeof raw.appliedAt === "number" && Number.isFinite(raw.appliedAt)
        ? raw.appliedAt
        : null,
    appliedToMonth: String(raw.appliedToMonth || "").trim(),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

function toFirestorePayload(
  input: VatImportRowInput,
  actor: string,
  now: number,
  createdAt?: number,
): DocumentData {
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  if (!isDateKey(input.dateKey)) throw new Error("วันที่ไม่ถูกต้อง");
  const monthFromDate = monthKeyFromDateKey(input.dateKey);
  if (monthFromDate !== input.monthKey) {
    throw new Error("วันที่ไม่อยู่ในเดือนที่เลือก");
  }
  return {
    monthKey: input.monthKey,
    dateKey: input.dateKey,
    channel: mapVatImportChannel(input.channel),
    rowKind: mapVatImportRowKind(input.rowKind),
    grossInclusive: normalizeMoney(input.grossInclusive),
    fee: normalizeMoney(input.fee),
    netTransfer: normalizeMoney(input.netTransfer),
    gpVat: normalizeMoney(input.gpVat),
    invoiceNo: String(input.invoiceNo || "").trim().slice(0, 80),
    invoiceDate: String(input.invoiceDate || "").trim().slice(0, 32),
    sellerTaxId: String(input.sellerTaxId || "").trim().slice(0, 32),
    storagePath: String(input.storagePath || "").trim().slice(0, 500),
    downloadUrl: String(input.downloadUrl || "").trim().slice(0, 2000),
    fileName: String(input.fileName || "").trim().slice(0, 240),
    contentType: String(input.contentType || "").trim().slice(0, 120),
    contentHash: String(input.contentHash || "").trim().slice(0, 128),
    adapterId: String(input.adapterId || "manual").trim().slice(0, 64) || "manual",
    adapterVersion:
      String(input.adapterVersion || "1").trim().slice(0, 32) || "1",
    externalId: String(input.externalId || "").trim().slice(0, 120),
    status: mapVatImportStatus(input.status),
    note: String(input.note || "").trim().slice(0, 500),
    appliedAt:
      typeof input.appliedAt === "number" && Number.isFinite(input.appliedAt)
        ? input.appliedAt
        : null,
    appliedToMonth: String(input.appliedToMonth || "").trim().slice(0, 7),
    createdAt: createdAt ?? now,
    updatedAt: now,
    updatedBy: actor,
  };
}

export async function listVatImportRows(monthKey: string): Promise<VatImportRow[]> {
  if (!isMonthKey(monthKey)) return [];
  const q = query(
    collection(getDb(), VAT_IMPORT_ROWS_COL),
    where("monthKey", "==", monthKey),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => mapRow(d.id, d.data()))
    .sort((a, b) => {
      const dcmp = a.dateKey.localeCompare(b.dateKey);
      if (dcmp !== 0) return dcmp;
      return a.channel.localeCompare(b.channel);
    });
}

export async function createVatImportRow(
  input: VatImportRowInput,
  actor: string,
): Promise<VatImportRow> {
  const now = Date.now();
  const payload = toFirestorePayload(input, actor, now);
  const ref = await addDoc(collection(getDb(), VAT_IMPORT_ROWS_COL), payload);
  return mapRow(ref.id, payload);
}

export async function updateVatImportRow(
  id: string,
  input: VatImportRowInput,
  actor: string,
  createdAt: number,
): Promise<VatImportRow> {
  const now = Date.now();
  const payload = toFirestorePayload(input, actor, now, createdAt || now);
  await setDoc(doc(getDb(), VAT_IMPORT_ROWS_COL, id), payload, { merge: true });
  return mapRow(id, payload);
}

export async function patchVatImportRow(
  id: string,
  patch: Partial<VatImportRowInput>,
  actor: string,
): Promise<void> {
  const now = Date.now();
  const data: DocumentData = { updatedAt: now, updatedBy: actor };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    data[k] = v;
  }
  await updateDoc(doc(getDb(), VAT_IMPORT_ROWS_COL, id), data);
}

export async function deleteVatImportRow(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), VAT_IMPORT_ROWS_COL, id));
}

function safeFileName(name: string): string {
  const base = String(name || "file")
    .replace(/[^\w.\-()\u0E00-\u0E7F]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return base || "file";
}

export function isAllowedVatImportFile(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  const n = (file.name || "").toLowerCase();
  if (file.size <= 0 || file.size > VAT_IMPORT_MAX_BYTES) return false;
  if (
    t === "application/pdf" ||
    t === "text/csv" ||
    t === "application/vnd.ms-excel" ||
    t ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    t.startsWith("image/")
  ) {
    return true;
  }
  return (
    n.endsWith(".pdf") ||
    n.endsWith(".csv") ||
    n.endsWith(".xls") ||
    n.endsWith(".xlsx") ||
    n.endsWith(".png") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".webp")
  );
}

export function guessContentType(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** อัปโหลดไฟล์นำเข้า → Storage path ตามสเปก */
export async function uploadVatImportFile(input: {
  file: File;
  monthKey: string;
  channel: VatImportChannel;
}): Promise<{
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
}> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  if (!isAllowedVatImportFile(input.file)) {
    throw new Error("รองรับ PDF / Excel / CSV / รูป · สูงสุด 25MB");
  }
  const [yyyy, mm] = input.monthKey.split("-");
  const uploadId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const fileName = safeFileName(input.file.name);
  const storagePath = `${VAT_IMPORT_STORAGE_PREFIX}/${yyyy}/${mm}/${input.channel}/${uploadId}-${fileName}`;
  const contentType = guessContentType(input.file);
  const ref = storageRef(getFirebaseStorage(), storagePath);
  await uploadBytes(ref, input.file, { contentType });
  const downloadUrl = await getDownloadURL(ref);
  return { storagePath, downloadUrl, fileName, contentType };
}

/** รวมยอดแถว draft ในเดือน — ใช้ตอน I5 / ดูภาพรวม */
export function sumVatImportDraftByChannel(rows: VatImportRow[]): Record<
  VatImportChannel,
  { gross: number; netTransfer: number; gpVat: number; count: number }
> {
  const empty = () => ({ gross: 0, netTransfer: 0, gpVat: 0, count: 0 });
  const out: Record<
    VatImportChannel,
    { gross: number; netTransfer: number; gpVat: number; count: number }
  > = {
    shopee: empty(),
    grab: empty(),
    lineman: empty(),
    storefront: empty(),
  };
  for (const r of rows) {
    if (r.status === "skipped") continue;
    const b = out[r.channel];
    b.gross = normalizeMoney(b.gross + r.grossInclusive);
    b.netTransfer = normalizeMoney(b.netTransfer + r.netTransfer);
    b.gpVat = normalizeMoney(b.gpVat + r.gpVat);
    b.count += 1;
  }
  return out;
}
