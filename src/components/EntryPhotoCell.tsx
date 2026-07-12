"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, ImageOff } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function resolvePhotoUrls(imageUrl?: string, imageUrls?: string[]) {
  if (imageUrls?.length) return imageUrls.filter(Boolean);
  if (imageUrl?.trim()) return [imageUrl.trim()];
  return [];
}

/** แสดงสถานะรูปในตาราง — มีรูปกดดูได้, ไม่มีรูปแสดงไอคอนจาง */
export function EntryPhotoIndicator({
  imageUrl,
  imageUrls,
  label,
  onView,
}: {
  imageUrl?: string;
  imageUrls?: string[];
  label: string;
  onView?: (urls: string[]) => void;
}) {
  const urls = resolvePhotoUrls(imageUrl, imageUrls);
  if (urls.length) {
    return (
      <button
        type="button"
        className="photo-status has-photo"
        onClick={() => onView?.(urls)}
        title={urls.length > 1 ? `มี ${urls.length} รูป — แตะดู` : "มีรูป — แตะดู"}
        aria-label={`มีรูป ${urls.length} รูป ${label}`}
      >
        <ImageIcon size={14} aria-hidden strokeWidth={2.25} />
        {urls.length > 1 ? <span className="photo-status-count">{urls.length}</span> : null}
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
  onClose,
}: {
  url?: string;
  urls?: string[];
  title?: string;
  onClose: () => void;
}) {
  const list = urls?.length ? urls : url ? [url] : [];
  const [idx, setIdx] = useState(0);
  const current = list[idx] || "";
  useBodyScrollLock(true);

  function prev() {
    setIdx((i) => (i <= 0 ? list.length - 1 : i - 1));
  }

  function next() {
    setIdx((i) => (i >= list.length - 1 ? 0 : i + 1));
  }

  return (
    <div className="modal-backdrop photo-backdrop" role="presentation" onClick={onClose}>
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
            <span className="muted">{idx + 1} / {list.length}</span>
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
