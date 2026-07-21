"use client";

import { useEffect, useState } from "react";
import { appVersionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";
import { getBusinessProfile } from "@/lib/business-profile";
import { resolveEvidencePhotoSrc } from "@/lib/evidence-photos";

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
  const [customLogoSrc, setCustomLogoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!showLogo) return;
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getBusinessProfile();
        const url = (profile.logoUrl || "").trim();
        if (!url) {
          if (!cancelled) setCustomLogoSrc(null);
          return;
        }
        const src = await resolveEvidencePhotoSrc(url);
        if (!cancelled) setCustomLogoSrc(src || null);
      } catch {
        if (!cancelled) setCustomLogoSrc(null);
      }
    })();
    return () => {
      cancelled = true;
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
              src={customLogoSrc!}
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
