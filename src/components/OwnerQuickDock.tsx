"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_OWNER_QUICK_KEYS,
  moveOwnerQuickKey,
  OWNER_QUICK_CATALOG,
  OWNER_QUICK_KEYS,
  OWNER_QUICK_MAX,
  resolveOwnerQuickItems,
  saveOwnerQuickKeys,
  subscribeOwnerQuickKeys,
  toggleOwnerQuickKey,
  type OwnerQuickKey,
} from "@/lib/owner-quick-dock";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 480;

/**
 * ทางลัดเจ้าของ — ชิปตัวย่อลอยเหนือเมนูล่างทุกหน้า
 * แตะ = ไปหน้า · กดค้าง = ตั้งค่าลำดับ
 */
export function OwnerQuickDock() {
  const pathname = usePathname();
  const { staff, user } = useAuth();
  const isOwner = staff?.role === "owner";
  const [keys, setKeys] = useState<OwnerQuickKey[]>([...DEFAULT_OWNER_QUICK_KEYS]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    return subscribeOwnerQuickKeys(setKeys);
  }, [isOwner]);

  useBodyScrollLock(setupOpen);

  if (!isOwner) return null;
  // POS ใช้ shell คนละชุด — กันไว้ถ้าเคยหุ้ม AppShell
  if (pathname.startsWith("/pos")) return null;

  const items = resolveOwnerQuickItems(keys);
  const actorId = user?.uid || staff?.id || "";

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function startPress() {
    pressFired.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      pressFired.current = true;
      setSetupOpen(true);
    }, LONG_PRESS_MS);
  }

  function onChipClick(e: MouseEvent<HTMLAnchorElement>) {
    if (pressFired.current) {
      e.preventDefault();
      pressFired.current = false;
    }
  }

  async function persist(next: OwnerQuickKey[]) {
    if (!actorId) return;
    setBusy(true);
    setError(null);
    try {
      await saveOwnerQuickKeys(next, actorId);
      setKeys(next);
    } catch (err) {
      setError((err as Error).message || "บันทึกลำดับไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="owner-quick-dock"
        role="navigation"
        aria-label="ทางลัดเจ้าของ"
      >
        {items.map((item) => {
          const active =
            pathname === item.href ||
            pathname.startsWith(item.href.replace(/\/$/, ""));
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn("owner-quick-chip", active && "is-active")}
              title={`${item.label} · กดค้างตั้งค่า`}
              aria-label={item.label}
              onPointerDown={startPress}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onContextMenu={(e) => {
                e.preventDefault();
                setSetupOpen(true);
              }}
              onClick={onChipClick}
            >
              <span className="owner-quick-abbr">{item.abbr}</span>
            </Link>
          );
        })}
      </div>

      {setupOpen ? (
        <OwnerQuickSetupModal
          keys={keys}
          busy={busy}
          error={error}
          onClose={() => {
            setSetupOpen(false);
            setError(null);
          }}
          onToggle={(key, on) => void persist(toggleOwnerQuickKey(keys, key, on))}
          onMove={(key, dir) => void persist(moveOwnerQuickKey(keys, key, dir))}
          onReset={() => void persist([...DEFAULT_OWNER_QUICK_KEYS])}
        />
      ) : null}
    </>
  );
}

function OwnerQuickSetupModal({
  keys,
  busy,
  error,
  onClose,
  onToggle,
  onMove,
  onReset,
}: {
  keys: OwnerQuickKey[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onToggle: (key: OwnerQuickKey, on: boolean) => void;
  onMove: (key: OwnerQuickKey, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  const active = new Set(keys);

  return (
    <div
      className="modal-backdrop owner-quick-setup"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card owner-quick-setup-card"
        role="dialog"
        aria-modal="true"
        aria-label="ตั้งค่าทางลัดเจ้าของ"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entry-toolbar module-form-head">
          <h2 className="panel-title">ทางลัดเจ้าของ</h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted owner-quick-setup-hint">
          เลือกสูงสุด {OWNER_QUICK_MAX} · จัดลำดับซ้าย→ขวา · เฉพาะเจ้าของ
        </p>
        {error ? <p className="error-text">{error}</p> : null}

        <ul className="owner-quick-setup-list">
          {OWNER_QUICK_KEYS.map((key) => {
            const item = OWNER_QUICK_CATALOG[key];
            const on = active.has(key);
            const idx = keys.indexOf(key);
            return (
              <li key={key} className="owner-quick-setup-row">
                <label className="owner-quick-setup-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || (!on && keys.length >= OWNER_QUICK_MAX)}
                    onChange={(e) => onToggle(key, e.target.checked)}
                  />
                  <span className="owner-quick-setup-abbr">{item.abbr}</span>
                  <span className="owner-quick-setup-label">{item.label}</span>
                </label>
                {on ? (
                  <span className="owner-quick-setup-move">
                    <button
                      type="button"
                      className="ghost-btn owner-quick-move-btn"
                      disabled={busy || idx <= 0}
                      aria-label={`เลื่อน ${item.label} ขึ้น`}
                      onClick={() => onMove(key, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ghost-btn owner-quick-move-btn"
                      disabled={busy || idx < 0 || idx >= keys.length - 1}
                      aria-label={`เลื่อน ${item.label} ลง`}
                      onClick={() => onMove(key, 1)}
                    >
                      ↓
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="entry-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={onReset}
          >
            คืนค่าเริ่มต้น
          </button>
          <button type="button" className="primary-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
