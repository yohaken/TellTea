"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Printer, Wifi, WifiOff } from "lucide-react";
import { AppBrand } from "@/components/AppBrand";
import { PosUpdateWatcher } from "@/components/PosUpdateWatcher";
import { PosPendingSyncPanel } from "@/components/PosPendingSyncPanel";
import { PosSyncWatcher } from "@/components/PosSyncWatcher";
import { PosSellView } from "@/components/PosSellView";
import { ensurePosDeviceAuth } from "@/lib/pos-auth";
import {
  POS_HEARTBEAT_MS,
  ackPosDeviceReload,
  heartbeatPosDevice,
  getPosConnectivity,
  registerPosDevice,
  optimisticPosDevice,
  subscribePosDevice,
  type PosDevice,
} from "@/lib/pos-devices";
import { isPosStandaloneMode, type BeforeInstallPromptEvent } from "@/lib/pos-install";
import {
  getCurrentPosSession,
  openPosSession,
  posSessionDocId,
  subscribePosSession,
} from "@/lib/pos-session";
import { getCurrentShiftId } from "@/lib/shift-session";
import { labelOtShift } from "@/lib/ot";
import { seedPosMenuIfEmpty } from "@/lib/pos-menu";
import { startPosMenuPreload } from "@/lib/pos-menu-preload";
import { isFirebaseConfigured } from "@/lib/firebase";
import { getPosHardwareSnapshot } from "@/lib/pos-hardware";
import { isPosSafeToReload, type PosSellBusyState } from "@/lib/pos-reload";
import type { PosSyncSnapshot } from "@/lib/pos-sync";
import type { PosSession } from "@/lib/types";
import { appVersionLabel } from "@/lib/version";

type PosStatus = "boot" | "connecting" | "ready" | "error";

