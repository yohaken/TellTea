"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { fileToReceiptDataUrl } from "@/lib/receipts";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
  friendlyStorageUploadError,
} from "@/lib/photo-upload";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";
import { resolveEvidencePhotoSrc } from "@/lib/evidence-photos";

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
  /** Custom uploader (e.g. legacy) — receives each File, returns URL string */
  uploadFile,
  /**
   * Canonical Storage evidence mode (preferred prototype).
   * Uploads real files to Firebase Storage with progress popup — no data-URL embed.
   */
  storageFolder,
  storageSlotKey,
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
  uploadFile?: (file: File) => Promise<string>;
  storageFolder?: string;
  storageSlotKey?: string;
  /** คำอธิบายสั้นใต้ป้าย — ค่าว่างใช้ข้อความมาตรฐาน */
  hint?: string;
  allowCamera?: boolean;
  readOnly?: boolean;
  onPreview?: (urls: string[], index: number) => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const activeTaskRef = useRef<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PhotoUploadProgress | null>(null);
  const [thumbSrc, setThumbSrc] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const evidenceMode = Boolean(storageFolder?.trim());

  useEffect(() => {
    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = { ...thumbSrc };
      for (const url of values) {
        if (next[url]) continue;
        try {
          next[url] = await resolveEvidencePhotoSrc(url);
        } catch {
          next[url] = "";
        }
      }
      if (!cancelled) setThumbSrc(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolve only when values identity changes
  }, [values.join("|")]);

  function totalChars(urls: string[]) {
    return measureTotalChars
      ? measureTotalChars(urls)
      : urls.reduce((n, u) => n + (u?.length || 0), 0);
  }

  async function encodeFileLegacy(file: File): Promise<string> {
    const work = uploadFile ? uploadFile(file) : fileToReceiptDataUrl(file, perImageMaxChars);
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("อัปโหลดใช้เวลานานเกินไป — ลองใหม่อีกครั้ง")),
        45_000,
      );
      work.then(
        (url) => {
          clearTimeout(timer);
          resolve(url);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  function requestCancel() {
    cancelRef.current = true;
    try {
      const task = activeTaskRef.current as { cancel?: () => void } | null;
      task?.cancel?.();
    } catch {
      /* ignore */
    }
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
    cancelRef.current = false;
    setBusy(true);

    try {
      if (evidenceMode) {
        if (!online) {
          throw new Error("ไม่มีการเชื่อมต่ออินเทอร์เน็ต — เชื่อมต่อแล้วลองใหม่");
        }
        const added = await uploadEvidencePhotos(batch, {
          folder: storageFolder!,
          slotKey: storageSlotKey || "entry",
          cancelRef,
          getCancelTask: (task) => {
            activeTaskRef.current = task;
          },
          onProgress: setProgress,
        });
        if (added.length) onChange([...values, ...added]);
        else onError?.("อัปโหลดรูปไม่สำเร็จ");
        return;
      }

      const added: string[] = [];
      let lastErr = "";
      for (const file of batch) {
        try {
          const url = await encodeFileLegacy(file);
          const next = [...values, ...added, url];
          if (maxTotalChars != null && totalChars(next) > maxTotalChars) {
            lastErr =
              added.length || values.length
                ? `แนบได้เท่านี้แล้ว — รูปถัดไปจะทำให้เอกสารใหญ่เกินลิมิต (ตอนนี้ ${values.length + added.length} รูป)`
                : "รูปนี้ใหญ่เกินไปสำหรับบันทึก — ลองถ่ายใกล้ขึ้นหรือเลือกรูปอื่น";
            break;
          }
          added.push(url);
        } catch (err) {
          lastErr = (err as Error).message || "อัปโหลดรูปไม่สำเร็จ";
          if (!added.length && !values.length) throw err;
          break;
        }
      }
      if (added.length) onChange([...values, ...added]);
      if (lastErr) onError?.(lastErr);
      else if (!added.length) onError?.("อัปโหลดรูปไม่สำเร็จ");
    } catch (err) {
      onError?.(friendlyStorageUploadError(err) || (err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
      setProgress(null);
      activeTaskRef.current = null;
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
      : evidenceMode
        ? `อัปโหลดไฟล์จริงไปคลังรูป (คงคุณภาพหลักฐาน) · สูงสุด ${max} รูป`
        : allowCamera
          ? `ถ่ายหรือแนบได้หลายรูป (สูงสุด ${max} รูป)`
          : `แนบได้หลายรูป (สูงสุด ${max} รูป)`);

  return (
    <div className="field photo-attach-field photo-attach-multi">
      <span className="field-label">
        {label}
        {!label.includes("สูงสุด") ? ` (สูงสุด ${max} รูป)` : ""}
      </span>
      <p className="muted form-hint-inline">{hintText}</p>
      {evidenceMode ? (
        <p className="photo-attach-conn-chip" data-online={online ? "1" : "0"}>
          {online ? "พร้อมอัปโหลด (ออนไลน์)" : "ออฟไลน์ — เชื่อมเน็ตก่อนแนบรูป"}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="receipt-actions">
          {allowCamera ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || full || (evidenceMode && !online)}
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
            disabled={busy || full || (evidenceMode && !online)}
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
                <img src={thumbSrc[url] || ""} alt="" className="photo-attach-preview" />
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
      {progress ? (
        <PhotoUploadProgressModal progress={progress} onCancel={requestCancel} />
      ) : null}
    </div>
  );
}
