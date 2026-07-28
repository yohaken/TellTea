"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  HEARTBEAT_INTERVAL_PRESETS,
  clampHeartbeatIntervalSec,
  getHeartbeatIntervalSec,
  setHeartbeatIntervalSec,
} from "@/lib/pos-tablet-sync";

/**
 * Owner: tablet BO-check / update-pulse cadence — change without shipping APK.
 */
export function PosTabletSyncPanel({ onError }: { onError: (msg: string | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState(5);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSec(await getHeartbeatIntervalSec());
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(nextRaw: number) {
    setBusy(true);
    setSaved(null);
    try {
      const next = await setHeartbeatIntervalSec(nextRaw);
      setSec(next);
      setSaved(`บันทึกแล้ว · แท็บเล็ตใช้ ${next} วิ หลัง heartbeat รอบถัดไป`);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsFold
      title="แท็บเล็ต · ช่วงเช็คเซิร์ฟเวอร์"
      hint={
        loading
          ? "กำลังโหลด…"
          : `ชีพจร BO / เช็คเวอร์ชัน · ตอนนี้ ${sec} วิ · เปลี่ยนได้โดยไม่ปล่อย APK`
      }
      defaultOpen={false}
      className="npos-tablet-sync-fold"
    >
      <p className="muted" style={{ marginBottom: "0.65rem", fontSize: "0.78rem" }}>
        ค่าเริ่ม 5 วิ (kick เร็ว) · ระบบนิ่งแล้วยืดได้ 10–30–120+ วิ · ช่วงที่อนุญาต 5–600
      </p>
      <div className="pos-sales-bill-chips" role="group" aria-label="ช่วงชีพจร">
        {HEARTBEAT_INTERVAL_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={sec === p ? "is-active" : ""}
            disabled={busy || loading}
            onClick={() => void save(p)}
          >
            {p} วิ
          </button>
        ))}
      </div>
      <label
        className="pos-sales-bill-search"
        style={{ marginTop: "0.65rem", display: "grid", gap: "0.25rem" }}
      >
        <span className="muted">กำหนดเอง (วินาที)</span>
        <input
          type="number"
          min={5}
          max={600}
          step={1}
          value={sec}
          disabled={busy || loading}
          onChange={(e) => setSec(clampHeartbeatIntervalSec(Number(e.target.value)))}
        />
      </label>
      <button
        type="button"
        className="primary-btn"
        style={{ marginTop: "0.55rem" }}
        disabled={busy || loading}
        onClick={() => void save(sec)}
      >
        {busy ? "กำลังบันทึก…" : "บันทึกช่วงเช็ค"}
      </button>
      {saved ? (
        <p className="ok-text" style={{ marginTop: "0.45rem", fontSize: "0.78rem" }}>
          {saved}
        </p>
      ) : null}
    </SettingsFold>
  );
}
