"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ensureLocalPosDeviceId, ensurePosDeviceAuth } from "@/lib/pos-auth";
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
  applyRemotePosSessionUpdate,
  closePosSessionLocal,
  persistClosedPosSession,
  persistOpenPosSession,
  readLocalOpenPosSession,
  reconcilePosSessionFromRemote,
  startPosSessionLocal,
  storePosSessionId,
  subscribePosSession,
} from "@/lib/pos-session";
import { saveLocalClosedSession } from "@/lib/pos-local-sessions";
import { refreshPosSyncSnapshot, runPosSyncFlush } from "@/lib/pos-sync";
import { getCurrentShiftId } from "@/lib/shift-session";
import { seedPosMenuIfEmpty } from "@/lib/pos-menu";
import { resubscribePosMenuAfterAuth, startPosMenuPreload } from "@/lib/pos-menu-preload";
import { hardReloadWithCacheBust } from "@/lib/hard-reload";
import { isFirebaseConfigured } from "@/lib/firebase";
import { getPosHardwareSnapshot } from "@/lib/pos-hardware";
import { subscribePosPrinterSetup } from "@/lib/pos-printer/storage";
import { isPosSafeToReload, type PosSellBusyState } from "@/lib/pos-reload";
import type { PosSyncSnapshot } from "@/lib/pos-sync";
import type { PosSession } from "@/lib/types";

export type PosAppStatus = "boot" | "connecting" | "ready" | "error";

type PosAppContextValue = {
  status: PosAppStatus;
  device: PosDevice | null;
  session: PosSession | null;
  selling: boolean;
  shift: ReturnType<typeof getCurrentShiftId>;
  error: string | null;
  setError: (msg: string | null) => void;
  online: boolean;
  standalone: boolean;
  canInstall: boolean;
  opening: boolean;
  connectivity: ReturnType<typeof getPosConnectivity>;
  hardware: ReturnType<typeof getPosHardwareSnapshot>;
  syncSnap: PosSyncSnapshot;
  setSyncSnap: (snap: PosSyncSnapshot) => void;
  syncPanelOpen: boolean;
  setSyncPanelOpen: (open: boolean) => void;
  sellBusy: PosSellBusyState;
  setSellBusy: React.Dispatch<React.SetStateAction<PosSellBusyState>>;
  locked: boolean;
  setLocked: (v: boolean) => void;
  boot: () => Promise<void>;
  handleOpenShift: () => void;
  /** ปิดรอบบนเครื่องทันที — sync เซิร์ฟเวอร์เงียบด้านหลัง */
  handleCloseShift: (totals?: { cashTotal: number; promptpayTotal: number }) => Promise<void>;
  installApp: () => Promise<void>;
  performReload: () => void;
};

const PosAppContext = createContext<PosAppContextValue | null>(null);

const LOCK_KEY = "telltea-pos-locked";

