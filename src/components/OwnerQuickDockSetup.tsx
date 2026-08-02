"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, PanelsTopLeft, RotateCcw } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_OWNER_QUICK_KEYS,
  OWNER_QUICK_ABBR_MAX,
  OWNER_QUICK_CATALOG,
  OWNER_QUICK_MAX,
  abbrForOwnerQuickKey,
  moveOwnerQuickKey,
  saveOwnerQuickSettings,
  setOwnerQuickAbbr,
  setupOwnerQuickListOrder,
  subscribeOwnerQuickSettings,
  toggleOwnerQuickKey,
  type OwnerQuickAbbrs,
  type OwnerQuickKey,
  type OwnerQuickSettings,
} from "@/lib/owner-quick-dock";

/**
 * ตั้งค่าไอคอนลอยเจ้าของ — ใน อื่นๆ → ตั้งค่าโมดูล
 * ปิด/เปิด · เรียงลำดับ · ตั้งชื่อย่อ · บันทึกทันที
 */
export function OwnerQuickDockSetup({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const { actorId } = useAuth();
  const [settings, setSettings] = useState<OwnerQuickSettings>({
    keys: [...DEFAULT_OWNER_QUICK_KEYS],
    abbrs: {},
  });
  const [draftAbbrs, setDraftAbbrs] = useState<Record<OwnerQuickKey, string>>(
    {} as Record<OwnerQuickKey, string>,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeOwnerQuickSettings(
      (next) => {
        setSettings(next);
        const drafts = {} as Record<OwnerQuickKey, string>;
        for (const key of Object.keys(OWNER_QUICK_CATALOG) as OwnerQuickKey[]) {
          drafts[key] = abbrForOwnerQuickKey(key, next.abbrs);
        }
        setDraftAbbrs(drafts);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดไอคอนลอยไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  async function persist(next: OwnerQuickSettings) {
    if (!actorId) {
      onError("บันทึกไม่ได้ — ลองเข้าสู่ระบบใหม่");
      return;
    }
    setBusy(true);
    onError(null);
    setSettings(next);
    try {
      const saved = await saveOwnerQuickSettings(next, actorId);
      setSettings(saved);
    } catch (err) {
      onError((err as Error).message || "บันทึกไอคอนลอยไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: OwnerQuickKey, on: boolean) {
    await persist({
      ...settings,
      keys: toggleOwnerQuickKey(settings.keys, key, on),
    });
  }

  async function move(key: OwnerQuickKey, dir: -1 | 1) {
    const keys = moveOwnerQuickKey(settings.keys, key, dir);
    if (keys.join("|") === settings.keys.join("|")) return;
    await persist({ ...settings, keys });
  }

  async function commitAbbr(key: OwnerQuickKey) {
    const raw = draftAbbrs[key] ?? "";
    const abbrs: OwnerQuickAbbrs = setOwnerQuickAbbr(settings.abbrs, key, raw);
    const resolved = abbrForOwnerQuickKey(key, abbrs);
    setDraftAbbrs((prev) => ({ ...prev, [key]: resolved }));
    const same =
      JSON.stringify(abbrs) === JSON.stringify(settings.abbrs);
    if (same) return;
    await persist({ ...settings, abbrs });
  }

  async function resetDefault() {
    if (!window.confirm("รีเซ็ตไอคอนลอยเป็นค่าเริ่มต้น (เจ · VAT · กำไร · พนง)?")) {
      return;
    }
    const next: OwnerQuickSettings = {
      keys: [...DEFAULT_OWNER_QUICK_KEYS],
      abbrs: {},
    };
    await persist(next);
    const drafts = {} as Record<OwnerQuickKey, string>;
    for (const key of Object.keys(OWNER_QUICK_CATALOG) as OwnerQuickKey[]) {
      drafts[key] = OWNER_QUICK_CATALOG[key].abbr;
    }
    setDraftAbbrs(drafts);
  }

  const listOrder = setupOwnerQuickListOrder(settings.keys);
  const active = new Set(settings.keys);

  return (
    <SettingsFold
      title={
        <>
          <PanelsTopLeft size={16} aria-hidden />
          ไอคอนลอย (ทางลัดเจ้าของ)
        </>
      }
      hint={
        <>
          ชิปลอยเหนือแถบล่าง · เลือกสูงสุด {OWNER_QUICK_MAX} · เปิด/ปิด · เรียงลำดับ ·
          ตั้งชื่อย่อ (ไม่เกิน {OWNER_QUICK_ABBR_MAX} ตัว) — บันทึกทันที · กดค้างชิปบนหน้างานก็ตั้งได้
        </>
      }
      defaultOpen={false}
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <>
          <p className="muted owner-quick-setup-count">
            เปิดอยู่ {settings.keys.length} / {OWNER_QUICK_MAX}
            {settings.keys.length >= OWNER_QUICK_MAX ? " — เต็มแล้ว" : ""}
            {busy ? " · กำลังบันทึก…" : ""}
          </p>

          <ol className="nav-order-list owner-quick-settings-list">
            {listOrder.map((key) => {
              const item = OWNER_QUICK_CATALOG[key];
              const on = active.has(key);
              const idx = settings.keys.indexOf(key);
              return (
                <li
                  key={key}
                  className={
                    on ? "nav-order-row owner-quick-settings-row is-on" : "nav-order-row owner-quick-settings-row"
                  }
                >
                  <label className="nav-dock-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy || (!on && settings.keys.length >= OWNER_QUICK_MAX)}
                      onChange={(e) => void toggle(key, e.target.checked)}
                    />
                  </label>
                  <div className="nav-order-copy owner-quick-settings-copy">
                    <div className="owner-quick-settings-abbr-row">
                      <input
                        type="text"
                        className="owner-quick-abbr-input"
                        value={draftAbbrs[key] ?? item.abbr}
                        maxLength={OWNER_QUICK_ABBR_MAX}
                        disabled={busy}
                        aria-label={`ชื่อย่อ ${item.label}`}
                        title={`ชื่อย่อบนชิป (สูงสุด ${OWNER_QUICK_ABBR_MAX})`}
                        onChange={(e) =>
                          setDraftAbbrs((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        onBlur={() => void commitAbbr(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                      <span className="nav-order-label">{item.label}</span>
                    </div>
                    <span className="nav-order-placement">
                      {on ? `ลอย #${idx + 1}` : "ปิด"}
                    </span>
                  </div>
                  {on ? (
                    <div className="nav-order-actions">
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        aria-label={`เลื่อน ${item.label} ขึ้น`}
                        disabled={busy || idx === 0}
                        onClick={() => void move(key, -1)}
                      >
                        <ChevronUp size={18} />
                      </button>
                      <button
                        type="button"
                        className="ghost-btn icon-btn"
                        aria-label={`เลื่อน ${item.label} ลง`}
                        disabled={busy || idx >= settings.keys.length - 1}
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
    </SettingsFold>
  );
}
