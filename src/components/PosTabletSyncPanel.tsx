"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsFold } from "@/components/SettingsFold";
import { ManageEmbedSection } from "@/components/ManageEmbedSection";
import {
  HEARTBEAT_INTERVAL_PRESETS,
  clampHeartbeatIntervalSec,
  getHeartbeatIntervalSec,
  setHeartbeatIntervalSec,
} from "@/lib/pos-tablet-sync";

/**
 * Owner: tablet BO-check / update-pulse cadence — change without shipping APK.
 */
export function PosTabletSyncPanel({
  onError,
  embedded = false,
}: {
  onError: (msg: string | null) => void;
  embedded?: boolean;
}) {
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

  const foldHint = loading
    ? "กำลังโหลด…"
    : `ชีพจร BO / เช็คเวอร์ชัน · ตอนนี้ ${sec} วิ`;

  const body = (
    <>
      <p className="muted npos-slim-empty">
        ค่าเริ่ม 5 วิ · นิ่งแล้วยืดได้ · ช่วง 5–600
      </p>
      <div className="npos-slim-filters" role="group" aria-label="ช่วงชีพจร">
        {HEARTBEAT_INTERVAL_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`npos-slim-text-btn ${sec === p ? "is-active" : ""}`}
            disabled={busy || loading}
            onClick={() => void save(p)}
          >
            {p}วิ
          </button>
        ))}
      </div>
      <label className="npos-slim-custom-sec">
        <span className="muted">กำหนดเอง (วิ)</span>
        <input
          type="number"
          min={5}
          max={600}
          step={1}
          value={sec}
          disabled={busy || loading}
          onChange={(e) => setSec(clampHeartbeatIntervalSec(Number(e.target.value)))}
        />
        <button
          type="button"
          className="npos-slim-text-btn is-active"
          disabled={busy || loading}
          onClick={() => void save(sec)}
        >
          {busy ? "บันทึก…" : "บันทึก"}
        </button>
      </label>
      {saved ? <p className="ok-text npos-slim-empty">{saved}</p> : null}
    </>
  );

  if (embedded) {
    return (
      <ManageEmbedSection title="ช่วงเช็คเซิร์ฟเวอร์" hint={foldHint}>
        {body}
      </ManageEmbedSection>
    );
  }

  return (
    <SettingsFold
      title="แท็บเล็ต · ช่วงเช็คเซิร์ฟเวอร์"
      hint={foldHint}
      defaultOpen={false}
      className="npos-tablet-sync-fold"
    >
      {body}
    </SettingsFold>
  );
}
