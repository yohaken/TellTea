"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, LayoutList, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_DOCK_TAB_KEYS,
  DEFAULT_NAV_ORDER,
  DOCK_TAB_MAX,
  moveDockTabKey,
  NAV_MODULE_DESCRIPTIONS,
  NAV_MODULE_KEYS,
  NAV_TAB_LABELS,
  normalizeNavUi,
  saveNavUi,
  subscribeNavUi,
  type NavModuleKey,
  type NavUiSettings,
} from "@/lib/nav-menu";

export function NavMenuOrderSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [ui, setUi] = useState<NavUiSettings>({
    navOrder: [...DEFAULT_NAV_ORDER],
    dockTabKeys: [...DEFAULT_DOCK_TAB_KEYS],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeNavUi(
      (settings) => {
        setUi(settings);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดเมนูไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  async function persist(next: NavUiSettings) {
    if (!actorId) return;
    setBusy(true);
    onError(null);
    try {
      await saveNavUi(
        {
          navOrder: next.navOrder,
          dockTabKeys: next.dockTabKeys,
        },
        actorId,
      );
      setUi(normalizeNavUi(next));
    } catch (err) {
      onError((err as Error).message || "บันทึกเมนูไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDock(key: NavModuleKey, on: boolean) {
    const dockSet = new Set(ui.dockTabKeys);
    if (on) {
      if (dockSet.size >= DOCK_TAB_MAX) return;
      dockSet.add(key);
    } else {
      dockSet.delete(key);
    }
    const dockTabKeys = NAV_MODULE_KEYS.filter((k) => dockSet.has(k));
    await persist({ ...ui, dockTabKeys });
  }

  async function move(key: NavModuleKey, dir: -1 | 1) {
    const next = moveDockTabKey(ui.dockTabKeys, key, dir);
    if (next.join("|") === ui.dockTabKeys.join("|")) return;
    await persist({ ...ui, dockTabKeys: next });
  }

  async function resetDefault() {
    if (!window.confirm("รีเซ็ตเมนูหลักเป็นค่าเริ่มต้น?")) return;
    await persist({
      navOrder: [...DEFAULT_NAV_ORDER],
      dockTabKeys: [...DEFAULT_DOCK_TAB_KEYS],
    });
  }

  const dockCount = ui.dockTabKeys.length;
  const moreKeys = NAV_MODULE_KEYS.filter((k) => !ui.dockTabKeys.includes(k));

  return (
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">
        <LayoutList size={16} aria-hidden style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
        เมนูหลัก (แถบล่าง)
      </h2>
      <p className="muted owner-settings-hint">
        เลือกได้สูงสุด {DOCK_TAB_MAX} โมดูลบนแถบล่าง — ที่ไม่ได้เลือกจะไปอยู่หน้า <strong>อื่นๆ</strong>{" "}
        อัตโนมัติ พนักงานเห็นเฉพาะตามสิทธิ์
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <>
          <p className="nav-dock-count" aria-live="polite">
            แถบล่าง: <strong>{dockCount}</strong> / {DOCK_TAB_MAX}
            {dockCount >= DOCK_TAB_MAX ? " — เต็มแล้ว" : ""}
          </p>

          <ol className="nav-order-list">
            {NAV_MODULE_KEYS.map((key) => {
              const onDock = ui.dockTabKeys.includes(key);
              const dockIdx = ui.dockTabKeys.indexOf(key);
              return (
                <li key={key} className="nav-order-row">
                  <label className="nav-dock-toggle">
                    <input
                      type="checkbox"
                      checked={onDock}
                      disabled={busy || (!onDock && dockCount >= DOCK_TAB_MAX)}
                      onChange={(e) => void toggleDock(key, e.target.checked)}
                    />
                  </label>
                  <div className="nav-order-copy">
                    <span className="nav-order-label">{NAV_TAB_LABELS[key]}</span>
                    <span className="nav-order-desc">{NAV_MODULE_DESCRIPTIONS[key]}</span>
                    <span className="nav-order-placement">{onDock ? "แถบล่าง" : "หน้า อื่นๆ"}</span>
                  </div>
                  {onDock ? (
                    <div className="nav-order-actions">
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        aria-label={`เลื่อน ${NAV_TAB_LABELS[key]} ขึ้น`}
                        disabled={busy || dockIdx === 0}
                        onClick={() => void move(key, -1)}
                      >
                        <ChevronUp size={18} />
                      </button>
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        aria-label={`เลื่อน ${NAV_TAB_LABELS[key]} ลง`}
                        disabled={busy || dockIdx === ui.dockTabKeys.length - 1}
                        onClick={() => void move(key, 1)}
                      >
                        <ChevronDown size={18} />
                      </button>
                    </div>
                  ) : (
                    <span className="nav-order-rank muted">—</span>
                  )}
                </li>
              );
            })}
          </ol>

          {moreKeys.length > 0 ? (
            <p className="muted nav-order-foot">
              หน้า อื่นๆ: {moreKeys.map((k) => NAV_TAB_LABELS[k]).join(" · ")}
            </p>
          ) : null}

          <button
            type="button"
            className="ghost-btn nav-order-reset"
            disabled={busy}
            onClick={() => void resetDefault()}
          >
            <RotateCcw size={14} aria-hidden /> รีเซ็ตค่าเริ่มต้น
          </button>
        </>
      ) : null}
    </section>
  );
}
