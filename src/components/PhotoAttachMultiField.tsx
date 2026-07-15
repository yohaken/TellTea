"use client";

import { useRef, useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { fileToReceiptDataUrl } from "@/lib/receipts";

export function PhotoAttachMultiField({
  values,
  onChange,
  onError,
  label = "แนบรูป",
  max = 8,
  /** Soft per-image target; lower when packing several into one Firestore doc */
  perImageMaxChars,
  /** Total chars of final URL list that must not be exceeded (caller-defined budget) */
  maxTotalChars,
  measureTotalChars,
  hint,
  allowCamera = true,
  readOnly = false,
  onPreview,
}: {
  values: string[];
  onChange: (urls: string[]) => void;
  onError?: (msg: string) => void;
  label?: string;
  max?: number;
  perImageMaxChars?: number;
  maxTotalChars?: number;
  measureTotalChars?: (urls: string[]) => number;
  /** คำอธิบายสั้นใต้ป้าย — ค่าว่างใช้ข้อความมาตรฐาน */
  hint?: string;
  allowCamera?: boolean;
  readOnly?: boolean;
  onPreview?: (urls: string[], index: number) => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function totalChars(urls: string[]) {
    return measureTotalChars
      ? measureTotalChars(urls)
      : urls.reduce((n, u) => n + (u?.length || 0), 0);
  }

  async function onFiles(fileList: FileList | null | undefined) {
    if (readOnly) return;
    if (!fileList?.length) return;
    const files = [...fileList];
    const room = max - values.length;
    if (room <= 0) {
      onError?.(`แนบได้สูงสุด ${max} รูป`);
      return;
    }
    const batch = files.slice(0, room);
    setBusy(true);
    const added: string[] = [];
    let lastErr = "";
    try {
      for (const file of batch) {
        try {
          const dataUrl = await fileToReceiptDataUrl(file, perImageMaxChars);
          const next = [...values, ...added, dataUrl];
          if (maxTotalChars != null && totalChars(next) > maxTotalChars) {
            lastErr =
              added.length || values.length
                ? `แนบได้เท่านี้แล้ว — รูปถัดไปจะทำให้เอกสารใหญ่เกินลิมิต (ตอนนี้ ${values.length + added.length} รูป)`
                : "รูปนี้ใหญ่เกินไปสำหรับบันทึก — ลองถ่ายใกล้ขึ้นหรือเลือกรูปอื่น";
            break;
          }
          added.push(dataUrl);
        } catch (err) {
          lastErr = (err as Error).message || "อัปโหลดรูปไม่สำเร็จ";
          // Keep photos that already succeeded in this batch.
          if (!added.length && !values.length) throw err;
          break;
        }
      }
      if (added.length) onChange([...values, ...added]);
      if (lastErr) onError?.(lastErr);
      else if (!added.length) onError?.("อัปโหลดรูปไม่สำเร็จ");
    } catch (err) {
      onError?.((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function removeAt(idx: number) {
    if (readOnly) return;
    onChange(values.filter((_, i) => i !== idx));
  }

  const full = values.length >= max;
  const hintText =
    hint ??
    (readOnly
      ? values.length
        ? `${values.length} รูป`
        : "ยังไม่มีรูป"
      : allowCamera
        ? `ถ่ายหรือแนบได้หลายรูป · สูงสุด ${max} รูป`
        : `แนบได้หลายรูป · สูงสุด ${max} รูป`);

  return (
    <div className="field photo-attach-field photo-attach-multi">
      <span className="field-label">{label}</span>
      <p className="muted form-hint-inline">{hintText}</p>
      {!readOnly ? (
        <div className="receipt-actions">
          {allowCamera ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || full}
              onClick={() => cameraRef.current?.click()}
            >
              {busy ? (
                "กำลังอัปโหลด..."
              ) : (
                <>
                  <Camera size={16} aria-hidden /> ถ่ายรูป
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={allowCamera ? "ghost-btn" : "primary-btn"}
            disabled={busy || full}
            onClick={() => galleryRef.current?.click()}
          >
            {busy && !allowCamera ? (
              "กำลังอัปโหลด..."
            ) : (
              <>
                <Plus size={16} aria-hidden /> แนบรูป
              </>
            )}
          </button>
        </div>
      ) : null}
      {values.length ? (
        <ul className="photo-attach-multi-grid">
          {values.map((url, idx) => (
            <li key={`${idx}-${url.slice(0, 24)}`}>
              <button
                type="button"
                className="photo-attach-preview-btn"
                onClick={() => onPreview?.(values, idx)}
                aria-label={`ดูรูปที่ ${idx + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="photo-attach-preview" />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  className="ghost-btn photo-attach-multi-remove"
                  aria-label={`ลบรูปที่ ${idx + 1}`}
                  onClick={() => removeAt(idx)}
                >
                  <X size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!readOnly && allowCamera ? (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => void onFiles(e.target.files)}
        />
      ) : null}
      {!readOnly ? (
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => void onFiles(e.target.files)}
        />
      ) : null}
    </div>
  );
}
