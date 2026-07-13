"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  commitMenuItemSquareCrop,
  MENU_SQUARE_PX,
  releaseMenuImageCropSource,
  type MenuImageCropSource,
  type SquareCropFocal,
} from "@/lib/pos-menu-image";

const PREVIEW_PX = 280;

export function PosMenuImageCropModal({
  source,
  onCancel,
  onConfirm,
}: {
  source: MenuImageCropSource;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const [focal, setFocal] = useState<SquareCropFocal>({ x: 0.5, y: 0.5 });
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => releaseMenuImageCropSource(source);
  }, [source]);

  const previewLayout = useMemo(() => {
    const cover = Math.max(PREVIEW_PX / source.width, PREVIEW_PX / source.height) * scale;
    const dw = source.width * cover;
    const dh = source.height * cover;
    const left = PREVIEW_PX / 2 - focal.x * dw;
    const top = PREVIEW_PX / 2 - focal.y * dh;
    return { dw, dh, left, top };
  }, [source.width, source.height, focal, scale]);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY, fx: focal.x, fy: focal.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const cover = Math.max(PREVIEW_PX / source.width, PREVIEW_PX / source.height) * scale;
    const dw = source.width * cover;
    const dh = source.height * cover;
    const dx = (e.clientX - drag.x) / dw;
    const dy = (e.clientY - drag.y) / dh;
    setFocal({
      x: Math.max(0, Math.min(1, drag.fx - dx)),
      y: Math.max(0, Math.min(1, drag.fy - dy)),
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await commitMenuItemSquareCrop(source, focal, scale);
      onConfirm(dataUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="dialog" aria-modal="true">
      <div className="pos-modal pos-menu-crop-modal">
        <header className="pos-modal-head">
          <h2>ครอปรูปเมนู</h2>
          <p className="muted">ลากเพื่อจัดตำแหน่ง · รูปจะเป็นสี่เหลี่ยมจัตุรัส {MENU_SQUARE_PX}px</p>
        </header>

        <div
          ref={frameRef}
          className="pos-menu-crop-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={source.objectUrl}
            alt=""
            className="pos-menu-crop-img"
            style={{
              width: previewLayout.dw,
              height: previewLayout.dh,
              left: previewLayout.left,
              top: previewLayout.top,
            }}
            draggable={false}
          />
        </div>

        <label className="pos-menu-crop-zoom">
          <span>ซูม</span>
          <input
            type="range"
            min={1}
            max={2.5}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <footer className="pos-modal-foot">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
            ยกเลิก
          </button>
          <button type="button" className="primary-btn" onClick={() => void handleConfirm()} disabled={busy}>
            {busy ? "กำลังบันทึก..." : "ใช้รูปนี้"}
          </button>
        </footer>
      </div>
    </div>
  );
}
