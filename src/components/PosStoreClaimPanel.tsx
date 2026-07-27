"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
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
export function PosStoreClaimPanel({ onError }: { onError: (msg: string | null) => void }) {
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
            ? `เกตเปิด · โหมดเครื่องเดียว${activeSeatId ? ` · seat ${activeSeatId.slice(-6).toUpperCase()}` : " · ว่าง"}${rejectDev ? " · บล็อกจำลอง" : ""}`
            : "ยังไม่ตั้งรหัส — แท็บเล็ตเข้าไม่ได้จนกว่าจะตั้งด้านล่าง"
      }
      defaultOpen
      className="npos-store-claim-fold"
    >
      {!loading && !hasCode ? (
        <p
          className="error-text"
          style={{
            marginBottom: "0.75rem",
            padding: "0.65rem 0.75rem",
            borderRadius: 8,
            background: "#fff4e8",
            border: "1px solid #f0c9a0",
          }}
        >
          ยังไม่ได้ตั้งรหัสร้านบน Firebase — แท็บเล็ตใส่รหัสแล้วเข้าไม่ได้จนกว่าจะกด{" "}
          <strong>ตั้งรหัส + เปิดเกต</strong> ด้านล่าง
        </p>
      ) : null}
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        รหัสลับ 1:1 กับหลังบ้าน · <strong>เครื่องเดียวถือสิทธิ์ขาย</strong> ·
        เปลี่ยนรหัส = เตะทุกเครื่องให้ใส่รหัสใหม่
      </p>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        ปุ่ม <strong>เตะ / เคลียร์ seat</strong> ≠ บังคับปิดกะ — กะบนเซิร์ฟเวอร์อยู่ต่อ
      </p>
      {seatMode === "exclusive" && required ? (
        <p className="muted" style={{ marginBottom: "0.5rem" }}>
          Seat ปัจจุบัน: {activeSeatId ? activeSeatId.slice(-8).toUpperCase() : "— ว่าง —"}
        </p>
      ) : null}
      {hasCode ? (
        <div
          style={{
            marginBottom: "0.75rem",
            padding: "0.75rem 0.85rem",
            borderRadius: 10,
            background: "#1A2E24",
            color: "#F7F7F5",
          }}
        >
          <div style={{ fontSize: "0.75rem", opacity: 0.75, marginBottom: "0.25rem" }}>
            รหัสร้านที่ใช้อยู่ (เจ้าของเท่านั้น)
          </div>
          {currentCode ? (
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "1.45rem",
                fontWeight: 700,
                letterSpacing: "0.12em",
              }}
            >
              {currentCode}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.9 }}>
              มีรหัสบนเซิร์ฟเวอร์แล้ว แต่ยังไม่เก็บตัวเต็ม — กด{" "}
              <strong>เปลี่ยนรหัส + เปิดเกต</strong> อีกครั้งเพื่อให้หลังบ้านจำรหัสเต็ม
            </p>
          )}
        </div>
      ) : null}
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
        <label
          className="field checkbox-field"
          style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
        >
          <input
            type="checkbox"
            checked={rejectDev}
            onChange={(e) => setRejectDev(e.target.checked)}
            disabled={busy}
          />
          <span>ปิดกั้นเครื่องจำลอง / พัฒนา (ถอดติ๊กถ้าเทสบน emulator)</span>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button type="submit" className="primary-btn" disabled={busy || code.trim().length < 4}>
            {hasCode ? "เปลี่ยนรหัส + เปิดเกต" : "ตั้งรหัส + เปิดเกต"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy || (!hasCode && !activeSeatId)}
            onClick={() => void onClearSeat()}
          >
            เคลียร์ seat / เริ่มใส่รหัสใหม่
          </button>
          {hasCode ? (
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => void onClear()}>
              ปิดเกต
            </button>
          ) : null}
        </div>
      </form>
      {hint ? (
        <p className="ok-text" style={{ marginTop: "0.75rem" }}>
          {hint}
        </p>
      ) : null}
    </SettingsFold>
  );
}
