"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
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

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 280;
const SWIPE_PX = 56;
/** ปัดลงเกินนี้ (เมื่อยังไม่ซูม) → ปิดเหมือนปุ่ม X */
const DISMISS_DY = 96;

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * ดูรูปเต็มจอ · คุณภาพสูงสุด · ซูม/ย่อด้วยนิ้ว · ปัดซ้าย-ขวาเปลี่ยนรูป (เมื่อยังไม่ซูม)
 * ใช้ร่วมทุกโมดูลที่แตะดูหลักฐาน
 */
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
  /** bump เพื่อ remount <img> ถ้าโหลดค้าง (เช่น Safari พลาด onLoad จากแคช) */
  const [imgEpoch, setImgEpoch] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  /** เลื่อนลงชั่วคราวตอนปัดเพื่อปิด (ยังไม่ซูม) */
  const [dismissY, setDismissY] = useState(0);
  const saveCancelRef = useRef(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointers = useRef<Map<number, Pt>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number; mid: Pt; tx: number; ty: number } | null>(
    null,
  );
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const dismissYRef = useRef(0);
  const imgLoadingRef = useRef(true);

  const current = resolved[idx] || "";
  const loading = resolving || (!!current && imgLoading && !error);
  useBodyScrollLock(true);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  /** ปุ่มย้อนกลับ / gesture กลับของมือถือ → ปิดแค่ตัวดูรูป ไม่หลุดฟอร์ม */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const token = `photo-fs:${Date.now()}`;
    window.history.pushState({ photoFs: token }, "");
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (
        !closedByPop &&
        window.history.state &&
        (window.history.state as { photoFs?: string }).photoFs === token
      ) {
        window.history.back();
      }
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function markImgReady() {
    imgLoadingRef.current = false;
    setImgLoading(false);
  }

  function markImgPending() {
    imgLoadingRef.current = true;
    setImgLoading(true);
  }

  /** Safari/Mac: รูปจากแคชมัก complete ก่อน onLoad ถูกผูก — ต้องเช็คเอง */
  function syncImgReadyFromEl(el: HTMLImageElement | null) {
    if (!el) return;
    if (el.complete && el.naturalWidth > 0) {
      markImgReady();
    }
  }

  useEffect(() => {
    transformRef.current = { scale, tx, ty };
  }, [scale, tx, ty]);

  useEffect(() => {
    dismissYRef.current = dismissY;
  }, [dismissY]);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setError("");
    setSaveMsg("");
    markImgPending();
    void resolveEvidencePhotoSrcList(list)
      .then((srcs) => {
        if (cancelled) return;
        setResolved(srcs);
        setResolving(false);
        markImgPending();
        // ให้รอบ paint ถัดไปเช็ค complete (กรณี data:/https แคชแล้ว)
        requestAnimationFrame(() => {
          if (cancelled) return;
          syncImgReadyFromEl(imgRef.current);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || "โหลดรูปไม่สำเร็จ");
        setResolving(false);
        markImgReady();
      });
    return () => {
      cancelled = true;
    };
  }, [list.join("|")]);

  useEffect(() => {
    markImgPending();
    setSaveMsg("");
    setScale(1);
    setTx(0);
    setTy(0);
    setDismissY(0);
    dismissYRef.current = 0;
    transformRef.current = { scale: 1, tx: 0, ty: 0 };
    pointers.current.clear();
    pinchStart.current = null;
    panStart.current = null;
    swipeStart.current = null;
    // หลังเปลี่ยนรูป/src — เช็คแคชทันที + อีกครั้งหลัง paint
    const a = requestAnimationFrame(() => syncImgReadyFromEl(imgRef.current));
    const b = window.setTimeout(() => syncImgReadyFromEl(imgRef.current), 0);
    return () => {
      cancelAnimationFrame(a);
      window.clearTimeout(b);
    };
  }, [idx, current, imgEpoch]);

  const loadRetryRef = useRef(0);

  /** ถ้าสปินเนอร์ค้าง — รีเฟรชตัวเอง: เช็ค complete / remount img / โชว์รูปที่มีอยู่ */
  useEffect(() => {
    if (!loading || !current || error) {
      loadRetryRef.current = 0;
      return;
    }
    const t = window.setTimeout(() => {
      const el = imgRef.current;
      if (el?.complete && el.naturalWidth > 0) {
        markImgReady();
        return;
      }
      if (loadRetryRef.current < 2) {
        loadRetryRef.current += 1;
        setImgEpoch((n) => n + 1);
        return;
      }
      // สุดท้าย: ถ้ามี src แล้วให้โชว์ แม้พลาด onLoad (กันหมุนค้างบน Mac)
      if (el?.getAttribute("src")) {
        markImgReady();
      }
    }, 1400);
    return () => window.clearTimeout(t);
  }, [loading, current, error, imgEpoch]);

  function clampPan(nextScale: number, nextTx: number, nextTy: number) {
    const stage = stageRef.current;
    if (!stage || nextScale <= 1) return { tx: 0, ty: 0 };
    const maxX = (stage.clientWidth * (nextScale - 1)) / 2;
    const maxY = (stage.clientHeight * (nextScale - 1)) / 2;
    return {
      tx: Math.min(maxX, Math.max(-maxX, nextTx)),
      ty: Math.min(maxY, Math.max(-maxY, nextTy)),
    };
  }

  function applyTransform(nextScale: number, nextTx: number, nextTy: number) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const pan = clampPan(s, nextTx, nextTy);
    setScale(s);
    setTx(pan.tx);
    setTy(pan.ty);
    transformRef.current = { scale: s, tx: pan.tx, ty: pan.ty };
  }

  function prev() {
    if (list.length <= 1) return;
    setIdx((i) => (i <= 0 ? list.length - 1 : i - 1));
  }

  function next() {
    if (list.length <= 1) return;
    setIdx((i) => (i >= list.length - 1 ? 0 : i + 1));
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const { scale: s, tx: curTx, ty: curTy } = transformRef.current;
      pinchStart.current = {
        dist: Math.max(1, dist(a, b)),
        scale: s,
        mid: mid(a, b),
        tx: curTx,
        ty: curTy,
      };
      panStart.current = null;
      swipeStart.current = null;
      return;
    }

    if (pointers.current.size === 1) {
      const { scale: s, tx: curTx, ty: curTy } = transformRef.current;
      if (s > 1.02) {
        panStart.current = { x: e.clientX, y: e.clientY, tx: curTx, ty: curTy };
        swipeStart.current = null;
      } else {
        panStart.current = null;
        swipeStart.current = { x: e.clientX, y: e.clientY };
      }
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchStart.current) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const d = Math.max(1, dist(a, b));
      const start = pinchStart.current;
      const nextScale = start.scale * (d / start.dist);
      const m = mid(a, b);
      const dx = m.x - start.mid.x;
      const dy = m.y - start.mid.y;
      applyTransform(nextScale, start.tx + dx, start.ty + dy);
      return;
    }

    if (pointers.current.size === 1 && panStart.current && transformRef.current.scale > 1.02) {
      const p = panStart.current;
      applyTransform(
        transformRef.current.scale,
        p.tx + (e.clientX - p.x),
        p.ty + (e.clientY - p.y),
      );
      return;
    }

    // ปัดลงเมื่อยังไม่ซูม — เลื่อนตามนิ้วเพื่อบอกว่ากำลังจะปิด
    if (
      pointers.current.size === 1 &&
      swipeStart.current &&
      transformRef.current.scale <= 1.02
    ) {
      const dy = e.clientY - swipeStart.current.y;
      const dx = e.clientX - swipeStart.current.x;
      if (dy > 0 && Math.abs(dy) >= Math.abs(dx)) {
        const nextY = Math.min(220, dy);
        dismissYRef.current = nextY;
        setDismissY(nextY);
      } else if (dismissYRef.current !== 0) {
        dismissYRef.current = 0;
        setDismissY(0);
      }
    }
  }

  function endPointer(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);

    if (pointers.current.size < 2) pinchStart.current = null;

    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.entries()][0];
      if (remaining) {
        const [, pt] = remaining;
        const { scale: s, tx: curTx, ty: curTy } = transformRef.current;
        if (s > 1.02) {
          panStart.current = { x: pt.x, y: pt.y, tx: curTx, ty: curTy };
          swipeStart.current = null;
        }
      }
      return;
    }

    if (pointers.current.size === 0) {
      const swipe = swipeStart.current;
      panStart.current = null;
      swipeStart.current = null;

      // double-tap zoom
      const now = Date.now();
      const prevTap = lastTap.current;
      if (
        prevTap &&
        now - prevTap.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 36
      ) {
        lastTap.current = null;
        if (transformRef.current.scale > 1.05) {
          applyTransform(1, 0, 0);
        } else {
          applyTransform(2.5, 0, 0);
        }
        return;
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };

      // swipe when not zoomed: down → close · left/right → change photo
      if (swipe && transformRef.current.scale <= 1.02) {
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (dy >= DISMISS_DY && dy > Math.abs(dx) * 1.15) {
          setDismissY(0);
          dismissYRef.current = 0;
          onClose();
          return;
        }
        if (
          list.length > 1 &&
          Math.abs(dx) >= SWIPE_PX &&
          Math.abs(dx) > Math.abs(dy) * 1.2
        ) {
          setDismissY(0);
          dismissYRef.current = 0;
          if (dx < 0) next();
          else prev();
          return;
        }
      }
      setDismissY(0);
      dismissYRef.current = 0;
    }
  }

  useEffect(() => {
    saveCancelRef.current = false;
    return () => {
      saveCancelRef.current = true;
    };
  }, []);

  async function srcToFile(src: string, index: number): Promise<File> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`ดาวน์โหลดรูปที่ ${index + 1} ไม่สำเร็จ`);
    const blob = await res.blob();
    const ext = (blob.type || "").includes("png")
      ? "png"
      : (blob.type || "").includes("webp")
        ? "webp"
        : "jpg";
    return new File([blob], `telltea-photo-${index + 1}-${Date.now()}.${ext}`, {
      type: blob.type || "image/jpeg",
    });
  }

  async function onDownload() {
    if (!current || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const file = await srcToFile(current, idx);
      if (saveCancelRef.current) return;
      const mode = await saveImageToDevice(file);
      if (saveCancelRef.current) return;
      setSaveMsg(mode === "shared" ? "แชร์/บันทึกแล้ว" : "บันทึกลงเครื่องแล้ว");
    } catch (err) {
      if (!saveCancelRef.current) {
        setSaveMsg((err as Error).message || "บันทึกรูปไม่สำเร็จ");
      }
    } finally {
      if (!saveCancelRef.current) setSaving(false);
    }
  }

  async function onDownloadAll() {
    const srcs = resolved.map(String).filter((u) => u.trim());
    if (srcs.length < 2 || saving) return;
    setSaving(true);
    setSaveMsg(`กำลังเตรียม ${srcs.length} รูป…`);
    try {
      const files: File[] = [];
      for (let i = 0; i < srcs.length; i++) {
        if (saveCancelRef.current) return;
        setSaveMsg(`กำลังโหลดรูป ${i + 1}/${srcs.length}…`);
        files.push(await srcToFile(srcs[i]!, i));
      }
      if (saveCancelRef.current) return;

      const canShareMany =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        (!navigator.canShare || navigator.canShare({ files }));

      if (canShareMany) {
        try {
          await navigator.share({
            files,
            title: title || "รูปหลักฐาน TellTea",
          });
          if (!saveCancelRef.current) setSaveMsg(`แชร์/บันทึกแล้วทั้ง ${files.length} รูป`);
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") {
            if (!saveCancelRef.current) setSaveMsg("ยกเลิกการบันทึก");
            return;
          }
          // fall through to sequential download
        }
      }

      for (let i = 0; i < files.length; i++) {
        if (saveCancelRef.current) return;
        setSaveMsg(`กำลังบันทึก ${i + 1}/${files.length}…`);
        await saveImageToDevice(files[i]!);
      }
      if (!saveCancelRef.current) {
        setSaveMsg(`บันทึกลงเครื่องแล้วทั้ง ${files.length} รูป`);
      }
    } catch (err) {
      if (!saveCancelRef.current) {
        setSaveMsg((err as Error).message || "บันทึกทุกรูปไม่สำเร็จ");
      }
    } finally {
      if (!saveCancelRef.current) setSaving(false);
    }
  }

  const dismissOpacity = dismissY > 0 ? Math.max(0.35, 1 - dismissY / 280) : 1;

  const viewer = (
    <div
      className="photo-fs-root"
      role="dialog"
      aria-modal="true"
      aria-label={title || "ดูรูปเต็มจอ"}
      style={dismissY > 0 ? { background: `rgba(0, 0, 0, ${0.92 * dismissOpacity})` } : undefined}
    >
      <div className="photo-fs-chrome photo-fs-top">
        <p className="photo-fs-title">
          {title || "ดูรูป"}
          {list.length > 1 ? ` · ${idx + 1}/${list.length}` : ""}
        </p>
        <button
          type="button"
          className="photo-fs-icon-btn photo-fs-close-btn"
          aria-label="ปิด"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={26} strokeWidth={2.4} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="photo-fs-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={(e) => {
          e.preventDefault();
          if (transformRef.current.scale > 1.05) applyTransform(1, 0, 0);
          else applyTransform(2.5, 0, 0);
        }}
      >
        {loading ? (
          <div className="photo-fs-loading" aria-busy="true" aria-live="polite">
            <Loader2 className="photo-preview-spinner" size={40} aria-hidden />
            <p>กำลังโหลดรูปคุณภาพสูง…</p>
          </div>
        ) : null}
        {error ? <p className="photo-fs-error">{error}</p> : null}
        {!error && current && !current.startsWith("evp:") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${current}|${imgEpoch}`}
            ref={(el) => {
              imgRef.current = el;
              syncImgReadyFromEl(el);
            }}
            src={current}
            alt=""
            className="photo-fs-img"
            style={{
              opacity: imgLoading ? 0 : dismissOpacity,
              transform: `translate3d(${tx}px, ${ty + dismissY}px, 0) scale(${scale})`,
            }}
            onLoad={(e) => {
              syncImgReadyFromEl(e.currentTarget);
              markImgReady();
            }}
            onError={() => {
              markImgReady();
              setError("แสดงรูปไม่สำเร็จ");
            }}
            draggable={false}
          />
        ) : null}
      </div>

      <div className="photo-fs-chrome photo-fs-bottom">
        {list.length > 1 ? (
          <div className="photo-fs-nav">
            <button type="button" className="photo-fs-icon-btn" onClick={prev} aria-label="รูปก่อนหน้า">
              <ChevronLeft size={22} />
            </button>
            <span className="photo-fs-nav-label">
              {idx + 1} / {list.length}
              <span className="photo-fs-hint"> · ปัดซ้ายขวา · ปัดลงปิด · บีบซูม</span>
            </span>
            <button type="button" className="photo-fs-icon-btn" onClick={next} aria-label="รูปถัดไป">
              <ChevronRight size={22} />
            </button>
          </div>
        ) : (
          <p className="photo-fs-hint-solo">ปัดลง / กากบาท / ย้อนกลับ เพื่อปิด · แตะสองครั้งหรือบีบนิ้วเพื่อซูม</p>
        )}
        <div className="photo-fs-actions">
          <button
            type="button"
            className="photo-fs-download"
            disabled={!current || loading || saving}
            onClick={() => void onDownload()}
          >
            <Download size={16} aria-hidden />
            {saving ? "กำลังบันทึก..." : "บันทึกรูปนี้"}
          </button>
          {resolved.filter(Boolean).length > 1 ? (
            <button
              type="button"
              className="photo-fs-download is-all"
              disabled={loading || saving || resolving}
              onClick={() => void onDownloadAll()}
            >
              <Download size={16} aria-hidden />
              {saving ? "กำลังบันทึก..." : `บันทึกทุกรูป (${resolved.filter(Boolean).length})`}
            </button>
          ) : null}
          <button
            type="button"
            className="photo-fs-download photo-fs-close-wide"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
            ปิด
          </button>
        </div>
        {saveMsg ? <p className="photo-fs-save-msg">{saveMsg}</p> : null}
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(viewer, document.body);
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
