"use client";

import { useEffect, useMemo, useState } from "react";
import { Images } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { NposCaptureGallery } from "@/components/NposCaptureGallery";
import {
  formatCaptureAt,
  NPOS_CAPTURE_MAX_KEEP,
  subscribeNposScreenShots,
  type NposScreenShot,
} from "@/lib/npos-screen-shots";
import { shortStableKey } from "@/lib/npos-device-class";
import { resolveNposCaptureDisplayUrl } from "@/lib/npos-capture-media";
import { clearAllNposCaptures } from "@/lib/pos-devices";
import { useAuth } from "@/lib/auth";

/** Capture history timeline with thumbs (nposScreenShots). */
export function NposCaptureTimelinePanel({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const { actorId } = useAuth();
  const [shots, setShots] = useState<NposScreenShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

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
      NPOS_CAPTURE_MAX_KEEP,
    );
  }, [onError]);

  const withImages = useMemo(
    () => shots.filter((s) => !!(s.primaryUrl || s.secondaryUrl)),
    [shots],
  );
  const emptyUploads = shots.length - withImages.length;

  async function clearAll() {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนล้างภาพแคป");
      return;
    }
    if (
      !window.confirm(
        "ล้างภาพแคปทั้งหมดในร้าน?\nลบทุกรูปจากที่เก็บและไทม์ไลน์ — กู้คืนไม่ได้",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const n = await clearAllNposCaptures(actorId);
      setShots([]);
      onError(null);
      window.alert(n > 0 ? `ลบแล้ว ${n} ชุด` : "ไม่มีภาพให้ลบ");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

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
            ? `${withImages.length} ชุดมีรูป${emptyUploads ? ` · ${emptyUploads} ไม่มี URL` : ""} · เก็บสูงสุด ${NPOS_CAPTURE_MAX_KEEP}/เครื่อง`
            : "ยังไม่มีแคป"
      }
      defaultOpen={false}
      className="npos-ops-fold"
    >
      <div className="npos-capture-timeline-toolbar">
        <button
          type="button"
          className="npos-device-btn npos-device-btn--danger"
          disabled={clearing || loading || shots.length === 0}
          onClick={() => void clearAll()}
        >
          {clearing ? "กำลังล้าง…" : "ล้างรูปเคลียร์ทั้งหมด"}
        </button>
        <p className="muted npos-capture-caption">
          แสดงเต็มความละเอียด · เก็บไม่เกิน {NPOS_CAPTURE_MAX_KEEP} รูป/เครื่อง (ลบเก่าอัตโนมัติ)
        </p>
      </div>
      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : shots.length === 0 ? (
        <p className="muted">ยังไม่มีประวัติแคปใน nposScreenShots</p>
      ) : (
        <ul className="npos-capture-timeline">
          {shots.map((s) => (
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
