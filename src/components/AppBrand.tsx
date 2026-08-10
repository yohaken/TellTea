"use client";

import { useEffect, useState } from "react";
import {
  BRAND_LOGO_CHANGED_EVENT,
  getBrandLogoMemory,
  loadBrandLogo,
  purgeLegacyBrandLogoStorage,
} from "@/lib/brand-logo";
import { appVersionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";

export function AppBrand({
  className,
  compact = false,
  showLogo = true,
  versionLabel,
}: {
  className?: string;
  compact?: boolean;
  /** แสดงไอคอนโลโก้ข้างชื่อ */
  showLogo?: boolean;
  /** Override version line (e.g. POS build on tablet app) */
  versionLabel?: string;
}) {
  const label = versionLabel ?? appVersionLabel();
  const mem = getBrandLogoMemory();
  const [customLogoSrc, setCustomLogoSrc] = useState<string>(() => mem);
  /** Avoid flashing the stock TellTea SVG while meta/brandLogo is loading. */
  const [logoResolved, setLogoResolved] = useState(() => Boolean(mem));

  useEffect(() => {
    if (!showLogo) return;
    let cancelled = false;
    purgeLegacyBrandLogoStorage();

    void loadBrandLogo().then((src) => {
      if (cancelled) return;
      setCustomLogoSrc(src);
      setLogoResolved(true);
    });

    function onBrandLogo(ev: Event) {
      const detail = String((ev as CustomEvent).detail ?? "");
      if (!cancelled) {
        setCustomLogoSrc(detail);
        setLogoResolved(true);
      }
    }
    window.addEventListener(BRAND_LOGO_CHANGED_EVENT, onBrandLogo);
    return () => {
      cancelled = true;
      window.removeEventListener(BRAND_LOGO_CHANGED_EVENT, onBrandLogo);
    };
  }, [showLogo]);

  const useCustom = Boolean(customLogoSrc);

  return (
    <div className={cn("brand-wrap", compact && "brand-wrap-compact", className)}>
      {showLogo ? (
        useCustom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={customLogoSrc}
            alt=""
            className={cn("brand-logo brand-logo-custom", compact && "brand-logo-compact")}
            aria-hidden
          />
        ) : logoResolved ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={compact ? "/logo-mark.svg" : "/logo-telltea.svg"}
            alt=""
            className={cn("brand-logo", compact && "brand-logo-compact")}
            aria-hidden
          />
        ) : (
          <span
            className={cn("brand-logo brand-logo-slot", compact && "brand-logo-compact")}
            aria-hidden
          />
        )
      ) : null}
      <p className={cn("brand", compact && "brand-compact")}>
        <span className="brand-name">Tell Tea</span>{" "}
        <span className="brand-version" title={`build ${label}`}>
          {label}
        </span>
      </p>
    </div>
  );
}
