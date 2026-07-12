"use client";

import { ImageIcon, ImageOff } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/** แสดงสถานะรูปในตาราง — มีรูปกดดูได้, ไม่มีรูปแสดงไอคอนจาง */
export function EntryPhotoIndicator({
  imageUrl,
  label,
  onView,
}: {
  imageUrl?: string;
  label: string;
  onView?: (url: string) => void;
}) {
  if (imageUrl) {
    return (
      <button
        type="button"
        className="photo-status has-photo"
        onClick={() => onView?.(imageUrl)}
        title="มีรูป — แตะดู"
        aria-label={`มีรูป ${label}`}
      >
        <ImageIcon size={14} aria-hidden strokeWidth={2.25} />
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
  title,
  onClose,
}: {
  url: string;
  title?: string;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

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
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="photo-preview-full" />
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
  return <EntryPhotoIndicator imageUrl={imageUrl} label={label} onView={onView} />;
}
