/**
 * กล่อง AI เดียว — แคปจอ GB/SF/LM → พรีวิว 4 ช่อง
 */
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import type { IngestPreview } from "./vat-ingest-preview";
import { INGEST_KIND_LABEL } from "./vat-ingest-preview";
import type { MonthChannel } from "./vat-month-books";

export type CaptureChannelItem = {
  imageIndex: number;
  channel: MonthChannel | "unknown";
  monthKey: string;
  periodLabel: string;
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
  monthMatch: boolean;
  confidence: string;
  notes: string;
  warnings: string[];
  ok: boolean;
};

export type CaptureExtractResult = {
  ok: boolean;
  selectedMonthKey: string;
  model?: string;
  items: CaptureChannelItem[];
  byChannel: Partial<Record<MonthChannel, CaptureChannelItem | null>>;
  errors: string[];
};

export async function extractDeliveryCaptures(opts: {
  monthKey: string;
  images: string[];
}): Promise<CaptureExtractResult> {
  const fn = httpsCallable<
    { monthKey?: string; images: string[] },
    CaptureExtractResult
  >(getFirebaseFunctions(), "vatDeliveryCaptureExtract");
  const res = await fn({
    monthKey: opts.monthKey,
    images: opts.images,
  });
  return res.data;
}

export function captureItemToIngestPreview(
  item: CaptureChannelItem,
): IngestPreview {
  const channel =
    item.channel === "grab" ||
    item.channel === "shopee" ||
    item.channel === "lineman"
      ? item.channel
      : null;
  const kind =
    channel === "grab"
      ? "grab-finance-screenshot"
      : channel === "shopee"
        ? "shopee-monthly-mail"
        : channel === "lineman"
          ? "lineman-report-csv"
          : "unknown";
  const warnings = [...(item.warnings || [])];
  if (item.periodLabel) warnings.unshift(`ช่วงในรูป: ${item.periodLabel}`);
  if (item.notes) warnings.push(item.notes);
  if (!item.monthMatch && item.monthKey) {
    warnings.unshift("เดือนในรูปไม่ตรงเดือนที่เลือก");
  }
  return {
    kind,
    channel,
    identity: channel
      ? INGEST_KIND_LABEL[kind]
      : "ไม่รู้จักแพลตฟอร์ม",
    fileName: item.periodLabel || `(แคป #${item.imageIndex + 1})`,
    monthKey: item.monthKey || "",
    dayCount: 0,
    headers: [],
    amounts: {
      sales: item.sales,
      transfer: item.transfer,
      fee: item.fee,
      gpVat: item.gpVat,
    },
    ok: Boolean(item.ok),
    warnings,
  };
}

/** อ่านไฟล์รูป → data URL (ย่อถ้าใหญ่) */
export async function fileToImageDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านรูปไม่ได้"));
    reader.readAsDataURL(file);
  });
  if (!raw.startsWith("data:image/")) {
    throw new Error("ต้องเป็นไฟล์รูปภาพ");
  }
  if (raw.length < 1_800_000) return raw;
  return compressDataUrl(raw, 1400, 0.82);
}

function compressDataUrl(
  dataUrl: string,
  maxEdge: number,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("ย่อรูปไม่ได้"));
    img.src = dataUrl;
  });
}
