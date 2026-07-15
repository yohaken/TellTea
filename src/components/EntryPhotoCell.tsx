"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, ImageOff } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function resolvePhotoUrls(imageUrl?: string, imageUrls?: string[]) {
  if (Array.isArray(imageUrls) && imageUrls.length) {
    const urls = imageUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls;
  }
  if (imageUrl?.trim()) return [imageUrl.trim()];
  return [];
}

/** แสดงสถานะรูปในตาราง — มีรูปกดดูได้, ไม่มีรูปแสดงไอคอนจาง / กด + เพื่อเพิ่ม */
export function EntryPhotoIndicator({
  imageUrl,
  imageUrls,
  label,
  onView,
  onAdd,
}: {
  imageUrl?: string;
  imageUrls?: string[];
  label: string;
  onView?: (urls: string[], index?: number) => void;
  /** เมื่อยังไม่มีรูป — แสดงปุ่ม + เพื่อเปิดฟอร์มเพิ่มรูป */
  onAdd?: () => void;
}) {
  const urls = resolvePhotoUrls(imageUrl, imageUrls);
  if (urls.length) {
    return (
      <button
        type="button"
        className="photo-status has-photo"
        onClick={() => onView?.(urls, 0)}
        title={`มี ${urls.length} รูป — แตะดู`}
        aria-label={`มีรูป ${urls.length} รูป ${label}`}
        data-count={urls.length}
      >
        <ImageIcon size={14} aria-hidden strokeWidth={2.25} />
        <span className="photo-status-count">{urls.length}</span>
      </button>
    );
  }

  if (onAdd) {
    return (
      <button
        type="button"
        className="photo-status"
        onClick={onAdd}
        title="เพิ่มรูป"
        aria-label={`เพิ่มรูป ${label}`}
      >
        <span className="photo-status-plus" aria-hidden>
          +
        </span>
      </button>
    );
  }

  return (
    <span className="photo-status is-empty" title="ยังไม่มีรูป" aria-label={`ยังไม่มีรูป ${label}`}>
      <ImageOff size={14} aria-hidden strokeWidth={2} />
    </span>
  );
}

export function ImagePreviewModal({
  url,
  urls,
  title,
  initialIndex = 0,
  onClose,
}: {
  url?: string;
  urls?: string[];
  title?: string;
  initialIndex?: number;
  onClose: () => void;
}) {
  const list = urls?.length ? urls : url ? [url] : [];
  const start = Math.min(Math.max(0, initialIndex), Math.max(0, list.length - 1));
  const [idx, setIdx] = useState(start);
  const current = list[idx] || "";
  useBodyScrollLock(true);

  function prev() {
    setIdx((i) => (i <= 0 ? list.length - 1 : i - 1));
  }

  function next() {
    setIdx((i) => (i >= list.length - 1 ? 0 : i + 1));
  }

  return (
    <div className="modal-backdrop photo-backdrop is-image-fullview" role="presentation" onClick={onClose}>
      <div
        className="photo-action-card photo-preview-card"
        role="dialog"
        aria-modal="true"
        aria-label={title || "ดูรูป"}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <p style={{ margin: "0 0 0.55rem", fontWeight: 700, fontSize: "0.92rem", textAlign: "left" }}>
            {title}
            {list.length > 1 ? ` (${idx + 1}/${list.length})` : ""}
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt="" className="photo-preview-full" />
        {list.length > 1 ? (
          <div className="photo-preview-nav">
            <button type="button" className="ghost-btn" onClick={prev} aria-label="รูปก่อนหน้า">
              <ChevronLeft size={18} />
            </button>
            <span className="muted">
              {idx + 1} / {list.length}
            </span>
            <button type="button" className="ghost-btn" onClick={next} aria-label="รูปถัดไป">
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}
        <button type="button" className="ghost-btn" style={{ width: "100%", marginTop: "0.55rem" }} onClick={onClose}>
          ปิด
        </button>
      </div>
    </div>
  );
}

/** @deprecated Use EntryPhotoIndicator — kept for OT column with view/add */
export function EntryPhotoCell({
  imageUrl,
  label,
  onView,
}: {
  imageUrl?: string;
  label: string;
  onView: (url: string) => void;
  onAdd?: () => void;
}) {
  return (
    <EntryPhotoIndicator
      imageUrl={imageUrl}
      label={label}
      onView={(urls) => onView(urls[0] || "")}
    />
  );
}
