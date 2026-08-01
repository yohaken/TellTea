/**
 * พรีวิวแคป AI ต่อเดือน — เซฟยอด + รูป
 * รูปเก็บใน evidencePhotos (Firestore) — ไม่พึ่ง Firebase Storage ที่เคยค้างเกินเวลา
 * ยังไม่เข้างบจนกว่าจะกดส่งเข้าตารางหลัก
 */
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  deleteObject,
  ref as storageRef,
} from "firebase/storage";
import {
  evidencePhotoIdFromRef,
  isEvidencePhotoRef,
  saveEvidencePhotoDoc,
} from "./evidence-photos";
import { getDb, getFirebaseAuth, getFirebaseStorage } from "./firebase";
import { compressImageForUpload } from "./receipts";
import {
  MONTH_CHANNELS,
  type MonthChannel,
} from "./vat-month-books";
import { isMonthKey, normalizeMoney } from "./vat-sales";

export const VAT_DELIVERY_INGEST_DRAFTS_COL = "vatDeliveryIngestDrafts";

/** sessionStorage key — ยืนยันเดือนก่อนอัปแคปครั้งแรกของเดือน */
export const INGEST_MONTH_CONFIRM_PREFIX = "vat-ingest-up-ok:";

const SAVE_TIMEOUT_MS = 15_000;
const PHOTO_SAVE_TIMEOUT_MS = 25_000;
/** ย่อแคปก่อนเข้า evidencePhotos — พรีวิวไม่ต้องคมเท่าสลิปภาษี */
const INGEST_CAPTURE_MAX_EDGE = 1200;
const INGEST_CAPTURE_QUALITY = 0.68;

export type IngestDraftAmounts = {
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
};

export type IngestDraftImage = {
  id: string;
  fileName: string;
  /** legacy Storage path หรือ evidencePhotos/{id} */
  storagePath: string;
  /** https Storage URL · หรือ evp:{id} จาก evidencePhotos */
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
  const downloadUrl = String(o.downloadUrl || "").trim();
  const storagePath = String(o.storagePath || "").trim();
  if (!downloadUrl) return null;
  const okUrl =
    isEvidencePhotoRef(downloadUrl) ||
    downloadUrl.startsWith("data:image/") ||
    /^https?:\/\//i.test(downloadUrl);
  if (!okUrl) return null;
  const ch = String(o.channel || "unknown");
  const channel: MonthChannel | "unknown" =
    ch === "grab" || ch === "shopee" || ch === "lineman" ? ch : "unknown";
  const evpId = isEvidencePhotoRef(downloadUrl)
    ? evidencePhotoIdFromRef(downloadUrl)
    : "";
  return {
    id: String(o.id || evpId || storagePath || downloadUrl).slice(0, 80),
    fileName: String(o.fileName || "capture.jpg").slice(0, 160),
    storagePath: (storagePath || (evpId ? `evidencePhotos/${evpId}` : "")).slice(
      0,
      300,
    ),
    downloadUrl: downloadUrl.slice(0, 2000),
    contentHash: String(o.contentHash || evpId || "").slice(0, 80),
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

async function deleteIngestImage(img: IngestDraftImage): Promise<void> {
  if (isEvidencePhotoRef(img.downloadUrl)) {
    const id = evidencePhotoIdFromRef(img.downloadUrl);
    if (!id) return;
    try {
      await deleteDoc(doc(getDb(), "evidencePhotos", id));
    } catch {
      /* อาจถูกลบไปแล้ว */
    }
    return;
  }
  if (img.storagePath.startsWith("vat-imports/")) {
    try {
      await deleteObject(storageRef(getFirebaseStorage(), img.storagePath));
    } catch {
      /* ไฟล์อาจถูกลบไปแล้ว */
    }
  }
}

export async function deleteIngestDraft(monthKey: string): Promise<void> {
  if (!isMonthKey(monthKey)) return;
  const existing = await loadIngestDraft(monthKey);
  if (existing?.images?.length) {
    await Promise.all(existing.images.map((img) => deleteIngestImage(img)));
  }
  if (!existing) return;
  try {
    await deleteDoc(doc(getDb(), VAT_DELIVERY_INGEST_DRAFTS_COL, monthKey));
  } catch {
    /* ไม่มีเอกสารก็ผ่าน */
  }
}

/**
 * ต้องถามยืนยันเดือนก่อนอัปแคปหรือไม่
 * — ถามครั้งแรกของเดือนเมื่อยังไม่มีรูปที่เซฟ (กันอัปผิดเดือน)
 */
export function needsIngestMonthConfirm(input: {
  hasSavedImages: boolean;
  alreadyConfirmed: boolean;
}): boolean {
  if (input.hasSavedImages) return false;
  if (input.alreadyConfirmed) return false;
  return true;
}

export function ingestMonthConfirmStorageKey(monthKey: string): string {
  return `${INGEST_MONTH_CONFIRM_PREFIX}${monthKey}`;
}

export function readIngestMonthConfirmed(monthKey: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(ingestMonthConfirmStorageKey(monthKey)) === "1";
  } catch {
    return false;
  }
}

export function writeIngestMonthConfirmed(monthKey: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(ingestMonthConfirmStorageKey(monthKey), "1");
  } catch {
    /* private mode */
  }
}

