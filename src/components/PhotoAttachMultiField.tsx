"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { compressImageForUpload, fileToReceiptDataUrl } from "@/lib/receipts";

export function PhotoAttachMultiField({
  values,
  onChange,
  onError,
  label = "แนบรูป",
  max = 8,
}: {
  values: string[];
  onChange: (urls: string[]) => void;
  onError?: (msg: string) => void;
  label?: string;
  max?: number;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(fileList: FileList | null | undefined) {
    if (!fileList?.length) return;
    const files = [...fileList];
    const room = max - values.length;
    if (room <= 0) {
      onError?.(`แนบได้สูงสุด ${max} รูป`);
      return;
    }
    const batch = files.slice(0, room);
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of batch) {
        const compressed = await compressImageForUpload(file);
        added.push(await fileToReceiptDataUrl(compressed));
      }
      onChange([...values, ...added]);
    } catch (err) {
      onError?.((err as Error).message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  function removeAt(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  return (
    <div className="field photo-attach-field photo-attach-multi">
      <span className="field-label">{label}</span>
      <p className="muted form-hint-inline">แนบได้หลายรูป (สินค้าหลายอย่าง) · สูงสุด {max} รูป</p>
      <div className="receipt-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={busy || values.length >= max}
          onClick={() => galleryRef.current?.click()}
        >
          {busy ? "กำลังอัปโหลด..." : (
            <>
              <Plus size={16} aria-hidden /> แนบรูป
            </>
          )}
        </button>
      </div>
      {values.length ? (
        <ul className="photo-attach-multi-grid">
          {values.map((url, idx) => (
            <li key={`${idx}-${url.slice(0, 24)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="photo-attach-preview" />
              <button
                type="button"
                className="ghost-btn photo-attach-multi-remove"
                aria-label={`ลบรูปที่ ${idx + 1}`}
                onClick={() => removeAt(idx)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => void onFiles(e.target.files)}
      />
    </div>
  );
}
