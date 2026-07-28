"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { ManageEmbedSection } from "@/components/ManageEmbedSection";
import {
  clearNposExclusiveSeat,
  clearNposStoreClaimCode,
  getNposStoreClaimStatus,
  setNposStoreClaimCode,
} from "@/lib/pos-devices";
import { useAuth } from "@/lib/auth";

/**
 * Owner: set shop store code (half-login). Hash only on server — tablets claim via nposClaimDevice.
 */
export function PosStoreClaimPanel({
  onError,
  embedded = false,
}: {
  onError: (msg: string | null) => void;
  embedded?: boolean;
}) {
  const { actorId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState(false);
  const [hasCode, setHasCode] = useState(false);
  const [rejectDev, setRejectDev] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [activeSeatId, setActiveSeatId] = useState("");
  const [seatMode, setSeatMode] = useState<"exclusive" | "multi">("exclusive");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getNposStoreClaimStatus();
      setRequired(s.storeClaimRequired);
      setHasCode(s.hasCode);
      setRejectDev(s.storeClaimRejectDev);
      setUpdatedAt(s.storeClaimUpdatedAt);
      setActiveSeatId(s.activeSeatInstallId || "");
      setSeatMode(s.seatMode || "exclusive");
      setCurrentCode(s.storeClaimCode || "");
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
      setHint(
        hasCode
          ? `เปลี่ยนรหัสแล้ว (${res.codeHint}) · เตะ ${res.revokedCount} เครื่อง — แท็บเล็ตใส่รหัสใหม่`
          : `ตั้งรหัสแล้ว (${res.codeHint}) · เปิดเกตแล้ว — ไปแท็บเล็ตกรอกรหัสนี้ที่หน้าเข้างาน`,
      );
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

  async function onClearSeat() {
    if (!actorId) {
      onError("ต้องเข้าสู่ระบบเจ้าของก่อน");
      return;
    }
    if (
      !window.confirm(
        "เคลียร์สิทธิ์ทุกเครื่อง + ว่าง seat? แท็บเล็ตจะเด้งไปใส่รหัสใหม่ (กะไม่ปิด)",
      )
    ) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const res = await clearNposExclusiveSeat();
      setActiveSeatId("");
      setHint(
        `เคลียร์แล้ว · เตะ ${res.revokedCount} เครื่อง — กรอกรหัสบนแท็บเล็ตใหม่ได้เลย`,
      );
      await refresh();
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const foldHint = loading
    ? "กำลังโหลด…"
    : required && hasCode
      ? `เกตเปิด · โหมดเครื่องเดียว${activeSeatId ? ` · seat ${activeSeatId.slice(-6).toUpperCase()}` : " · ว่าง"}${rejectDev ? " · บล็อกจำลอง" : ""}`
      : "ยังไม่ตั้งรหัส — แท็บเล็ตเข้าไม่ได้จนกว่าจะตั้งด้านล่าง";

  const body = (
    <>
      {!loading && !hasCode ? (
        <p className="error-text npos-slim-warn-banner">
          ยังไม่ได้ตั้งรหัสร้าน — แท็บเล็ตเข้าไม่ได้จนกว่าจะกด{" "}
          <strong>ตั้งรหัส + เปิดเกต</strong>
        </p>
      ) : null}
      <p className="muted npos-slim-empty">
        รหัสลับ 1:1 · เครื่องเดียวถือสิทธิ์ขาย · เตะ/เคลียร์ seat ≠ ปิดกะ
      </p>
      {seatMode === "exclusive" && required ? (
        <p className="muted npos-slim-empty">
          Seat: {activeSeatId ? activeSeatId.slice(-8).toUpperCase() : "— ว่าง —"}
        </p>
      ) : null}
      {hasCode ? (
        <div className="npos-slim-code-bar">
          <span className="muted">รหัสร้าน</span>
          {currentCode ? (
            <strong className="npos-slim-code">{currentCode}</strong>
          ) : (
            <span className="muted">มีบนเซิร์ฟเวอร์แล้ว — เปลี่ยนรหัสอีกครั้งเพื่อจำตัวเต็ม</span>
          )}
        </div>
      ) : null}
      {updatedAt > 0 ? (
        <p className="muted npos-slim-empty">
          อัปเดต {new Date(updatedAt).toLocaleString("th-TH")}
        </p>
      ) : null}
      <form onSubmit={(e) => void onSave(e)} className="npos-store-claim-form npos-store-claim-form--slim">
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
        <label className="field checkbox-field npos-slim-check">
          <input
            type="checkbox"
            checked={rejectDev}
            onChange={(e) => setRejectDev(e.target.checked)}
            disabled={busy}
          />
          <span>ปิดกั้นเครื่องจำลอง / พัฒนา</span>
        </label>
        <div className="npos-slim-filters">
          <button
            type="submit"
            className="npos-slim-text-btn is-active"
            disabled={busy || code.trim().length < 4}
          >
            {hasCode ? "เปลี่ยนรหัส + เปิดเกต" : "ตั้งรหัส + เปิดเกต"}
          </button>
          <button
            type="button"
            className="npos-slim-text-btn"
            disabled={busy || (!hasCode && !activeSeatId)}
            onClick={() => void onClearSeat()}
          >
            เคลียร์ seat
          </button>
          {hasCode ? (
            <button
              type="button"
              className="npos-slim-text-btn npos-slim-text-btn--danger"
              disabled={busy}
              onClick={() => void onClear()}
            >
              ปิดเกต
            </button>
          ) : null}
        </div>
      </form>
      {hint ? <p className="ok-text npos-slim-empty">{hint}</p> : null}
    </>
  );

  if (embedded) {
    return (
      <ManageEmbedSection title="รหัสร้าน · seat" hint={foldHint}>
        {body}
      </ManageEmbedSection>
    );
  }

  return (
    <SettingsFold
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <KeyRound size={16} aria-hidden />
          รหัสร้าน · เคลมเครื่อง
        </span>
      }
      hint={foldHint}
      defaultOpen={false}
      className="npos-store-claim-fold"
    >
      {body}
    </SettingsFold>
  );
}
