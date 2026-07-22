"use client";

import { useMemo, useState } from "react";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";

/** Thumb grid + fullscreen lightbox (same pattern as bill evidence photos). */
export function NposCaptureGallery({
  primaryUrl,
  secondaryUrl,
  caption,
  emptyHint = "ยังไม่มีภาพแคป — สั่งแคปจากแผงเครื่องแล้วรอ ~1 นาที",
}: {
  primaryUrl?: string;
  secondaryUrl?: string;
  caption?: string;
  emptyHint?: string;
}) {
  const urls = useMemo(
    () => [primaryUrl, secondaryUrl].map((u) => (u || "").trim()).filter(Boolean),
    [primaryUrl, secondaryUrl],
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (!urls.length) {
    return <p className="muted npos-capture-empty">{emptyHint}</p>;
  }

  const labels = [
    primaryUrl?.trim() ? "จอหลัก" : null,
    secondaryUrl?.trim() ? "จอลูกค้า" : null,
  ].filter(Boolean) as string[];

  return (
    <>
      {caption ? <p className="muted npos-capture-caption">{caption}</p> : null}
      <div className="npos-capture-thumbs">
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            className="npos-capture-thumb-btn"
            onClick={() => setPreviewIndex(i)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={labels[i] || `แคป ${i + 1}`} />
            <span>{labels[i] || `รูป ${i + 1}`}</span>
          </button>
        ))}
      </div>
      {previewIndex != null ? (
        <ImagePreviewModal
          urls={urls}
          initialIndex={previewIndex}
          title="แคปจอ nPos"
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </>
  );
}
