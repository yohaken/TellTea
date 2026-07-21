"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QrCode } from "lucide-react";
import { getPosShopSettings, savePosShopSettings } from "@/lib/pos-settings";
import { isValidPromptPayId, maskPromptPayId, normalizePromptPayId } from "@/lib/pos-promptpay";

export function PosPaymentSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [promptPayId, setPromptPayId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPosShopSettings()
      .then((s) => {
        setPromptPayId(s.promptPayId);
      })
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const normalized = normalizePromptPayId(promptPayId);
      if (normalized && !isValidPromptPayId(normalized)) {
        onError("เลข PromptPay ไม่ถูกต้อง — ใช้เบอร์ 10 หลัก (0…) หรือเลขภาษี 13 หลัก");
        return;
      }
      await savePosShopSettings({ promptPayId: normalized });
      setPromptPayId(normalized);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <QrCode size={18} aria-hidden />
        ชำระเงิน POS
      </h2>
      <p className="muted settings-card-lead">
        PromptPay สำหรับสแกนจ่ายบนแท็บเล็ต
        {promptPayId ? ` · ${maskPromptPayId(promptPayId)}` : ""}
        {" · "}พิมพ์หลังขายอยู่การ์ดถัดไป
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="pos-menu-form" onSubmit={(e) => void onSave(e)}>
          <label>
            <span>เลข PromptPay</span>
            <input
              value={promptPayId}
              onChange={(e) => setPromptPayId(e.target.value)}
              placeholder="เบอร์ 08xxxxxxxx หรือเลขผู้เสียภาษี"
              inputMode="numeric"
            />
          </label>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
