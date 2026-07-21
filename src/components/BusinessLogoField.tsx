"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  resolveEvidencePhotoSrc,
  saveEvidencePhotoDoc,
} from "@/lib/evidence-photos";
import { friendlyFirestoreWriteError } from "@/lib/receipts";

type Props = {
  value: string;
  onChange: (logoUrl: string) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
};

/**
 * อัปโหลดโลโก้ร้าน (PNG โปร่งใสแนะนำ)
 * พรีวิวบนพื้นดำเพื่อให้เห็นขอบและเงาโปร่งใสชัด
 */
export function BusinessLogoField({ value, onChange, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!value.trim()) {
        if (!cancelled) setPreviewSrc("");
        return;
      }
      try {
        const src = await resolveEvidencePhotoSrc(value);
        if (!cancelled) setPreviewSrc(src);
      } catch {
        if (!cancelled) setPreviewSrc("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function onPick(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setBusy(true);
    onError?.("");
    try {
      const ref = await saveEvidencePhotoDoc(file, {
        folder: "brand-logo",
        slotKey: "primary",
        encode: "logo",
      });
      onChange(ref);
    } catch (err) {
      onError?.(friendlyFirestoreWriteError(err, "อัปโหลดโลโก้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="business-logo-field">
      <div className="business-logo-field-head">
        <span className="business-logo-field-label">โลโก้ร้าน</span>
        <span className="business-logo-field-hint">PNG โปร่งใสแนะนำ · พรีวิวบนพื้นดำ</span>
      </div>

      <div className="business-logo-stage" aria-label="พรีวิวโลโก้บนพื้นดำ">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="โลโก้ร้าน" className="business-logo-preview" />
        ) : (
          <p className="business-logo-empty">ยังไม่มีโลโก้ — อัปโหลด PNG เพื่อดูบนพื้นดำ</p>
        )}
      </div>

      <div className="business-logo-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/*"
          hidden
          disabled={disabled || busy}
          onChange={(e) => void onPick(e.target.files)}
        />
        <button
          type="button"
          className="ghost-btn"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={16} aria-hidden />
          {busy ? "กำลังอัปโหลด…" : previewSrc ? "เปลี่ยนโลโก้" : "อัปโหลดโลโก้"}
        </button>
        {value ? (
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled || busy}
            onClick={() => onChange("")}
          >
            <Trash2 size={16} aria-hidden />
            ลบโลโก้
          </button>
        ) : null}
      </div>
    </div>
  );
}
