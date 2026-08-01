/**
 * พรีวิวแคป AI ต่อเดือน — เซฟยอด + รูปไว้ใน Firestore/Storage
 * ยังไม่เข้างบจนกว่าจะกดส่งเข้าตารางหลัก
 */
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { getDb, getFirebaseAuth, getFirebaseStorage } from "./firebase";
import { hashFileSha256 } from "./vat-import-hash";
import { guessContentType, VAT_IMPORT_STORAGE_PREFIX } from "./vat-import";
import {
  MONTH_CHANNELS,
  type MonthChannel,
} from "./vat-month-books";
import { isMonthKey, normalizeMoney } from "./vat-sales";

export const VAT_DELIVERY_INGEST_DRAFTS_COL = "vatDeliveryIngestDrafts";

export type IngestDraftAmounts = {
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
};

export type IngestDraftImage = {
  id: string;
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  contentHash: string;
  channel: MonthChannel | "unknown";
};

export type VatDeliveryIngestDraft = {
  monthKey: string;
  byChannel: Record<MonthChannel, IngestDraftAmounts>;
  images: IngestDraftImage[];
  updatedAt: number;
  updatedBy: string;
};

export function emptyIngestAmounts(): IngestDraftAmounts {
  return { sales: 0, transfer: 0, fee: 0, gpVat: 0 };
}

export function emptyIngestByChannel(): Record<MonthChannel, IngestDraftAmounts> {
  return {
    grab: emptyIngestAmounts(),
    shopee: emptyIngestAmounts(),
    lineman: emptyIngestAmounts(),
  };
}

function safeFileName(name: string): string {
  const base = String(name || "capture")
    .replace(/[^\w.\-()\u0E00-\u0E7F]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return base || "capture.png";
}

function mapAmounts(raw: unknown): IngestDraftAmounts {
  const o = (raw || {}) as Record<string, unknown>;
  return {
    sales: normalizeMoney(Number(o.sales) || 0),
    transfer: normalizeMoney(Number(o.transfer) || 0),
    fee: normalizeMoney(Number(o.fee) || 0),
    gpVat: normalizeMoney(Number(o.gpVat) || 0),
  };
}

function mapImage(raw: unknown): IngestDraftImage | null {
  const o = (raw || {}) as Record<string, unknown>;
  const storagePath = String(o.storagePath || "").trim();
  const downloadUrl = String(o.downloadUrl || "").trim();
  if (!storagePath || !downloadUrl) return null;
  const ch = String(o.channel || "unknown");
  const channel: MonthChannel | "unknown" =
    ch === "grab" || ch === "shopee" || ch === "lineman" ? ch : "unknown";
  return {
    id: String(o.id || storagePath).slice(0, 80),
    fileName: String(o.fileName || "capture.png").slice(0, 160),
    storagePath: storagePath.slice(0, 300),
    downloadUrl: downloadUrl.slice(0, 2000),
    contentHash: String(o.contentHash || "").slice(0, 80),
    channel,
  };
}

export function mapIngestDraft(
  monthKey: string,
  raw: Record<string, unknown>,
): VatDeliveryIngestDraft {
  const byRaw = (raw.byChannel || {}) as Record<string, unknown>;
  const byChannel = emptyIngestByChannel();
  for (const k of MONTH_CHANNELS) {
    byChannel[k] = mapAmounts(byRaw[k]);
  }
  const images = Array.isArray(raw.images)
    ? raw.images.map(mapImage).filter((x): x is IngestDraftImage => Boolean(x))
    : [];
  return {
    monthKey,
    byChannel,
    images: images.slice(0, 3),
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

export async function loadIngestDraft(
  monthKey: string,
): Promise<VatDeliveryIngestDraft | null> {
  if (!isMonthKey(monthKey)) return null;
  const snap = await getDoc(
    doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, monthKey),
  );
  if (!snap.exists()) return null;
  return mapIngestDraft(monthKey, (snap.data() || {}) as Record<string, unknown>);
}

export async function saveIngestDraft(
  draft: VatDeliveryIngestDraft,
): Promise<VatDeliveryIngestDraft> {
  if (!isMonthKey(draft.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const next: VatDeliveryIngestDraft = {
    monthKey: draft.monthKey,
    byChannel: {
      grab: mapAmounts(draft.byChannel.grab),
      shopee: mapAmounts(draft.byChannel.shopee),
      lineman: mapAmounts(draft.byChannel.lineman),
    },
    images: (draft.images || []).slice(0, 3).map((img) => ({
      id: img.id.slice(0, 80),
      fileName: img.fileName.slice(0, 160),
      storagePath: img.storagePath.slice(0, 300),
      downloadUrl: img.downloadUrl.slice(0, 2000),
      contentHash: img.contentHash.slice(0, 80),
      channel: img.channel,
    })),
    updatedAt: Date.now(),
    updatedBy: String(draft.updatedBy || "").slice(0, 120),
  };
  await setDoc(
    doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, next.monthKey),
    { ...next },
    { merge: true },
  );
  return next;
}

export async function deleteIngestDraft(monthKey: string): Promise<void> {
  if (!isMonthKey(monthKey)) return;
  const existing = await loadIngestDraft(monthKey);
  if (existing?.images?.length) {
    await Promise.all(
      existing.images.map(async (img) => {
        try {
          await deleteObject(storageRef(getFirebaseStorage(), img.storagePath));
        } catch {
          /* ไฟล์อาจถูกลบไปแล้ว */
        }
      }),
    );
  }
  if (!existing) return;
  try {
    await deleteDoc(doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, monthKey));
  } catch {
    /* ไม่มีเอกสารก็ผ่าน */
  }
}

/** อัปโหลดแคปพรีวิว → vat-imports/{yyyy}/{mm}/capture/… */
export async function uploadIngestCaptureFile(input: {
  file: File;
  monthKey: string;
}): Promise<IngestDraftImage> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  if (!input.file.type.startsWith("image/")) {
    throw new Error("รองรับเฉพาะรูปภาพ");
  }
  const contentHash = await hashFileSha256(input.file);
  const [yyyy, mm] = input.monthKey.split("-");
  const uploadId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const fileName = safeFileName(input.file.name);
  const storagePath = `${VAT_IMPORT_STORAGE_PREFIX}/${yyyy}/${mm}/capture/${uploadId}-${fileName}`;
  const contentType = guessContentType(input.file);
  const ref = storageRef(getFirebaseStorage(), storagePath);
  await uploadBytes(ref, input.file, {
    contentType,
    customMetadata: {
      monthKey: input.monthKey,
      channel: "capture",
      contentHash,
    },
  });
  const downloadUrl = await getDownloadURL(ref);
  return {
    id: uploadId,
    fileName,
    storagePath,
    downloadUrl,
    contentHash,
    channel: "unknown",
  };
}

export function amountsHaveValue(a: IngestDraftAmounts): boolean {
  return a.sales > 0 || a.transfer > 0 || a.fee > 0 || a.gpVat > 0;
}
