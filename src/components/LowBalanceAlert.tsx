"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { subscribeLedgerBalance } from "@/lib/ledger";
import {
  isLowBalance,
  subscribeAlertSettings,
  type AlertSettings,
  DEFAULT_ALERT_SETTINGS,
} from "@/lib/settings";
import { showLocalLowBalanceNotification } from "@/lib/push";
import { formatBaht } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

const DISMISS_KEY = "telltea_low_balance_dismissed_v1";

function readDismissedBelow(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(DISMISS_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeDismissedBelow(threshold: number) {
  window.sessionStorage.setItem(DISMISS_KEY, String(threshold));
}

export function LowBalanceAlert() {
  const { staff } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [open, setOpen] = useState(false);
  const notifiedRef = useRef(false);
  const isOwner = staff?.role === "owner";

  useEffect(() => {
    const unsubBal = subscribeLedgerBalance((next) => setBalance(next));
    const unsubSet = subscribeAlertSettings((next) => setSettings(next));
    return () => {
      unsubBal();
      unsubSet();
    };
  }, []);

  useEffect(() => {
    if (balance == null || !settings.lowBalanceEnabled) {
      setOpen(false);
      return;
    }
    if (!isLowBalance(balance, settings)) {
      setOpen(false);
      notifiedRef.current = false;
      return;
    }

    const dismissedFor = readDismissedBelow();
    // Show again if threshold changed or never dismissed this session
    if (dismissedFor === settings.lowBalanceThreshold) {
      setOpen(false);
    } else {
      setOpen(true);
    }

    // System notification once per session when crossing into low
    if (isOwner && !notifiedRef.current) {
      notifiedRef.current = true;
      void showLocalLowBalanceNotification(
        formatBaht(balance),
        formatBaht(settings.lowBalanceThreshold),
      );
    }
  }, [balance, settings, isOwner]);

  useBodyScrollLock(open && balance != null);

  if (!open || balance == null) return null;

  return (
    <div className="modal-backdrop alert-backdrop" role="presentation">
      <div
        className="modal-card alert-card"
        role="alertdialog"
        aria-modal="true"
        aria-label="เงินคงเหลือต่ำ"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="alert-kicker">แจ้งเตือน</p>
        <h2 className="panel-title">เงินคงเหลือต่ำ</h2>
        <p className="muted" style={{ textAlign: "left", marginBottom: "0.85rem" }}>
          คงเหลือ <strong>{formatBaht(balance)}</strong> — ต่ำกว่าเกณฑ์{" "}
          {formatBaht(settings.lowBalanceThreshold)}
          {isOwner ? " โอนเงินเข้าได้เลย" : " แจ้งเจ้าของให้โอนเข้า"}
        </p>
        <div className="btn-row">
          {isOwner ? (
            <Link href="/in/" className="primary-btn" onClick={() => setOpen(false)}>
              โอนเข้า
            </Link>
          ) : null}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              writeDismissedBelow(settings.lowBalanceThreshold);
              setOpen(false);
            }}
          >
            ปิดไว้ก่อน
          </button>
        </div>
        {isOwner ? (
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.8rem", textAlign: "left" }}>
            ตั้งเกณฑ์ได้ที่เมนู อื่นๆ → แจ้งเตือนยอดต่ำ
          </p>
        ) : null}
      </div>
    </div>
  );
}
