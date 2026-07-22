"use client";

import { useEffect, useMemo, useState } from "react";
import { Images } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { NposCaptureGallery } from "@/components/NposCaptureGallery";
import {
  formatCaptureAt,
  subscribeNposScreenShots,
  type NposScreenShot,
} from "@/lib/npos-screen-shots";
import { shortStableKey } from "@/lib/npos-device-class";
import { resolveNposCaptureDisplayUrl } from "@/lib/npos-capture-media";

/** Capture history timeline with thumbs (nposScreenShots). */
export function NposCaptureTimelinePanel({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const [shots, setShots] = useState<NposScreenShot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    return subscribeNposScreenShots(
      (next) => {
        setShots(next);
        setLoading(false);
        onError(null);
      },
      (err) => {
        setLoading(false);
        onError(err.message);
      },
      40,
    );
  }, [onError]);

  const withImages = useMemo(
    () => shots.filter((s) => !!(s.primaryUrl || s.secondaryUrl)),
    [shots],
  );
  const emptyUploads = shots.length - withImages.length;

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <Images size={16} aria-hidden />
          ไทม์ไลน์แคปจอ
        </span>
      }
      hint={
        loading
          ? "กำลังโหลด…"
          : shots.length
            ? `${withImages.length} ชุดมีรูป${emptyUploads ? ` · ${emptyUploads} ไม่มี URL` : ""}`
            : "ยังไม่มีแคป"
      }
      defaultOpen={false}
      className="npos-ops-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : shots.length === 0 ? (
        <p className="muted">ยังไม่มีประวัติแคปใน nposScreenShots</p>
      ) : (
        <ul className="npos-capture-timeline">
          {shots.slice(0, 24).map((s) => (
            <li key={s.id} className="npos-capture-timeline-item">
              <p className="npos-capture-timeline-meta">
                <strong>{formatCaptureAt(s.capturedAt)}</strong>
                <span className="muted">
                  {" "}
                  · {s.reason || "—"} · เครื่อง {shortStableKey("", s.installId)}
                  {!s.primaryUrl && !s.secondaryUrl ? " · ไม่มี URL" : ""}
                </span>
              </p>
              <NposCaptureGallery
                primaryUrl={resolveNposCaptureDisplayUrl({
                  shotId: s.id,
                  role: "primary",
                  storedUrl: s.primaryUrl,
                })}
                secondaryUrl={resolveNposCaptureDisplayUrl({
                  shotId: s.id,
                  role: "secondary",
                  storedUrl: s.secondaryUrl,
                })}
                emptyHint="อัปโหลดแล้วแต่ไม่มี URL รูป (ลองสั่งแคปใหม่หลังอัปเดตเซิร์ฟเวอร์)"
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsFold>
  );
}
