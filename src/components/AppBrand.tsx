"use client";

import { useEffect, useState } from "react";
import {
  BRAND_LOGO_CHANGED_EVENT,
  getBusinessProfile,
  peekCachedBrandLogo,
  cacheBrandLogo,
} from "@/lib/business-profile";
import { isEvidencePhotoRef, resolveEvidencePhotoSrc } from "@/lib/evidence-photos";
import { appVersionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";

async function resolveBrandLogoSrc(raw: string): Promise<string> {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;
  if (isEvidencePhotoRef(url)) {
    try {
      return await resolveEvidencePhotoSrc(url);
    } catch {
      return "";
    }
  }
  return url;
}

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
  const [customLogoSrc, setCustomLogoSrc] = useState<string>(() => peekCachedBrandLogo());

  useEffect(() => {
    if (!showLogo) return;
    let cancelled = false;

    async function applyRaw(raw: string) {
      const src = await resolveBrandLogoSrc(raw);
      if (cancelled) return;
      setCustomLogoSrc(src);
      if (src.startsWith("data:") || /^https?:\/\//i.test(src)) {
        cacheBrandLogo(src);
      }
    }

    void (async () => {
      const cached = peekCachedBrandLogo();
      if (cached && !cancelled) {
        await applyRaw(cached);
      }
      try {
        const profile = await getBusinessProfile();
        const url = (profile.logoUrl || "").trim();
        if (!cancelled) await applyRaw(url);
      } catch {
        /* keep cache / empty → fallback SVG */
      }
    })();

    function onBrandLogo(ev: Event) {
      const detail = String((ev as CustomEvent).detail ?? "").trim();
      void applyRaw(detail);
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
          <span
            className={cn("brand-logo-dark-pad", compact && "brand-logo-dark-pad-compact")}
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={customLogoSrc}
              alt=""
              className={cn("brand-logo brand-logo-custom", compact && "brand-logo-compact")}
            />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={compact ? "/logo-mark.svg" : "/logo-telltea.svg"}
            alt=""
            className={cn("brand-logo", compact && "brand-logo-compact")}
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
