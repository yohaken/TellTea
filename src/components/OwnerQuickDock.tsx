"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_OWNER_QUICK_KEYS,
  OWNER_QUICK_ABBR_MAX,
  OWNER_QUICK_CATALOG,
  OWNER_QUICK_MAX,
  abbrForOwnerQuickKey,
  moveOwnerQuickKey,
  resolveOwnerQuickItems,
  saveOwnerQuickSettings,
  setOwnerQuickAbbr,
  setupOwnerQuickListOrder,
  subscribeOwnerQuickSettings,
  toggleOwnerQuickKey,
  type OwnerQuickKey,
  type OwnerQuickSettings,
} from "@/lib/owner-quick-dock";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 480;

/**
 * ทางลัดเจ้าของ — ชิปตัวย่อลอยเหนือเมนูล่างทุกหน้า
 * แตะ = ไปหน้า · กดค้าง = ตั้งค่าลำดับ/ชื่อย่อ
 */
export function OwnerQuickDock() {
  const pathname = usePathname();
  const { staff, user } = useAuth();
  const isOwner = staff?.role === "owner";
  const [settings, setSettings] = useState<OwnerQuickSettings>({
    keys: [...DEFAULT_OWNER_QUICK_KEYS],
    abbrs: {},
  });
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!isOwner) return;
    return subscribeOwnerQuickSettings(setSettings);
  }, [isOwner]);

  useBodyScrollLock(setupOpen);

  if (!isOwner) return null;
  // แสดงทุกหน้าหลังร้าน (AppShell) — อย่าใช้ startsWith("/pos") เพราะจะซ่อน /pos-sales/ ด้วย
  // แท็บเล็ต POS (/pos/…) ไม่ผ่าน AppShell อยู่แล้ว

  const items = resolveOwnerQuickItems(settings.keys, settings.abbrs);
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

  async function persist(next: OwnerQuickSettings) {
    setSettings(next);
    settingsRef.current = next;
    setError(null);
    if (!actorId) {
      setError("บันทึกลำดับไม่ได้ — ลองเข้าสู่ระบบใหม่");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveOwnerQuickSettings(next, actorId);
      setSettings(saved);
      settingsRef.current = saved;
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
          const hrefBase = item.href.replace(/\/$/, "");
          const active =
            pathname === item.href ||
            pathname === hrefBase ||
            pathname.startsWith(`${hrefBase}/`);
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
          settings={settings}
          busy={busy}
          error={error}
          onClose={() => {
            setSetupOpen(false);
            setError(null);
          }}
          onToggle={(key, on) =>
            void persist({
              ...settingsRef.current,
              keys: toggleOwnerQuickKey(settingsRef.current.keys, key, on),
            })
          }
          onMove={(key, dir) =>
            void persist({
              ...settingsRef.current,
              keys: moveOwnerQuickKey(settingsRef.current.keys, key, dir),
            })
          }
          onAbbr={(key, raw) =>
            void persist({
              ...settingsRef.current,
              abbrs: setOwnerQuickAbbr(settingsRef.current.abbrs, key, raw),
            })
          }
          onReset={() =>
            void persist({
              keys: [...DEFAULT_OWNER_QUICK_KEYS],
              abbrs: {},
            })
          }
        />
      ) : null}
    </>
  );
}

function OwnerQuickSetupModal({
  settings,
  busy,
  error,
  onClose,
  onToggle,
  onMove,
  onAbbr,
  onReset,
}: {
  settings: OwnerQuickSettings;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onToggle: (key: OwnerQuickKey, on: boolean) => void;
  onMove: (key: OwnerQuickKey, dir: -1 | 1) => void;
  onAbbr: (key: OwnerQuickKey, raw: string) => void;
  onReset: () => void;
}) {
  const { keys, abbrs } = settings;
  const active = new Set(keys);
  const listOrder = setupOwnerQuickListOrder(keys);
  const [draftAbbrs, setDraftAbbrs] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const key of listOrder) {
      d[key] = abbrForOwnerQuickKey(key, abbrs);
    }
    return d;
  });

  useEffect(() => {
    setDraftAbbrs(() => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(OWNER_QUICK_CATALOG) as OwnerQuickKey[]) {
        next[key] = abbrForOwnerQuickKey(key, abbrs);
      }
      return next;
    });
  }, [abbrs]);

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
          เลือกสูงสุด {OWNER_QUICK_MAX} · ชื่อย่อ / ↑↓ · หรือไป อื่นๆ → ตั้งค่าโมดูล
          {busy ? " · กำลังบันทึก…" : ""}
        </p>
        {error ? <p className="error-text">{error}</p> : null}

        <ul className="owner-quick-setup-list">
          {listOrder.map((key) => {
            const item = OWNER_QUICK_CATALOG[key];
            const on = active.has(key);
            const idx = keys.indexOf(key);
            return (
              <li
                key={key}
                className={cn(
                  "owner-quick-setup-row",
                  on && "is-on",
                  on && idx === 0 && "is-first",
                )}
              >
                <label className="owner-quick-setup-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && keys.length >= OWNER_QUICK_MAX}
                    onChange={(e) => onToggle(key, e.target.checked)}
                  />
                  {on ? (
                    <span className="owner-quick-setup-rank" aria-hidden>
                      {idx + 1}
                    </span>
                  ) : (
                    <span className="owner-quick-setup-rank is-off" aria-hidden>
                      ·
                    </span>
                  )}
                  <input
                    type="text"
                    className="owner-quick-abbr-input owner-quick-setup-abbr-input"
                    value={draftAbbrs[key] ?? item.abbr}
                    maxLength={OWNER_QUICK_ABBR_MAX}
                    aria-label={`ชื่อย่อ ${item.label}`}
                    onChange={(e) =>
                      setDraftAbbrs((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    onBlur={() => onAbbr(key, draftAbbrs[key] ?? "")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <span className="owner-quick-setup-label">{item.label}</span>
                </label>
                {on ? (
                  <span className="owner-quick-setup-move">
                    <button
                      type="button"
                      className="ghost-btn owner-quick-move-btn"
                      disabled={idx <= 0}
                      aria-label={`เลื่อน ${item.label} ขึ้น`}
                      onClick={() => onMove(key, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ghost-btn owner-quick-move-btn"
                      disabled={idx < 0 || idx >= keys.length - 1}
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
          <button type="button" className="ghost-btn" onClick={onReset}>
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
