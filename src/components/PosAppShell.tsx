"use client";

import { usePathname } from "next/navigation";
import { Bell, Menu, RefreshCw } from "lucide-react";
import { AppBrand } from "@/components/AppBrand";
import { PosHardLink } from "@/components/PosHardLink";
import { PosPendingSyncPanel } from "@/components/PosPendingSyncPanel";
import { PosSyncWatcher } from "@/components/PosSyncWatcher";
import { PosUpdateWatcher } from "@/components/PosUpdateWatcher";
import { usePosApp } from "@/lib/pos-app-context";
import { POS_LOCK_HREF, POS_NAV_ITEMS, matchPosNav, posNavLockItem } from "@/lib/pos-nav";
import { posVersionLabel } from "@/lib/pos-version";
import { useState } from "react";

function PosSidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = matchPosNav(pathname);
  const { selling, setLocked } = usePosApp();
  const lock = posNavLockItem();

  return (
    <nav className="pos-sidebar-nav" aria-label="เมนูหลัก">
      {POS_NAV_ITEMS.map((item) => {
        if (item.requiresSelling && !selling) return null;
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <PosHardLink
            key={item.id}
            href={item.href}
            className={`pos-sidebar-link ${isActive ? "is-active" : ""}`}
            onClick={onNavigate}
          >
            <Icon size={20} aria-hidden />
            {!collapsed ? <span>{item.label}</span> : null}
          </PosHardLink>
        );
      })}
      <div className="pos-sidebar-spacer" />
      <PosHardLink
        href={POS_LOCK_HREF}
        className="pos-sidebar-link pos-sidebar-link--lock"
        onClick={() => {
          setLocked(true);
          onNavigate?.();
        }}
      >
        <lock.icon size={20} aria-hidden />
        {!collapsed ? <span>{lock.label}</span> : null}
      </PosHardLink>
    </nav>
  );
}

function PosTopStatus() {
  const {
    connectivity,
    hardware,
    syncSnap,
    sellBusy,
    setSyncPanelOpen,
  } = usePosApp();

  const queueCount = syncSnap.pendingCount + syncSnap.failedCount;

  return (
    <div className="pos-top-status">
      <span
        className={`pos-lite-pill ${hardware.printerReady ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}
        title={hardware.printerLabel}
      >
        {hardware.printerLabel}
      </span>
      <span
        className={`pos-lite-pill ${connectivity.pill === "online" ? "pos-lite-pill--ok" : "pos-lite-pill--warn"}`}
      >
        {connectivity.label}
      </span>
      {sellBusy.syncing ? (
        <button type="button" className="pos-lite-pill pos-lite-pill-btn" onClick={() => setSyncPanelOpen(true)}>
          กำลังส่งข้อมูล
        </button>
      ) : syncSnap.stuckCount > 0 ? (
        <button type="button" className="pos-lite-pill pos-lite-pill--warn pos-lite-pill-btn" onClick={() => setSyncPanelOpen(true)}>
          ค้างส่ง {syncSnap.stuckCount}
        </button>
      ) : queueCount > 0 ? (
        <button type="button" className="pos-lite-pill pos-lite-pill--warn pos-lite-pill-btn" onClick={() => setSyncPanelOpen(true)}>
          รอส่ง {queueCount}
        </button>
      ) : null}
      <span className="pos-top-version muted">{posVersionLabel()}</span>
    </div>
  );
}

export function PosAppShell({ children }: { children: React.ReactNode }) {
  const {
    status,
    standalone,
    syncSnap,
    syncPanelOpen,
    setSyncPanelOpen,
    setSyncSnap,
    sellBusy,
    setSellBusy,
    performReload,
  } = usePosApp();
  const [mobileNav, setMobileNav] = useState(false);

  if (status === "boot" || status === "connecting") {
    return (
      <div className={`pos-shell pos-shell--boot ${standalone ? "pos-lite--standalone" : ""}`}>
        <main className="pos-lite-main">
          <h1>กำลังเชื่อมต่อ...</h1>
          <p className="muted">เปิดเครื่อง POS — ครั้งถัดไปจะเร็วขึ้น</p>
        </main>
      </div>
    );
  }

  return (
    <div className={`pos-shell ${standalone ? "pos-lite--standalone" : ""}`}>
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
      <PosUpdateWatcher enabled={status === "ready"} sellBusy={sellBusy} onReload={performReload} />

      <aside className={`pos-sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="pos-sidebar-brand">
          <AppBrand compact showLogo />
          <div className="pos-sidebar-tools">
            <button type="button" className="pos-icon-btn" aria-label="รีเฟรช" onClick={performReload}>
              <RefreshCw size={16} />
            </button>
            <button type="button" className="pos-icon-btn" aria-label="แจ้งเตือน" disabled>
              <Bell size={16} />
            </button>
          </div>
        </div>
        <PosSidebarNav onNavigate={() => setMobileNav(false)} />
      </aside>

      {mobileNav ? (
        <button
          type="button"
          className="pos-sidebar-backdrop"
          aria-label="ปิดเมนู"
          onClick={() => setMobileNav(false)}
        />
      ) : null}

      <div className="pos-main">
        <header className="pos-main-header">
          <button
            type="button"
            className="pos-mobile-menu-btn"
            aria-label="เปิดเมนู"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={22} />
          </button>
          <PosTopStatus />
        </header>
        <div className="pos-main-body">{children}</div>
      </div>
    </div>
  );
}

export function PosBootError() {
  const { error, boot } = usePosApp();
  return (
    <main className="pos-lite-main">
      <h1>เชื่อมต่อไม่สำเร็จ</h1>
      <p className="error-text">{error}</p>
      <button type="button" className="primary-btn pos-lite-btn" onClick={() => void boot()}>
        ลองใหม่
      </button>
    </main>
  );
}
