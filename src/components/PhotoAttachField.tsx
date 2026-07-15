"use client";

import { useEffect, useRef, useState } from "react";
import { compressImageForUpload, fileToReceiptDataUrl } from "@/lib/receipts";
import {
  type PhotoUploadProgress,
  uploadEvidencePhotos,
  friendlyStorageUploadError,
} from "@/lib/photo-upload";
import { resolveEvidencePhotoSrc } from "@/lib/evidence-photos";
import { PhotoUploadProgressModal } from "@/components/PhotoUploadProgressModal";

export function PhotoAttachField({
  value,
  onChange,
  onError,
  label = "แนบรูป (ถ้ามี)",
  galleryOnly = false,
  /**
   * Evidence mode (preferred): saves one Firestore photo doc (`evp:`) with progress popup.
   * Omit only for non-evidence UI thumbs that intentionally stay as lightweight data URLs.
   */
  storageFolder,
  storageSlotKey = "single",
}: {
  value: string;
  onChange: (url: string) => void;
  onError?: (msg: string) => void;
  label?: string;
  /** แนบจากแกลเลอรีอย่างเดียว — บนมือถือยังเลือกถ่ายรูปจากตัวเลือกไฟล์ได้ */
  galleryOnly?: boolean;
  storageFolder?: string;
  storageSlotKey?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PhotoUploadProgress | null>(null);
  const [previewSrc, setPreviewSrc] = useState("");
  const evidenceMode = Boolean(storageFolder?.trim());

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setPreviewSrc("");
      return;
    }
    void resolveEvidencePhotoSrc(value)
      .then((src) => {
        if (!cancelled) setPreviewSrc(src);
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    cancelRef.current = false;
    setBusy(true);
    try {
      if (evidenceMode) {
        const urls = await uploadEvidencePhotos([file], {
          folder: storageFolder!,
          slotKey: storageSlotKey,
          cancelRef,
          onProgress: setProgress,
        });
        if (!urls[0]) throw new Error("อัปโหลดรูปไม่สำเร็จ");
        onChange(urls[0]);
        return;
      }
      const compressed = await compressImageForUpload(file);
      onChange(await fileToReceiptDataUrl(compressed));
    } catch (err) {
      onError?.(friendlyStorageUploadError(err) || (err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
      setProgress(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  return (
    <div className="field photo-attach-field">
      <span className="field-label">{label}</span>
      {evidenceMode ? (
        <p className="muted form-hint-inline">บันทึกหลักฐานเข้าฐานข้อมูล (คุณภาพสูง)</p>
      ) : null}
      <div className="receipt-actions">
        {galleryOnly ? (
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
          >
            {busy ? "กำลังอัปโหลด..." : "แนบรูป"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => cameraRef.current?.click()}
            >
              {busy ? "กำลังอัปโหลด..." : "ถ่ายรูป"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              แนบรูป
            </button>
          </>
        )}
      </div>
      {value ? (
        <button type="button" className="ghost-btn photo-attach-clear" onClick={() => onChange("")}>
          ลบรูป
        </button>
      ) : null}
      {previewSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewSrc} alt="" className="photo-attach-preview" />
      ) : null}
      {galleryOnly ? null : (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      )}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {progress ? (
        <PhotoUploadProgressModal
          progress={progress}
          onCancel={() => {
            cancelRef.current = true;
          }}
        />
      ) : null}
    </div>
  );
}
