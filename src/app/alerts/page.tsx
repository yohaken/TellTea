"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_ALERT_SETTINGS,
  getAlertSettings,
  saveAlertSettings,
  clampBalanceFontSize,
} from "@/lib/settings";
import {
  disableOwnerPush,
  enableOwnerPush,
  pushSupported,
} from "@/lib/push";
import { formatBaht } from "@/lib/utils";

export default function AlertsPage() {
  return (
    <AuthGate>
      <AlertsView />
    </AuthGate>
  );
}

function AlertsView() {
  const { staff, user } = useAuth();
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(DEFAULT_ALERT_SETTINGS.lowBalanceThreshold));
  const [enabled, setEnabled] = useState(true);
  const [balanceFontSize, setBalanceFontSize] = useState(DEFAULT_ALERT_SETTINGS.balanceFontSize);
  const [pushStatus, setPushStatus] = useState<string>("ยังไม่เปิดบนเครื่องนี้");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && staff.role !== "owner") router.replace("/ledger/");
  }, [staff, router]);

  useEffect(() => {
    void getAlertSettings()
      .then((s) => {
        setThreshold(String(s.lowBalanceThreshold));
        setEnabled(s.lowBalanceEnabled);
        setBalanceFontSize(s.balanceFontSize);
      })
      .catch((err) => setError((err as Error).message));

    if (!pushSupported()) {
      setPushStatus("อุปกรณ์นี้ไม่รองรับ (ลอง Chrome / Safari แล้วเพิ่มหน้าจอโฮม)");
      return;
    }
    if (Notification.permission === "granted") {
      setPushStatus("อนุญาตแจ้งเตือนแล้ว — กดปุ่มด้านล่างเพื่อผูกเครื่องนี้");
    } else if (Notification.permission === "denied") {
      setPushStatus("ถูกบล็อก — เปิดอนุญาตแจ้งเตือนในการตั้งค่าเบราว์เซอร์");
    }
  }, []);

  if (staff?.role !== "owner") return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await saveAlertSettings(
        {
          lowBalanceThreshold: Number(threshold),
          lowBalanceEnabled: enabled,
          balanceFontSize,
        },
        user.email,
      );
      setMessage("บันทึกเกณฑ์แล้ว");
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onEnablePush() {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await enableOwnerPush(user.email);
      if (result === "granted") {
        setPushStatus("เปิดแจ้งเตือนถึงมือถือเครื่องนี้แล้ว");
        setMessage("เมื่อยอดต่ำ ระบบจะเด้งแจ้งเตือนแม้ปิดแอปไว้ (ต้องอนุญาตแจ้งเตือน)");
      } else if (result === "denied") {
        setPushStatus("ยังไม่อนุญาตแจ้งเตือน");
        setError("กรุณาอนุญาตการแจ้งเตือนของเบราว์เซอร์");
      } else {
        setPushStatus("อุปกรณ์ไม่รองรับ");
      }
    } catch (err) {
      setError((err as Error).message || "เปิดแจ้งเตือนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDisablePush() {
    setBusy(true);
    try {
      await disableOwnerPush();
      setPushStatus("ปิดแจ้งเตือนบนเครื่องนี้แล้ว");
      setMessage(null);
    } catch (err) {
      setError((err as Error).message || "ปิดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">แจ้งเตือนยอดต่ำ</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        ตั้งยอดขั้นต่ำของเงินคงเหลือพนักงาน — ต่ำกว่านี้จะมีป็อปอัป และแจ้งถึงมือถือเจ้าของ
      </p>

      <form onSubmit={(e) => void onSave(e)} className="panel-block">
        <label className="check-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>เปิดแจ้งเตือนยอดต่ำ</span>
        </label>

        <div className="field">
          <label htmlFor="threshold">แจ้งเมื่อคงเหลือต่ำกว่า (บาท)</label>
          <input
            id="threshold"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            required
          />
          <p className="field-hint">ตัวอย่าง: {formatBaht(Number(threshold) || 0)}</p>
        </div>

        <div className="field">
          <label htmlFor="balanceFontSize">
            ขนาดยอดคงเหลือ (ใช้กับทุกคนในร้าน)
          </label>
          <div className="slider-row">
            <span className="slider-val" style={{ fontSize: "0.75rem" }}>
              เล็ก
            </span>
            <input
              id="balanceFontSize"
              type="range"
              min="0.7"
              max="3"
              step="0.05"
              value={balanceFontSize}
              onChange={(e) => setBalanceFontSize(Number(e.target.value))}
            />
            <span className="slider-val" style={{ fontSize: "1.1rem" }}>
              ใหญ่
            </span>
          </div>
          <p className="field-hint">
            แสดงผลที่ขนาด {balanceFontSize.toFixed(2)}rem
          </p>
        </div>

        <button type="submit" className="primary-btn" disabled={busy}>
          บันทึกเกณฑ์
        </button>
      </form>

      <div className="panel-block" style={{ marginTop: "1rem" }}>
        <h2 className="panel-title" style={{ fontSize: "1.05rem" }}>
          แจ้งเตือนถึงมือถือ
        </h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
          {pushStatus}
        </p>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
          บน iPhone: เปิดใน Safari แล้วแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วค่อยกดเปิดแจ้งเตือน
        </p>
        <div className="btn-row">
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void onEnablePush()}>
            เปิดแจ้งเตือนบนเครื่องนี้
          </button>
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void onDisablePush()}>
            ปิดเครื่องนี้
          </button>
        </div>
      </div>

      {message ? <p className="ok-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <p style={{ marginTop: "1.25rem" }}>
        <Link href="/more/" className="text-link">
          ← กลับอื่นๆ
        </Link>
      </p>
    </div>
  );
}