export function PosAppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PosAppStatus>("boot");
  const [device, setDevice] = useState<PosDevice | null>(null);
  const [session, setSession] = useState<PosSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [opening, setOpening] = useState(false);
  const [printerSetupTick, setPrinterSetupTick] = useState(0);
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
  const [locked, setLocked] = useState(false);

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

  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(LOCK_KEY) === "1") {
      setLocked(true);
    }
  }, []);

  const setLockedPersist = useCallback((v: boolean) => {
    setLocked(v);
    if (typeof sessionStorage !== "undefined") {
      if (v) sessionStorage.setItem(LOCK_KEY, "1");
      else sessionStorage.removeItem(LOCK_KEY);
    }
  }, []);

  const performReload = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    hardReloadWithCacheBust("manual");
  }, []);

  const flushPendingForceReload = useCallback(() => {
    const deviceId = deviceIdRef.current;
    const forceReloadAt = pendingForceReloadAtRef.current;
    if (!deviceId || !forceReloadAt || reloadingRef.current) return;
    if (!isPosSafeToReload(sellBusyRef.current)) return;

    reloadingRef.current = true;
    pendingForceReloadAtRef.current = 0;
    void ackPosDeviceReload(deviceId, forceReloadAt).catch(() => {});
    hardReloadWithCacheBust("owner-force");
  }, []);

  const boot = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setStatus("error");
      setError("Firebase ยังไม่ได้ตั้งค่า — ติดต่อเจ้าของร้าน");
      return;
    }

    setError(null);

    // เสมอ: มี device id บนเครื่อง → พร้อมใช้ทันที ไม่รอ Firebase
    const localDeviceId = ensureLocalPosDeviceId();

    function applyReadyState(authUid: string) {
      deviceIdRef.current = authUid;
      const localSession = readLocalOpenPosSession(authUid);
      if (localSession) setSession(localSession);
      setDevice(optimisticPosDevice(authUid));
      setLastHeartbeatAt(Date.now());
      setStatus("ready");
      startPosMenuPreload();
    }

    async function finishBackgroundAuth() {
      try {
        const authUid = await ensurePosDeviceAuth();
        deviceIdRef.current = authUid;
        setDevice(optimisticPosDevice(authUid));
        setLastHeartbeatAt(Date.now());

        // เมนูอาจ subscribe ก่อน auth → permission-denied แล้ว listener ตาย
        resubscribePosMenuAfterAuth();

        void registerPosDevice(authUid)
          .then((registered) => {
            setDevice(registered);
            setLastHeartbeatAt(Date.now());
          })
          .catch(() => {});

        void reconcilePosSessionFromRemote(authUid).then((merged) => {
          if (merged) setSession(merged);
        });
        void seedPosMenuIfEmpty().catch(() => {});
      } catch (err) {
        // คง ready ไว้ — ขายบนเครื่องได้แม้ auth/sync ยังไม่สำเร็จ
        setError((err as Error).message || "เชื่อมต่อคลาวด์ไม่สำเร็จ — ขายบนเครื่องได้");
      }
    }

    applyReadyState(localDeviceId);
    void finishBackgroundAuth();
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
    if (!session?.id || session.status !== "open") return;

    storePosSessionId(deviceId, session.id);
    return subscribePosSession(session.id, (remote) => {
      const local = readLocalOpenPosSession(deviceId);
      const merged = applyRemotePosSessionUpdate(deviceId, local, remote);
      if (!remote && local?.id === session.id && local.status === "open") {
        void persistOpenPosSession(local).catch(() => {});
      }
      if (merged?.status === "open") {
        setSession(merged);
        return;
      }
      if (merged?.status === "closed") {
        setSession(merged);
      }
    });
  }, [status, session?.id, session?.status]);

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

  const handleOpenShift = useCallback(() => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setError(null);
    const next = startPosSessionLocal(deviceId, getCurrentShiftId());
    storePosSessionId(deviceId, next.id);
    setSession(next);
    void persistOpenPosSession(next).catch(() => {
      /* ขายบนเครื่องได้ต่อ — subscribe จะลองส่งอีกครั้ง */
    });
  }, []);

  const handleCloseShift = useCallback(
    async (totals?: { cashTotal: number; promptpayTotal: number }) => {
      const deviceId = deviceIdRef.current;
      const current = session;
      if (!deviceId || !current || current.status !== "open") return;

      setError(null);

      const snap = await refreshPosSyncSnapshot();
      const pending = snap.pendingCount + snap.failedCount;

      // ปิดบนเครื่องทันที — ไม่รอ Firebase
      const closed = closePosSessionLocal(current.id, deviceId, {
        ...current,
        saleCount: current.saleCount,
        totalSales: current.totalSales,
      });
      setSession(closed);
      saveLocalClosedSession({
        ...closed,
        closedAt: closed.closedAt || Date.now(),
        cashTotal: totals?.cashTotal ?? 0,
        promptpayTotal: totals?.promptpayTotal ?? 0,
      });

      // sync เงียบด้านหลัง: ส่งบิลค้างก่อน แล้วค่อยปิดรอบบนเซิร์ฟ
      void (async () => {
        await runPosSyncFlush();
        await persistClosedPosSession(closed);
      })();

      if (pending > 0) {
        setError(`ปิดรอบบนเครื่องแล้ว — กำลังส่งบิลค้าง ${pending} รายการเบื้องหลัง`);
      }
    },
    [session],
  );

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
          void ackPosDeviceReload(deviceId, next.forceReloadAt).catch(() => {});
          hardReloadWithCacheBust("device-force");
        }
      },
      (err) => setError(err.message),
    );
  }, [status]);

  useEffect(() => {
    return subscribePosPrinterSetup(() => setPrinterSetupTick((n) => n + 1));
  }, []);

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
  const hardware = useMemo(
    () => getPosHardwareSnapshot(online),
    // printerSetupTick refreshes label when Firestore/local printer config changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional tick
    [online, printerSetupTick],
  );

  const value: PosAppContextValue = {
    status,
    device,
    session,
    selling,
    shift,
    error: error || (heartbeatError && connectivity.pill !== "online" ? heartbeatError : null),
    setError,
    online,
    standalone,
    canInstall,
    opening,
    connectivity,
    hardware,
    syncSnap,
    setSyncSnap,
    syncPanelOpen,
    setSyncPanelOpen,
    sellBusy,
    setSellBusy,
    locked,
    setLocked: setLockedPersist,
    boot,
    handleOpenShift,
    handleCloseShift,
    installApp,
    performReload,
  };

  return <PosAppContext.Provider value={value}>{children}</PosAppContext.Provider>;
}

export function usePosApp() {
  const ctx = useContext(PosAppContext);
  if (!ctx) throw new Error("usePosApp must be used within PosAppProvider");
  return ctx;
}
