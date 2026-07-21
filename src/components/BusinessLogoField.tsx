"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { saveBusinessLogo } from "@/lib/business-profile";
import { isEvidencePhotoRef, resolveEvidencePhotoSrc } from "@/lib/evidence-photos";
import { fileToLogoDataUrl, friendlyFirestoreWriteError } from "@/lib/receipts";

type Props = {
  value: string;
  onChange: (logoUrl: string) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
};

/**
 * อัปโหลดโลโก้ร้าน (PNG โปร่งใสแนะนำ)
 * พรีวิวบนพื้นดำ + บันทึกทันทีเพื่อแทนโลโก้เดิมทั่วแอป
 */
export function BusinessLogoField({ value, onChange, onError, disabled }: Props) {
  const { actorId } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = value.trim();
      if (!raw) {
        if (!cancelled) setPreviewSrc("");
        return;
      }
      try {
        const src = isEvidencePhotoRef(raw) ? await resolveEvidencePhotoSrc(raw) : raw;
        if (!cancelled) setPreviewSrc(src);
      } catch {
        if (!cancelled) setPreviewSrc(raw.startsWith("data:") ? raw : "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function persist(next: string) {
    onChange(next);
    await saveBusinessLogo(next, actorId || "owner");
  }

  async function onPick(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setBusy(true);
    onError?.("");
    try {
      // เก็บเป็น data URL บน meta/businessProfile — อ่านได้แม้ยังไม่ล็อกอิน (หน้า login)
      const dataUrl = await fileToLogoDataUrl(file);
      setPreviewSrc(dataUrl);
      await persist(dataUrl);
    } catch (err) {
      onError?.(friendlyFirestoreWriteError(err, "อัปโหลดโลโก้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onClear() {
    setBusy(true);
    onError?.("");
    try {
      setPreviewSrc("");
      await persist("");
    } catch (err) {
      onError?.(friendlyFirestoreWriteError(err, "ลบโลโก้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="business-logo-field">
      <div className="business-logo-field-head">
        <span className="business-logo-field-label">โลโก้ร้าน</span>
        <span className="business-logo-field-hint">
          PNG โปร่งใสแนะนำ · พรีวิวบนพื้นดำ · แทนโลโก้เดิมทันทีหลังอัปโหลด
        </span>
      </div>

      <div className="business-logo-stage" aria-label="พรีวิวโลโก้บนพื้นดำ">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="โลโก้ร้าน" className="business-logo-preview" />
        ) : (
          <p className="business-logo-empty">ยังไม่มีโลโก้ — อัปโหลด PNG เพื่อแทนโลโก้เดิมทั่วแอป</p>
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
            onClick={() => void onClear()}
          >
            <Trash2 size={16} aria-hidden />
            ลบโลโก้
          </button>
        ) : null}
      </div>
    </div>
  );
}
