"use client";

import { useRef, useState } from "react";
import { compressImageForUpload, fileToReceiptDataUrl } from "@/lib/receipts";

export function PhotoAttachField({
  value,
  onChange,
  onError,
  label = "แนบรูป (ถ้ามี)",
}: {
  value: string;
  onChange: (url: string) => void;
  onError?: (msg: string) => void;
  label?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImageForUpload(file);
      onChange(await fileToReceiptDataUrl(compressed));
    } catch (err) {
      onError?.((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field photo-attach-field">
      <span className="field-label">{label}</span>
      <div className="receipt-actions">
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
      </div>
      {value ? (
        <button type="button" className="ghost-btn photo-attach-clear" onClick={() => onChange("")}>
          ลบรูป
        </button>
      ) : null}
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="photo-attach-preview" />
      ) : null}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}
