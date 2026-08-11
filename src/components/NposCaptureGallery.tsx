"use client";

import { useMemo, useState } from "react";
import { ImagePreviewModal } from "@/components/EntryPhotoCell";

/** Thumb grid + fullscreen lightbox (same pattern as bill evidence photos). */
export function NposCaptureGallery({
  primaryUrl,
  secondaryUrl,
  slipUrl,
  caption,
  emptyHint = "ยังไม่มีภาพแคป — สั่งแคปจากแผงเครื่องแล้วรอ ~1 นาที",
}: {
  primaryUrl?: string;
  secondaryUrl?: string;
  /** Rendered InnerPrinter slip (pixels that went to paper). */
  slipUrl?: string;
  caption?: string;
  emptyHint?: string;
}) {
  const entries = useMemo(() => {
    const out: { url: string; label: string }[] = [];
    if (slipUrl?.trim()) out.push({ url: slipUrl.trim(), label: "สลิป" });
    if (primaryUrl?.trim()) out.push({ url: primaryUrl.trim(), label: "จอหลัก" });
    if (secondaryUrl?.trim()) out.push({ url: secondaryUrl.trim(), label: "จอลูกค้า" });
    return out;
  }, [primaryUrl, secondaryUrl, slipUrl]);
  const urls = useMemo(() => entries.map((e) => e.url), [entries]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<number, boolean>>({});

  if (!entries.length) {
    return <p className="muted npos-capture-empty">{emptyHint}</p>;
  }

  return (
    <>
      {caption ? <p className="muted npos-capture-caption">{caption}</p> : null}
      <div className="npos-capture-thumbs">
        {entries.map((entry, i) => (
          <button
            key={`${entry.label}-${entry.url}-${i}`}
            type="button"
            className="npos-capture-thumb-btn"
            onClick={() => setPreviewIndex(i)}
          >
            {failed[i] ? (
              <span className="npos-capture-thumb-fail" role="img" aria-label="โหลดรูปไม่สำเร็จ">
                โหลดรูปไม่สำเร็จ
              </span>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={entry.url}
                alt={entry.label}
                onError={() => setFailed((prev) => ({ ...prev, [i]: true }))}
                onLoad={() =>
                  setFailed((prev) => {
                    if (!prev[i]) return prev;
                    const next = { ...prev };
                    delete next[i];
                    return next;
                  })
                }
              />
            )}
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
      {previewIndex != null ? (
        <ImagePreviewModal
          urls={urls}
          initialIndex={previewIndex}
          title="แคป nPos / สลิป"
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </>
  );
}
