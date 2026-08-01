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
import { guessContentType, VAT_IMPORT_STORAGE_PREFIX } from "./vat-import";
import {
  MONTH_CHANNELS,
  type MonthChannel,
} from "./vat-month-books";
import { isMonthKey, normalizeMoney } from "./vat-sales";

export const VAT_DELIVERY_INGEST_DRAFTS_COL = "vatDeliveryIngestDrafts";

const UPLOAD_TIMEOUT_MS = 45_000;
const SAVE_TIMEOUT_MS = 20_000;

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} เกินเวลา (${Math.round(ms / 1000)} วินาที)`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function safeFileName(name: string): string {
  const base = String(name || "capture")
    .replace(/[^\w.\-()\u0E00-\u0E7F]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return base || "capture.jpg";
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
    fileName: String(o.fileName || "capture.jpg").slice(0, 160),
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
  const snap = await withTimeout(
    getDoc(doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, monthKey)),
    SAVE_TIMEOUT_MS,
    "โหลดพรีวิว",
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
  try {
    await withTimeout(
      setDoc(
        doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, next.monthKey),
        { ...next },
        { merge: true },
      ),
      SAVE_TIMEOUT_MS,
      "เซฟพรีวิว",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission|insufficient|PERMISSION/i.test(msg)) {
      throw new Error("เซฟไม่ได้ · ไม่มีสิทธิ์เขียนพรีวิว (รีเฟรชแล้วลองใหม่)");
    }
    throw e instanceof Error ? e : new Error(msg);
  }
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

/** ย่อแคปเป็น JPEG ก่อนอัปโหลด — กันเซฟค้างจากไฟล์ใหญ่ */
async function compressCaptureToJpeg(file: File): Promise<File> {
  if (typeof document === "undefined") return file;
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านรูปไม่ได้"));
    reader.readAsDataURL(file);
  });
  if (!raw.startsWith("data:image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxEdge = 1280;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => reject(new Error("ย่อรูปไม่ได้"));
    img.src = raw;
  });

  const bin = atob(dataUrl.split(",")[1] || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const base = safeFileName(file.name).replace(/\.[^.]+$/, "") || "capture";
  return new File([bytes], `${base}.jpg`, { type: "image/jpeg" });
}

/** อัปโหลดแคปพรีวิว → vat-imports/{yyyy}/{mm}/capture/… */
export async function uploadIngestCaptureFile(input: {
  file: File;
  monthKey: string;
}): Promise<IngestDraftImage> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  if (!input.file.type.startsWith("image/") && !/\.(png|jpe?g|webp|heic|heif)$/i.test(input.file.name)) {
    throw new Error("รองรับเฉพาะรูปภาพ");
  }

  const file = await withTimeout(
    compressCaptureToJpeg(input.file),
    20_000,
    "ย่อรูป",
  );

  const [yyyy, mm] = input.monthKey.split("-");
  const uploadId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const fileName = safeFileName(file.name);
  const storagePath = `${VAT_IMPORT_STORAGE_PREFIX}/${yyyy}/${mm}/capture/${uploadId}-${fileName}`;
  const contentType = guessContentType(file) || "image/jpeg";
  const ref = storageRef(getFirebaseStorage(), storagePath);

  try {
    await withTimeout(
      uploadBytes(ref, file, {
        contentType,
        customMetadata: {
          monthKey: input.monthKey,
          channel: "capture",
        },
      }),
      UPLOAD_TIMEOUT_MS,
      "อัปโหลดรูป",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission|unauthorized|storage\/unauthorized/i.test(msg)) {
      throw new Error("อัปโหลดรูปไม่ได้ · ไม่มีสิทธิ์ Storage");
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  const downloadUrl = await withTimeout(
    getDownloadURL(ref),
    15_000,
    "ดึงลิงก์รูป",
  );
  return {
    id: uploadId,
    fileName,
    storagePath,
    downloadUrl,
    contentHash: uploadId,
    channel: "unknown",
  };
}

export function amountsHaveValue(a: IngestDraftAmounts): boolean {
  return a.sales > 0 || a.transfer > 0 || a.fee > 0 || a.gpVat > 0;
}