export default function PosPage() {
  const [status, setStatus] = useState<PosStatus>("boot");
  const [device, setDevice] = useState<PosDevice | null>(null);
  const [session, setSession] = useState<PosSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [opening, setOpening] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(0);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [syncSnap, setSyncSnap] = useState<PosSyncSnapshot>({
    pendingCount: 0,
    failedCount: 0,
    stuckCount: 0,
    syncing: false,
    lastFlushAt: 0,
    lastSynced: 0,
    bills: [],
  });
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [sellBusy, setSellBusy] = useState<PosSellBusyState>({
    cartCount: 0,
    payOpen: false,
    saleBusy: false,
    pendingSyncCount: 0,
    syncing: false,
  });
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);
  const pendingForceReloadAtRef = useRef(0);
  const sellBusyRef = useRef(sellBusy);

  const shift = getCurrentShiftId();
  const selling = session?.status === "open";

  useEffect(() => {
    sellBusyRef.current = sellBusy;
  }, [sellBusy]);

  useEffect(() => {
    if (!selling) {
      setSellBusy({ cartCount: 0, payOpen: false, saleBusy: false, pendingSyncCount: 0, syncing: false });
    }
  }, [selling]);

  const performReload = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    window.location.reload();
  }, []);

  const flushPendingForceReload = useCallback(() => {
    const deviceId = deviceIdRef.current;
    const forceReloadAt = pendingForceReloadAtRef.current;
    if (!deviceId || !forceReloadAt || reloadingRef.current) return;
    if (!isPosSafeToReload(sellBusyRef.current)) return;

    reloadingRef.current = true;
    void ackPosDeviceReload(deviceId, forceReloadAt)
      .catch(() => {
        reloadingRef.current = false;
      })
      .finally(() => {
        window.location.reload();
      });
  }, []);

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

      setDevice(optimisticPosDevice(authUid));
      setLastHeartbeatAt(Date.now());
      setStatus("ready");

      startPosMenuPreload();

      void registerPosDevice(authUid)
        .then((registered) => {
          setDevice(registered);
          setLastHeartbeatAt(Date.now());
        })
        .catch(() => {
          /* heartbeat retries on interval */
        });

      void getCurrentPosSession(authUid).then(setSession);
      void seedPosMenuIfEmpty().catch(() => {
        /* preload + sell view retry */
      });
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "เชื่อมต่อเครื่อง POS ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    setStandalone(isPosStandaloneMode());

    function onInstallPrompt(e: Event) {
      e.preventDefault();
      installPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    }

    function onInstalled() {
      setCanInstall(false);
      installPromptRef.current = null;
      setStandalone(true);
    }

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

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

    const sessionId = posSessionDocId(deviceId);
    return subscribePosSession(sessionId, setSession);
  }, [status]);

  async function installApp() {
    const prompt = installPromptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      setCanInstall(false);
      installPromptRef.current = null;
    }
  }

  async function handleOpenShift() {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setOpening(true);
    setError(null);
    try {
      const next = await openPosSession(deviceId, shift);
      setSession(next);
    } catch (err) {
      setError((err as Error).message || "เปิดรอบขายไม่สำเร็จ");
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    const deviceId = deviceIdRef.current;
    if (!deviceId || status !== "ready") return;

    const heartbeat = () => {
      void heartbeatPosDevice(deviceId)
        .then(() => {
          setLastHeartbeatAt(Date.now());
          setHeartbeatError(null);
        })
        .catch((err) => {
          setHeartbeatError((err as Error).message || "ส่งสัญญาณไม่สำเร็จ");
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
          if (!isPosSafeToReload(sellBusyRef.current)) {
            pendingForceReloadAtRef.current = next.forceReloadAt;
            return;
          }
          pendingForceReloadAtRef.current = 0;
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

  useEffect(() => {
    flushPendingForceReload();
  }, [sellBusy, flushPendingForceReload]);

  const connectivity = device
    ? getPosConnectivity(
        device.lastSeenAt,
        lastHeartbeatAt,
        online,
        Date.now(),
        status === "connecting",
      )
    : { deviceOnline: false, pill: "offline-signal" as const, label: "กำลังเชื่อม" };
  const hardware = getPosHardwareSnapshot(online);

  const queueCount = syncSnap.pendingCount + syncSnap.failedCount;

  return (
    <div className={`pos-lite ${standalone ? "pos-lite--standalone" : ""} ${selling ? "pos-lite--sell" : ""}`}>
      <PosSyncWatcher
        enabled={status === "ready"}
        onSyncChange={(snap) => {
          setSyncSnap(snap);
          setSellBusy((prev) => ({
            ...prev,
            pendingSyncCount: snap.pendingCount,
            syncing: snap.syncing,
          }));
        }}
      />
      <PosPendingSyncPanel
        open={syncPanelOpen}
        snapshot={syncSnap}
        onClose={() => setSyncPanelOpen(false)}
      />
      <PosUpdateWatcher
        enabled={status === "ready"}
        sellBusy={sellBusy}
        onReload={performReload}
      />
      <header className="pos-lite-header">
        <AppBrand compact showLogo />
        <div className="pos-lite-header-end">
          <span
            className={`pos-lite-pill ${hardware.printerReady ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}
            title={hardware.printerReady ? "พร้อมพิมพ์ใบเสร็จ" : "เครื่องนี้พิมพ์ใบเสร็จไม่ได้"}
          >
            <Printer size={12} aria-hidden />
            {hardware.printerLabel}
          </span>
          <span
            className={`pos-lite-pill ${connectivity.pill === "online" ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}
            title={
              connectivity.pill === "online"
                ? "เชื่อมต่อ TellTea ปกติ"
                : connectivity.pill === "offline-net"
                  ? "เครื่องไม่มีเน็ต — ตรวจ Wi‑Fi"
                  : "ส่งสัญญาณไม่ถึงเซิร์ฟเวอร์ — ตรวจ Wi‑Fi หรือลองรีเฟรช"
            }
          >
            {connectivity.pill === "online" ? <Wifi size={12} aria-hidden /> : <WifiOff size={12} aria-hidden />}
            {connectivity.label}
          </span>
          {sellBusy.syncing ? (
            <button
              type="button"
              className="pos-lite-pill pos-lite-pill--ok pos-lite-pill-btn"
              title="กำลังส่งบิลที่ค้างไปยังเซิร์ฟเวอร์"
              onClick={() => setSyncPanelOpen(true)}
            >
              กำลังส่งข้อมูล
            </button>
          ) : syncSnap.stuckCount > 0 ? (
            <button
              type="button"
              className="pos-lite-pill pos-lite-pill--warn pos-lite-pill-btn"
              title="บิลค้างนาน — แตะเพื่อดูรายการ"
              onClick={() => setSyncPanelOpen(true)}
            >
              ค้างส่ง {syncSnap.stuckCount}
            </button>
          ) : queueCount > 0 ? (
            <button
              type="button"
              className={`pos-lite-pill pos-lite-pill-btn ${syncSnap.failedCount > 0 ? "pos-lite-pill--warn" : "pos-lite-pill--warn"}`}
              title="แตะเพื่อดูบิลรอส่ง"
              onClick={() => setSyncPanelOpen(true)}
            >
              รอส่ง {queueCount}
              {syncSnap.failedCount > 0 ? ` (${syncSnap.failedCount} ล้มเหลว)` : ""}
            </button>
          ) : null}
          <p className="pos-lite-phase">{standalone ? "แอป" : "POS"} · {appVersionLabel()}</p>
        </div>
      </header>

      {status === "boot" || status === "connecting" ? (
        <main className="pos-lite-main">
          <h1>กำลังเชื่อมต่อ...</h1>
          <p className="muted">เปิดเครื่อง POS — ครั้งถัดไปจะเร็วขึ้น</p>
        </main>
      ) : null}

      {status === "error" ? (
        <main className="pos-lite-main">
          <h1>เชื่อมต่อไม่สำเร็จ</h1>
          <p className="error-text">{error}</p>
          <button type="button" className="primary-btn pos-lite-btn" onClick={() => void boot()}>
            ลองใหม่
          </button>
        </main>
      ) : null}

      {status === "ready" && device && !selling ? (
        <main className="pos-lite-main">
          <h1>พร้อมขาย</h1>
          <p className="muted">กะ {labelOtShift(shift)} · รหัส {device.pairingCode}</p>

          {!standalone && canInstall ? (
            <button type="button" className="ghost-btn pos-lite-btn" onClick={() => void installApp()}>
              <Download size={16} aria-hidden />
              ติดตั้งแอป
            </button>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {heartbeatError && connectivity.pill !== "online" ? (
            <p className="error-text pos-lite-heartbeat-hint">{heartbeatError}</p>
          ) : null}

          <button
            type="button"
            className="primary-btn pos-open-shift-btn"
            disabled={opening}
            onClick={() => void handleOpenShift()}
          >
            {opening ? "กำลังเปิด..." : "เปิดขายกะนี้"}
          </button>
        </main>
      ) : null}

      {status === "ready" && device && selling && session ? (
        <PosSellView
          deviceId={device.id}
          session={session}
          pendingBills={syncSnap.bills}
          onBusyChange={(state) => setSellBusy((prev) => ({ ...prev, ...state }))}
        />
      ) : null}
    </div>
  );
}
