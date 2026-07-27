"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  clearNposStoreClaimCode,
  getNposStoreClaimStatus,
  setNposStoreClaimCode,
} from "@/lib/pos-devices";
import { useAuth } from "@/lib/auth";

/**
 * Owner: set shop store code (half-login). Hash only on server — tablets claim via nposClaimDevice.
 */
export function PosStoreClaimPanel({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState(false);
  const [hasCode, setHasCode] = useState(false);
  const [rejectDev, setRejectDev] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getNposStoreClaimStatus();
      setRequired(s.storeClaimRequired);
      setHasCode(s.hasCode);
      setRejectDev(s.storeClaimRejectDev);
      setUpdatedAt(s.storeClaimUpdatedAt);
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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อนตั้งรหัสร้าน");
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const res = await setNposStoreClaimCode(code, { rejectDev });
      setCode("");
      setHint(`ตั้งแล้ว · รหัสขึ้นต้น/ท้าย ${res.codeHint}`);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อน");
      return;
    }
    if (!window.confirm("ปิดเกตรหัสร้าน? เครื่องใดก็ส่งบิลได้อีก (ไม่แนะนำตอนทดลองจริง)")) {
      return;
    }
    setBusy(true);
    try {
      await clearNposStoreClaimCode();
      setHint("ปิดเกตแล้ว");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <KeyRound size={16} aria-hidden />
          รหัสร้าน · เคลมเครื่อง
        </span>
      }
      hint={
        loading
          ? "กำลังโหลด…"
          : required && hasCode
            ? `เกตเปิดอยู่ · เครื่องต้องเคลมก่อนขาย${rejectDev ? " · บล็อกเครื่องจำลอง" : ""}`
            : "ยังไม่ตั้งรหัส — ตั้งก่อนทดลองหน้าร้าน"
      }
      defaultOpen
      className="npos-store-claim-fold"
    >
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        รหัสคงที่สำหรับแท็บเล็ตร้าน (half-login) — กรอกครั้งเดียวบนเครื่อง ·
        เครื่องที่ไม่มีรหัส/ยังไม่เคลม <strong>ส่งบิลเข้าไม่ได้</strong>
      </p>
      {updatedAt > 0 ? (
        <p className="muted" style={{ marginBottom: "0.5rem" }}>
          อัปเดตล่าสุด {new Date(updatedAt).toLocaleString("th-TH")}
        </p>
      ) : null}
      <form onSubmit={(e) => void onSave(e)} className="npos-store-claim-form">
        <label className="field">
          <span>รหัสร้านใหม่ (A–Z / 0–9 · 4–16 ตัว)</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            placeholder="เช่น TELLTEA88"
            maxLength={16}
            disabled={busy}
          />
        </label>
        <label className="field checkbox-field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={rejectDev}
            onChange={(e) => setRejectDev(e.target.checked)}
            disabled={busy}
          />
          <span>ปิดกั้นเครื่องจำลอง / พัฒนา (แนะนำตอนทดลองจริง)</span>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button type="submit" className="primary-btn" disabled={busy || code.trim().length < 4}>
            {hasCode ? "เปลี่ยนรหัส + เปิดเกต" : "ตั้งรหัส + เปิดเกต"}
          </button>
          {hasCode ? (
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => void onClear()}>
              ปิดเกต
            </button>
          ) : null}
        </div>
      </form>
      {hint ? <p className="muted" style={{ marginTop: "0.75rem" }}>{hint}</p> : null}
    </SettingsFold>
  );
}
