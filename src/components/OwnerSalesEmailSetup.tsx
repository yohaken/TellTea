"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_OWNER_SALES_EMAIL,
  getOwnerSalesEmailSettings,
  getOwnerSalesEmailState,
  saveOwnerSalesEmailSettings,
  sendOwnerSalesEmailNow,
  type OwnerSalesEmailState,
} from "@/lib/owner-sales-email";
import {
  fetchVatMailStatus,
  startVatMailOAuth,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";

type Props = {
  onError: (msg: string | null) => void;
};

/** ส่งยอดขายหน้าร้านเข้า Gmail ทันทีเมื่อปิดรอบ POS */
export function OwnerSalesEmailSetup({ onError }: Props) {
  const { user, actorId } = useAuth();
  const [enabled, setEnabled] = useState(DEFAULT_OWNER_SALES_EMAIL.enabled);
  const [recipientsText, setRecipientsText] = useState(
    DEFAULT_OWNER_SALES_EMAIL.recipients.join(", "),
  );
  const [gmail, setGmail] = useState<VatMailStatus | null>(null);
  const [gmailError, setGmailError] = useState("");
  const [state, setState] = useState<OwnerSalesEmailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const [g, st] = await Promise.all([
      fetchVatMailStatus().catch((err: Error) => {
        setGmailError(err.message || "อ่านสถานะ Gmail ไม่ได้");
        return null;
      }),
      getOwnerSalesEmailState().catch(() => null),
    ]);
    setGmail(g);
    setState(st);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getOwnerSalesEmailSettings();
        if (cancelled) return;
        setEnabled(settings.enabled);
        setRecipientsText(settings.recipients.join(", "));
        await refreshStatus();
      } catch (err) {
        if (!cancelled) onError((err as Error).message || "โหลดตั้งค่าอีเมลไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, refreshStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mail = params.get("mail");
    if (mail === "connected") setMsg("เชื่อม Gmail แล้ว");
    if (mail === "error") onError(`เชื่อม Gmail ไม่สำเร็จ: ${params.get("reason") || ""}`);
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const saved = await saveOwnerSalesEmailSettings(
        { enabled, recipientsText },
        actorId || user?.email || "owner",
      );
      setRecipientsText(saved.recipients.join(", "));
      setMsg("บันทึกตั้งค่าอีเมลแล้ว");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectGmail() {
    setBusy(true);
    onError(null);
    try {
      const url = await startVatMailOAuth(`${window.location.origin}/settings/`);
      window.location.href = url;
    } catch (err) {
      onError((err as Error).message || "เริ่มเชื่อม Gmail ไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function onSendNow() {
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      const res = await sendOwnerSalesEmailNow();
      if (res.ok) setMsg(res.detail || "ส่งอีเมลแล้ว");
      else onError(res.detail || "ส่งอีเมลไม่สำเร็จ");
      await refreshStatus();
    } catch (err) {
      onError((err as Error).message || "ส่งอีเมลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const canSend = Boolean(gmail?.connected && gmail?.hasSendScope);

  return (
    <SettingsFold
      title={
        <>
          <Mail size={18} aria-hidden />
          ส่งยอดขายหน้าร้านเข้า Gmail
        </>
      }
      hint="ส่งอัตโนมัติทันทีเมื่อปิดรอบขาย (ตัดรอบ) ที่ POS"
      defaultOpen
      className="owner-notify-card"
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="owner-notify-form" onSubmit={(e) => void onSave(e)}>
          <h3 className="owner-notify-section">Gmail ผู้ส่ง</h3>
          {gmail?.connected ? (
            <p className="muted owner-notify-help">
              ส่งจาก <strong>{gmail.email || "Gmail ที่เชื่อมไว้"}</strong>
              {canSend ? " · พร้อมส่ง" : null}
            </p>
          ) : (
            <p className="muted owner-notify-help">
              ยังไม่ได้เชื่อม Gmail — ใช้บัญชีเดียวกับหน้า ยอดขาย/VAT
            </p>
          )}
          {gmail?.connected && !gmail.hasSendScope ? (
            <p className="error-text" style={{ margin: "0 0 0.5rem" }}>
              Gmail ที่เชื่อมไว้ยังไม่มีสิทธิ์ส่งเมล — กดเชื่อม Gmail ใหม่หนึ่งครั้ง แล้วกดอนุญาตทุกข้อ
            </p>
          ) : null}
          {gmailError && !gmail ? (
            <p className="error-text" style={{ margin: "0 0 0.5rem" }}>{gmailError}</p>
          ) : null}
          {!canSend ? (
            <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy || gmail?.hasConfig === false}
                onClick={() => void onConnectGmail()}
              >
                {gmail?.connected ? "เชื่อม Gmail ใหม่ (เพิ่มสิทธิ์ส่งเมล)" : "เชื่อม Gmail"}
              </button>
            </div>
          ) : null}

          <h3 className="owner-notify-section">ผู้รับ</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>เปิดส่งยอดขายเข้าอีเมลทันทีเมื่อปิดรอบ</span>
          </label>
          <div className="field">
            <label htmlFor="owner-sales-email-to">อีเมลผู้รับ</label>
            <input
              id="owner-sales-email-to"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="yohaken@gmail.com"
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              disabled={!enabled}
            />
            <p className="field-hint">หลายอีเมลคั่นด้วยจุลภาค (สูงสุด 5)</p>
          </div>
          <p className="field-hint">
            ในเมลมี: ยอดรวมทั้งวัน · จำนวนบิล · เงินสด/พร้อมเพย์/โอน · ส่วนลด · บิลยกเลิก ·
            รายละเอียดรอบที่เพิ่งปิด (นับเงิน/ส่วนต่าง/ยอดนำส่ง) · เมนูขายดี
          </p>

          {state?.lastSentAt ? (
            <p className="ok-text" style={{ margin: "0.35rem 0 0" }}>
              ส่งล่าสุด {new Date(state.lastSentAt).toLocaleString("th-TH")}
              {state.lastDateKey ? ` · ยอดวันที่ ${state.lastDateKey}` : ""}
            </p>
          ) : null}
          {state?.lastError && state.lastErrorAt >= state.lastSentAt ? (
            <p className="error-text" style={{ margin: "0.35rem 0 0" }}>
              ส่งล่าสุดไม่สำเร็จ: {state.lastError}
            </p>
          ) : null}

          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button type="submit" className="primary-btn" disabled={busy}>
              บันทึกตั้งค่า
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !canSend}
              onClick={() => void onSendNow()}
            >
              ส่งยอดวันนี้ตอนนี้
            </button>
          </div>

          {msg ? <p className="ok-text">{msg}</p> : null}
        </form>
      ) : null}
    </SettingsFold>
  );
}
