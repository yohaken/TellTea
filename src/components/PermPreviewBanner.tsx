"use client";

import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function PermPreviewBanner() {
  const router = useRouter();
  const { isPermPreview, permPreview, stopPermPreview } = useAuth();
  if (!isPermPreview || !permPreview) return null;

  return (
    <div className="perm-preview-banner" role="status">
      <div className="perm-preview-banner-text">
        <strong>มุมมองพนักงาน</strong>
        <span className="perm-preview-banner-label">{permPreview.label}</span>
        <span className="muted perm-preview-banner-hint">
          ดูอย่างเดียว · แตะไอคอนเขียวซ้ำเพื่อออก
        </span>
      </div>
      <button
        type="button"
        className="primary-btn staff-btn-sm perm-preview-exit"
        onClick={() => {
          stopPermPreview();
          router.replace("/staff/");
        }}
      >
        <EyeOff size={14} aria-hidden />
        ออก
      </button>
    </div>
  );
}
