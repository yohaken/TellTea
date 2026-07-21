"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CLIENT_BUILD } from "@/lib/app-update";
import {
  appUpdateModeFromSettings,
  saveAppUpdateMode,
  subscribeAppReleaseSettings,
  type AppUpdateMode,
} from "@/lib/app-release";

const MODE_OPTIONS: { value: AppUpdateMode; title: string; hint: string }[] = [
  {
    value: "soft",
    title: "แจ้งแบนเนอร์",
    hint: "มีเวอร์ชันใหม่แล้วให้กดอัปเดตเอง — เหมาะใช้งานจริง",
  },
  {
    value: "force_all",
    title: "บังคับทุกเครื่อง",
    hint: "หลังบ้าน + POS รีเฟรชอัตโนมัติเมื่อว่าง — เหมาะช่วงปล่อยอัปเดตด่วน",
  },
  {
    value: "force_pos",
    title: "บังคับเฉพาะ POS",
    hint: "แท็บเล็ตรีเฟรชเมื่อตะกร้าว่าง — ไม่กระทบแท็บหลังบ้าน",
  },
];

export function AppUpdateSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [mode, setMode] = useState<AppUpdateMode>("soft");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeAppReleaseSettings(
      (settings) => {
        setMode(appUpdateModeFromSettings(settings));
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดตั้งค่าอัปเดตไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  async function selectMode(next: AppUpdateMode) {
    if (!actorId || next === mode) return;
    setBusy(true);
    onError(null);
    try {
      await saveAppUpdateMode(next, actorId);
      setMode(next);
    } catch (err) {
      onError((err as Error).message || "บันทึกตั้งค่าอัปเดตไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <RefreshCw size={18} aria-hidden />
        โหมดอัปเดต
      </h2>
      <p className="muted settings-card-lead">
        เวอร์ชันบนเครื่องนี้: <strong>v{CLIENT_BUILD}</strong> — เลือกวิธีแจ้งเมื่อมี build ใหม่
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="settings-mode-list" role="radiogroup" aria-label="โหมดอัปเดต">
          {MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className={`settings-mode-option${mode === opt.value ? " is-active" : ""}`}>
              <input
                type="radio"
                name="app-update-mode"
                value={opt.value}
                checked={mode === opt.value}
                disabled={busy}
                onChange={() => void selectMode(opt.value)}
              />
              <span className="settings-mode-copy">
                <strong>{opt.title}</strong>
                <span>{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
