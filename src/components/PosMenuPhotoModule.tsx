"use client";

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Camera, ImagePlus, Loader2, ThumbsUp, Trash2 } from "lucide-react";
import {
  MENU_SQUARE_PX,
  prepareMenuItemImage,
  type MenuImageCropSource,
} from "@/lib/pos-menu-image";

function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  return Math.round((dataUrl.length - i - 1) * 0.75);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type PosMenuPhotoModuleProps = {
  imageUrl: string;
  recommended: boolean;
  onRecommendedChange: (v: boolean) => void;
  onImageReady: (dataUrl: string) => Promise<void>;
  onRequestCrop: (source: MenuImageCropSource) => void;
  onRemove: () => Promise<void>;
  onError: (msg: string) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  /** Extra chips under the photo (optional) */
  extraBadges?: ReactNode;
};

/**
 * Smart menu photo module — drop / click / paste · auto-square · crop when needed · JPEG 480.
 */
export function PosMenuPhotoModule({
  imageUrl,
  recommended,
  onRecommendedChange,
  onImageReady,
  onRequestCrop,
  onRemove,
  onError,
  uploading,
  setUploading,
  extraBadges,
}: PosMenuPhotoModuleProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastMeta, setLastMeta] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setUploading(true);
      onError("");
      setLastMeta(null);
      try {
        const prep = await prepareMenuItemImage(file);
        if (prep.mode === "done") {
          await onImageReady(prep.dataUrl);
          setLastMeta(
            `บีบอัดแล้ว ${formatBytes(dataUrlBytes(prep.dataUrl))} · ${MENU_SQUARE_PX}×${MENU_SQUARE_PX} JPEG`,
          );
        } else {
          onRequestCrop(prep.source);
        }
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [onError, onImageReady, onRequestCrop, setUploading],
  );

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    void processFile(file);
  }

  async function onPaste() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const file = new File([blob], "paste.png", { type: blob.type || "image/png" });
        await processFile(file);
        return;
      }
    } catch {
      /* clipboard image not available — ignore */
    }
  }

  return (
    <div className="pos-menu-photo-module">
      <div
        className={[
          "pos-menu-photo-drop",
          imageUrl ? "has-image" : "",
          dragOver ? "is-dragover" : "",
          uploading ? "is-busy" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="button"
        tabIndex={0}
        aria-label={imageUrl ? "เปลี่ยนรูปเมนู" : "เพิ่มรูปเมนู"}
        onClick={() => {
          if (!uploading) fileRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!uploading) fileRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
        onPaste={() => void onPaste()}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="pos-menu-photo-preview" />
        ) : (
          <div className="pos-menu-photo-placeholder">
            {uploading ? (
              <Loader2 size={28} className="pos-menu-photo-spin" aria-hidden />
            ) : (
              <ImagePlus size={28} aria-hidden />
            )}
            <span className="pos-menu-photo-cta">
              {uploading ? "กำลังบีบอัดรูป..." : "วางรูป / คลิกเลือก"}
            </span>
            <span className="pos-menu-photo-sub">
              JPG · PNG · WebP · ใหญ่เกินจะบีบอัดให้อัตโนมัติ
            </span>
          </div>
        )}

        {uploading && imageUrl ? (
          <div className="pos-menu-photo-busy" aria-live="polite">
            <Loader2 size={22} className="pos-menu-photo-spin" aria-hidden />
            <span>กำลังบีบอัด...</span>
          </div>
        ) : null}

        {imageUrl && !uploading ? (
          <div className="pos-menu-photo-overlay">
            <button
              type="button"
              className="ghost-btn pos-menu-photo-overlay-btn"
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
            >
              <Camera size={14} aria-hidden /> เปลี่ยน
            </button>
            <button
              type="button"
              className="ghost-btn pos-menu-photo-overlay-btn"
              onClick={(e) => {
                e.stopPropagation();
                void onRemove().then(() => setLastMeta(null));
              }}
            >
              <Trash2 size={14} aria-hidden /> ลบ
            </button>
          </div>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="pos-menu-photo-input"
        onChange={(e) => void processFile(e.target.files?.[0])}
      />

      <div className="pos-menu-photo-badges" role="group" aria-label="แท็กเมนู">
        <button
          type="button"
          className={`pos-menu-photo-badge ${recommended ? "is-on" : ""}`}
          aria-pressed={recommended}
          onClick={() => onRecommendedChange(!recommended)}
        >
          <ThumbsUp size={14} aria-hidden />
          แนะนำ
        </button>
        {extraBadges}
      </div>

      <p className="muted pos-menu-photo-hint">
        สี่เหลี่ยมจัตุรัสอัตโนมัติ · ครอปเมื่อสัดส่วนไม่ตรง · บีบอัด JPEG {MENU_SQUARE_PX}px
        {` · รับไฟล์ใหญ่ได้ (ย่อเองก่อนครอป)`}
        {lastMeta ? ` · ${lastMeta}` : ""}
      </p>
    </div>
  );
}
