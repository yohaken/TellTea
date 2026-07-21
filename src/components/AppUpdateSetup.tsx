"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import { CLIENT_BUILD } from "@/lib/app-update";
import { saveForceAppUpdate, subscribeAppReleaseSettings } from "@/lib/app-release";

export function AppUpdateSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [forceAppUpdate, setForceAppUpdate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeAppReleaseSettings(
      (settings) => {
        setForceAppUpdate(settings.forceAppUpdate);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดตั้งค่าอัปเดตไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  async function toggle() {
    if (!actorId) return;
    const next = !forceAppUpdate;
    setBusy(true);
    onError(null);
    try {
      await saveForceAppUpdate(next, actorId);
      setForceAppUpdate(next);
    } catch (err) {
      onError((err as Error).message || "บันทึกตั้งค่าอัปเดตไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsFold
      title={
        <>
          <RefreshCw size={18} aria-hidden />
          อัปเดตแอป
        </>
      }
      hint={
        <>
          เวอร์ชันปัจจุบันบนเครื่องนี้: <strong>v{CLIENT_BUILD}</strong>
        </>
      }
      defaultOpen={false}
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="app-release-toggle">
          <label className="app-release-toggle-row">
            <input
              type="checkbox"
              checked={forceAppUpdate}
              disabled={busy}
              onChange={() => void toggle()}
            />
            <span className="app-release-toggle-copy">
              <strong>บังคับอัปเดตทันที</strong>
              <span>
                {forceAppUpdate
                  ? "เปิดอยู่ — พนักงานทุกคนจะรีเฟรชอัตโนมัติเมื่อมีเวอร์ชันใหม่ (เหมาะช่วงพัฒนา)"
                  : "ปิดอยู่ — แจ้งแบนเนอร์ให้กดอัปเดตเองเมื่อพร้อม (เหมาะใช้งานจริง)"}
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </SettingsFold>
  );
}
