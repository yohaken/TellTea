"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Wifi, WifiOff } from "lucide-react";
import { AppBrand } from "@/components/AppBrand";
import { ensurePosDeviceAuth } from "@/lib/pos-auth";
import {
  POS_HEARTBEAT_MS,
  ackPosDeviceReload,
  heartbeatPosDevice,
  isPosDeviceOnline,
  registerPosDevice,
  subscribePosDevice,
  type PosDevice,
} from "@/lib/pos-devices";
import { CLIENT_BUILD } from "@/lib/app-update";
import { isFirebaseConfigured } from "@/lib/firebase";
import { POS_ENTRY_URL } from "@/lib/pos-url";
import { appVersionLabel } from "@/lib/version";

type PosStatus = "boot" | "connecting" | "ready" | "error";

export default function PosPage() {
  const [status, setStatus] = useState<PosStatus>("boot");
  const [device, setDevice] = useState<PosDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const deviceIdRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);

  const boot = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setStatus("error");
      setError("Firebase ยังไม่ได้ตั้งค่า — ติดต่อเจ้าของร้าน");
      return;
    }

    setStatus("connecting");
    setError(null);

    try {
      const authUid = await ensurePosDeviceAuth();
      deviceIdRef.current = authUid;
      const registered = await registerPosDevice(authUid);
      setDevice(registered);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "เชื่อมต่อเครื่อง POS ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    function syncOnline() {
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    }
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  useEffect(() => {
    const deviceId = deviceIdRef.current;
    if (!deviceId || status !== "ready") return;

    const heartbeat = () => {
      if (!navigator.onLine) return;
      void heartbeatPosDevice(deviceId).catch(() => {
        /* retry next tick */
      });
    };

    heartbeat();
    const timer = setInterval(heartbeat, POS_HEARTBEAT_MS);

    function onVisible() {
      if (document.visibilityState === "visible") heartbeat();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status]);

  useEffect(() => {
    const deviceId = deviceIdRef.current;
    if (!deviceId || status !== "ready") return;

    return subscribePosDevice(
      deviceId,
      (next) => {
        if (!next) return;
        setDevice(next);

        if (
          next.forceReloadAt > 0
          && next.forceReloadAt > next.lastReloadAckAt
          && !reloadingRef.current
        ) {
          reloadingRef.current = true;
          void ackPosDeviceReload(deviceId, next.forceReloadAt)
            .catch(() => {
              reloadingRef.current = false;
            })
            .finally(() => {
              window.location.reload();
            });
        }
      },
      (err) => setError(err.message),
    );
  }, [status]);

  const deviceOnline = device ? isPosDeviceOnline(device.lastSeenAt) : false;

  return (
    <div className="pos-lite">
      <header className="pos-lite-header">
        <AppBrand compact showLogo />
        <p className="pos-lite-phase">POS · Phase 0</p>
      </header>

      <main className="pos-lite-main">
        <div className="pos-lite-icon-wrap" aria-hidden>
          <Monitor size={40} strokeWidth={1.5} />
        </div>

        {status === "boot" || status === "connecting" ? (
          <>
            <h1>กำลังเชื่อมต่อ...</h1>
            <p className="muted">ลงทะเบียนเครื่องและส่งสัญญาณไปยัง TellTea</p>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <h1>เชื่อมต่อไม่สำเร็จ</h1>
            <p className="error-text">{error}</p>
            <button type="button" className="primary-btn pos-lite-btn" onClick={() => void boot()}>
              ลองใหม่
            </button>
          </>
        ) : null}

        {status === "ready" && device ? (
          <>
            <h1>เครื่องพร้อม · รอเปิดขาย</h1>
            <p className="muted">ยังไม่เปิดระบบขาย — เปิดหน้านี้ทิ้งไว้ได้ตลอด</p>

            <div className="pos-lite-status-row">
              <span className={`pos-lite-pill ${deviceOnline && online ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}>
                {deviceOnline && online ? <Wifi size={14} aria-hidden /> : <WifiOff size={14} aria-hidden />}
                {deviceOnline && online ? "ออนไลน์" : "ออฟไลน์"}
              </span>
              <span className="pos-lite-pill">{appVersionLabel()}</span>
            </div>

            <dl className="pos-lite-meta">
              <div>
                <dt>รหัสเครื่อง</dt>
                <dd>{device.pairingCode}</dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd>v{CLIENT_BUILD}</dd>
              </div>
            </dl>

            <p className="pos-lite-hint">
              ลิงก์ติดตั้ง: <strong>{POS_ENTRY_URL}</strong>
              <br />
              เจ้าของดูสถานะได้ที่ TellTea → ตั้งค่า → เครื่อง POS
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
