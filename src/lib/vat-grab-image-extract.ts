/**
 * แคปจอสรุปการเงิน Grab → พรีวิว 4 ช่อง (AI)
 */
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import type { IngestPreview } from "./vat-ingest-preview";

export type GrabImageExtractResult = {
  ok: boolean;
  channel: "grab";
  kind: string;
  selectedMonthKey: string;
  monthKey: string;
  periodLabel: string;
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
  orderCount: number | null;
  monthMatch: boolean;
  confidence: string;
  notes: string;
  warnings: string[];
  model?: string;
};

export async function extractGrabFinanceImage(opts: {
  imageDataUrl: string;
  monthKey: string;
}): Promise<GrabImageExtractResult> {
  const fn = httpsCallable<
    { imageDataUrl: string; monthKey?: string },
    GrabImageExtractResult
  >(getFirebaseFunctions(), "vatGrabImageExtract");
  const res = await fn({
    imageDataUrl: opts.imageDataUrl,
    ...(opts.monthKey ? { monthKey: opts.monthKey } : {}),
  });
  return res.data;
}

export function grabExtractToIngestPreview(
  r: GrabImageExtractResult,
): IngestPreview {
  const warnings = [...(r.warnings || [])];
  if (r.periodLabel) warnings.unshift(`ช่วงในรูป: ${r.periodLabel}`);
  if (r.notes) warnings.push(r.notes);
  if (!r.monthMatch && r.selectedMonthKey && r.monthKey) {
    warnings.unshift("เดือนในรูปไม่ตรงเดือนที่เลือก — ตรวจก่อนใช้");
  }
  return {
    kind: "grab-finance-screenshot",
    channel: "grab",
    identity: "Grab · แคปสรุปการเงิน (AI)",
    fileName: r.periodLabel || "(แคปจอ)",
    monthKey: r.monthKey || r.selectedMonthKey || "",
    dayCount: 0,
    headers: [],
    amounts: {
      sales: r.sales,
      transfer: r.transfer,
      fee: r.fee,
      gpVat: r.gpVat,
    },
    ok: Boolean(r.ok),
    warnings,
  };
}

/** อ่านไฟล์รูป → data URL (ย่อถ้าใหญ่เกิน ~1.6MB) */
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
