"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, Download, ImageIcon, ImageOff, Loader2, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { resolveEvidencePhotoSrcList } from "@/lib/evidence-photos";
import { saveImageToDevice } from "@/lib/receipts";

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
  const [resolved, setResolved] = useState<string[]>(list);
  const [resolving, setResolving] = useState(true);
  const [imgLoading, setImgLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const touchStartX = useRef<number | null>(null);
  const current = resolved[idx] || "";
  const loading = resolving || (!!current && imgLoading && !error);
  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setError("");
    setSaveMsg("");
    void resolveEvidencePhotoSrcList(list)
      .then((srcs) => {
        if (cancelled) return;
        setResolved(srcs);
        setResolving(false);
        setImgLoading(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || "โหลดรูปไม่สำเร็จ");
        setResolving(false);
        setImgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [list.join("|")]);

  useEffect(() => {
    setImgLoading(true);
    setSaveMsg("");
  }, [idx, current]);

  function prev() {
    if (list.length <= 1) return;
    setIdx((i) => (i <= 0 ? list.length - 1 : i - 1));
  }

  function next() {
    if (list.length <= 1) return;
    setIdx((i) => (i >= list.length - 1 ? 0 : i + 1));
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  }

  function onTouchEnd(e: TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX == null || list.length <= 1) return;
    const endX = e.changedTouches[0]?.clientX;
    if (endX == null) return;
    const dx = endX - startX;
    if (Math.abs(dx) < 48) return;
    if (dx < 0) next();
    else prev();
  }

  async function onDownload() {
    if (!current || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(current);
      if (!res.ok) throw new Error("ดาวน์โหลดรูปไม่สำเร็จ");
      const blob = await res.blob();
      const ext = (blob.type || "").includes("png")
        ? "png"
        : (blob.type || "").includes("webp")
          ? "webp"
          : "jpg";
      const file = new File([blob], `telltea-photo-${Date.now()}.${ext}`, {
        type: blob.type || "image/jpeg",
      });
      const mode = await saveImageToDevice(file);
      setSaveMsg(mode === "shared" ? "แชร์/บันทึกแล้ว" : "บันทึกลงเครื่องแล้ว");
    } catch (err) {
      setSaveMsg((err as Error).message || "บันทึกรูปไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
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
        <div className="photo-preview-head">
          <p className="photo-preview-title">
            {title || "ดูรูป"}
            {list.length > 1 ? ` (${idx + 1}/${list.length})` : ""}
          </p>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div
          className="photo-preview-stage"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {loading ? (
            <div className="photo-preview-loading" aria-busy="true" aria-live="polite">
              <Loader2 className="photo-preview-spinner" size={36} aria-hidden />
              <p className="muted">กำลังโหลดรูป…</p>
            </div>
          ) : null}
          {error ? <p className="error-text photo-preview-error">{error}</p> : null}
          {!resolving && !error && current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current}
              alt=""
              className="photo-preview-full"
              style={{ opacity: imgLoading ? 0 : 1 }}
              onLoad={() => setImgLoading(false)}
              onError={() => {
                setImgLoading(false);
                setError("แสดงรูปไม่สำเร็จ");
              }}
              draggable={false}
            />
          ) : null}
        </div>

        {list.length > 1 ? (
          <div className="photo-preview-nav">
            <button type="button" className="ghost-btn" onClick={prev} aria-label="รูปก่อนหน้า">
              <ChevronLeft size={18} />
            </button>
            <span className="muted">
              {idx + 1} / {list.length}
              <span className="photo-preview-swipe-hint"> · ปัดซ้าย/ขวา</span>
            </span>
            <button type="button" className="ghost-btn" onClick={next} aria-label="รูปถัดไป">
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}

        <div className="photo-preview-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={!current || loading || saving}
            onClick={() => void onDownload()}
          >
            <Download size={16} aria-hidden />
            {saving ? "กำลังบันทึก..." : "บันทึกลงเครื่อง"}
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
        {saveMsg ? <p className="muted photo-preview-save-msg">{saveMsg}</p> : null}
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
