"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  BRAND_LOGO_CHANGED_EVENT,
  getBrandLogoMemory,
  loadBrandLogo,
  purgeLegacyBrandLogoStorage,
} from "@/lib/brand-logo";

/**
 * โลโก้ร้านจาก meta/brandLogo (ชุดเดียวกับหัวสลิป/ใบเสร็จ)
 * ถ้ายังไม่อัปโหลด ใช้ mark สำรองชั่วคราว
 */
export function PointsGameBrandLogo({
  className = "",
  alt = "โลโก้ร้าน",
  size,
  onLoadFailed,
}: {
  className?: string;
  alt?: string;
  size?: number;
  onLoadFailed?: () => void;
}) {
  const mem = getBrandLogoMemory();
  const [src, setSrc] = useState(mem);
  const [resolved, setResolved] = useState(Boolean(mem));

  useEffect(() => {
    let cancelled = false;
    purgeLegacyBrandLogoStorage();
    void loadBrandLogo().then((next) => {
      if (cancelled) return;
      setSrc(next);
      setResolved(true);
    });
    function onBrand(ev: Event) {
      const detail = String((ev as CustomEvent).detail ?? "");
      if (!cancelled) {
        setSrc(detail);
        setResolved(true);
      }
    }
    window.addEventListener(BRAND_LOGO_CHANGED_EVENT, onBrand);
    return () => {
      cancelled = true;
      window.removeEventListener(BRAND_LOGO_CHANGED_EVENT, onBrand);
    };
  }, []);

  const style: CSSProperties | undefined =
    size && size > 0 ? { width: size, height: size, objectFit: "contain" } : undefined;

  if (!resolved && !src) {
    return (
      <span
        className={`pts-game-logo pts-game-logo--slot ${className}`.trim()}
        style={style}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || "/logo-mark.svg"}
      alt={alt}
      className={`pts-game-logo ${className}`.trim()}
      style={style}
      draggable={false}
      onError={() => onLoadFailed?.()}
    />
  );
}
