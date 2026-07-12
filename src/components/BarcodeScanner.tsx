"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const rafRef = useRef<number>(0);

  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let cancelled = false;
    setError(null);

    if (!window.BarcodeDetector) {
      setSupported(false);
      return;
    }

    const detector = new window.BarcodeDetector({
      formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"],
    });

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const code = codes[0]?.rawValue;
            if (code) {
              onDetected(code);
              onClose();
              return;
            }
          } catch {
            /* ignore frame errors */
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch (err) {
        setError((err as Error).message || "เปิดกล้องไม่ได้");
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, onClose, onDetected, stopCamera]);

  if (!open) return null;

  return (
    <div className="barcode-overlay" role="dialog" aria-label="สแกนบาร์โค้ด">
      <div className="barcode-panel">
        <header className="barcode-head">
          <strong>
            <Camera size={16} aria-hidden /> สแกนบาร์โค้ด
          </strong>
          <button type="button" className="ghost-btn barcode-close" onClick={onClose} aria-label="ปิด">
            <X size={18} />
          </button>
        </header>
        {!supported ? (
          <p className="muted barcode-fallback">
            เบราว์เซอร์นี้ไม่รองรับสแกนอัตโนมัติ — ค้นหาชื่อวัตถุดิบด้านล่างแทน
          </p>
        ) : (
          <>
            <video ref={videoRef} className="barcode-video" playsInline muted />
            <p className="muted barcode-hint">ชี้กล้องไปที่บาร์โค้ดวัตถุดิบ</p>
          </>
        )}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </div>
  );
}
