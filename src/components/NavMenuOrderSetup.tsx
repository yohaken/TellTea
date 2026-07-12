"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, LayoutList, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_NAV_ORDER,
  moveNavOrderItem,
  NAV_TAB_LABELS,
  NAV_TAB_KEYS,
  saveNavOrder,
  subscribeNavOrder,
  type NavTabKey,
} from "@/lib/nav-menu";

export function NavMenuOrderSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [order, setOrder] = useState<NavTabKey[]>([...DEFAULT_NAV_ORDER]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeNavOrder(
      (rows) => {
        setOrder(rows);
        setLoading(false);
      },
      (err) => {
        onError(err.message || "โหลดลำดับเมนูไม่สำเร็จ");
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  async function persist(next: NavTabKey[]) {
    if (!actorId) return;
    setBusy(true);
    onError(null);
    try {
      await saveNavOrder(next, actorId);
      setOrder(next);
    } catch (err) {
      onError((err as Error).message || "บันทึกลำดับเมนูไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function move(key: NavTabKey, dir: -1 | 1) {
    const next = moveNavOrderItem(order, key, dir);
    if (next.join("|") === order.join("|")) return;
    await persist(next);
  }

  async function resetDefault() {
    if (!window.confirm("รีเซ็ตลำดับเมนูเป็นค่าเริ่มต้น?")) return;
    await persist([...DEFAULT_NAV_ORDER]);
  }

  return (
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">
        <LayoutList size={16} aria-hidden style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
        ลำดับเมนูล่าง
      </h2>
      <p className="muted owner-settings-hint">
        จัดเรียงแท็บด้านล่างทั้งร้าน — พนักงานเห็นเฉพาะแท็บตามสิทธิ์ แต่ลำดับตามที่ตั้งไว้
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <>
          <ol className="nav-order-list">
            {order.map((key, idx) => (
              <li key={key} className="nav-order-row">
                <span className="nav-order-rank">{idx + 1}</span>
                <span className="nav-order-label">{NAV_TAB_LABELS[key]}</span>
                <div className="nav-order-actions">
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label={`เลื่อน ${NAV_TAB_LABELS[key]} ขึ้น`}
                    disabled={busy || idx === 0}
                    onClick={() => void move(key, -1)}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label={`เลื่อน ${NAV_TAB_LABELS[key]} ลง`}
                    disabled={busy || idx === order.length - 1}
                    onClick={() => void move(key, 1)}
                  >
                    <ChevronDown size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <p className="muted nav-order-foot">
            แท็บทั้งหมด: {NAV_TAB_KEYS.map((k) => NAV_TAB_LABELS[k]).join(" · ")}
          </p>

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
