"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getBrandLogoMemory,
  loadBrandLogo,
  saveBrandLogo,
} from "@/lib/brand-logo";
import { fileToLogoDataUrl, friendlyFirestoreWriteError } from "@/lib/receipts";

type Props = {
  /** "brandLogo" when set — bytes live in meta/brandLogo */
  value: string;
  onChange: (logoUrl: string) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
};

const UPLOAD_BUDGET_MS = 35_000;

function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * อัปโหลดโลโก้ร้าน — ตัดพื้นขาว/ครีมที่ขอบอัตโนมัติ → PNG โปร่งใส
 * พรีวิวเต็มไม่มีกรอบ · บันทึกที่ meta/brandLogo
 */
export function BusinessLogoField({ value, onChange, onError, disabled }: Props) {
  const { actorId } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState(() => getBrandLogoMemory());

  useEffect(() => {
    let cancelled = false;
    void loadBrandLogo().then((src) => {
      if (cancelled) return;
      // Do not wipe a newer upload that finished while this load was in flight.
      const mem = getBrandLogoMemory();
      const next = mem || src;
      if (next) {
        setPreviewSrc(next);
        onChange("brandLogo");
      } else if (!getBrandLogoMemory()) {
        setPreviewSrc("");
        onChange("");
      }
    });
    return () => {
      cancelled = true;
    };
    // intentionally once on mount — parent keeps pointer only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value === "brandLogo") {
      const mem = getBrandLogoMemory();
      if (mem) setPreviewSrc(mem);
      return;
    }
    // Only clear when parent truly cleared and memory is empty (not a load/upload race).
    if (!value && !busy && !getBrandLogoMemory()) {
      setPreviewSrc("");
    }
  }, [value, busy]);

  function reportError(msg: string) {
    setLocalError(msg);
    onError?.(msg);
  }

  async function onPick(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setBusy(true);
    setLocalError(null);
    onError?.("");
    try {
      const dataUrl = await raceTimeout(
        fileToLogoDataUrl(file),
        UPLOAD_BUDGET_MS,
        "ย่อรูปนานเกินไป — ลองไฟล์ PNG/JPG ขนาดเล็กกว่า",
      );
      const saved = await raceTimeout(
        saveBrandLogo(dataUrl, actorId || "owner"),
        UPLOAD_BUDGET_MS,
        "บันทึกโลโก้นานเกินไป — ตรวจเน็ตแล้วลองใหม่",
      );
      if (!saved) {
        throw new Error("อัปโหลดโลโก้ไม่สำเร็จ — ไม่ได้รูปหลังย่อขนาด");
      }
      setPreviewSrc(saved);
      onChange("brandLogo");
      setLocalError(null);
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "อัปโหลดโลโก้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onClear() {
    setBusy(true);
    setLocalError(null);
    onError?.("");
    try {
      await raceTimeout(
        saveBrandLogo("", actorId || "owner"),
        20_000,
        "ลบโลโก้นานเกินไป — ตรวจเน็ตแล้วลองใหม่",
      );
      setPreviewSrc("");
      onChange("");
    } catch (err) {
      reportError(friendlyFirestoreWriteError(err, "ลบโลโก้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="business-logo-field">
      <div className="business-logo-field-head">
        <span className="business-logo-field-label">โลโก้ร้าน</span>
        <span className="business-logo-field-hint">
          ใช้ PNG หรือ JPG · ตัดแถบขาว/ครีมที่ขอบอัตโนมัติ · แทนโลโก้เดิมทันที
        </span>
      </div>

      <div className="business-logo-stage" aria-label="พรีวิวโลโก้ร้าน">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="โลโก้ร้าน" className="business-logo-preview" />
        ) : (
          <p className="business-logo-empty">ยังไม่มีโลโก้ — อัปโหลด PNG/JPG เพื่อแสดงบนหัวสลิป</p>
        )}
      </div>

      {localError ? <p className="error-text business-logo-error">{localError}</p> : null}

      <div className="business-logo-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
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
        {busy ? (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setBusy(false);
              reportError("ยกเลิกแล้ว — ลองอัปโหลดใหม่ด้วย PNG หรือ JPG");
            }}
          >
            ยกเลิก
          </button>
        ) : null}
        {previewSrc && !busy ? (
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled}
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