export function clearIngestMonthConfirmed(monthKey: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(ingestMonthConfirmStorageKey(monthKey));
  } catch {
    /* private mode */
  }
}

/**
 * บันทึกรูปแคปพรีวิว → evidencePhotos (Firestore)
 * ใช้ path เดียวกับสลิปในแอป — ไม่ผ่าน Storage ที่เคยค้าง
 */
export async function uploadIngestCaptureFile(input: {
  file: File;
  monthKey: string;
}): Promise<IngestDraftImage> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  if (
    !input.file.type.startsWith("image/") &&
    !/\.(png|jpe?g|webp|heic|heif)$/i.test(input.file.name)
  ) {
    throw new Error("รองรับเฉพาะรูปภาพ");
  }

  const baseName =
    String(input.file.name || "capture")
      .replace(/[^\w.\-()\u0E00-\u0E7F]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/\.[^.]+$/, "")
      .slice(0, 100) || "capture";

  let ready = input.file;
  try {
    if (typeof document !== "undefined") {
      const compressed = await withTimeout(
        compressImageForUpload(
          input.file,
          INGEST_CAPTURE_MAX_EDGE,
          INGEST_CAPTURE_QUALITY,
        ),
        12_000,
        "ย่อรูป",
      );
      ready = new File([compressed], `${baseName}.jpg`, { type: "image/jpeg" });
    }
  } catch {
    /* ย่อไม่ได้ก็ส่งไฟล์เดิม — saveEvidencePhotoDoc จะย่อเอง */
    ready = input.file;
  }

  let evpRef: string;
  try {
    evpRef = await withTimeout(
      saveEvidencePhotoDoc(ready, {
        folder: "vat-ingest",
        slotKey: `ingest-${input.monthKey}`,
        encode: "receipt",
      }),
      PHOTO_SAVE_TIMEOUT_MS,
      "บันทึกรูป",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission|insufficient|PERMISSION|ไม่มีสิทธิ์/i.test(msg)) {
      throw new Error("บันทึกรูปไม่ได้ · ไม่มีสิทธิ์ (รีเฟรชแล้วลองใหม่)");
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  const id = evidencePhotoIdFromRef(evpRef);
  const fileName = `${baseName}.jpg`;

  return {
    id: id || evpRef.slice(0, 80),
    fileName,
    storagePath: id ? `evidencePhotos/${id}` : "",
    downloadUrl: evpRef,
    contentHash: id || "",
    channel: "unknown",
  };
}

export function amountsHaveValue(a: IngestDraftAmounts): boolean {
  return a.sales > 0 || a.transfer > 0 || a.fee > 0 || a.gpVat > 0;
}
