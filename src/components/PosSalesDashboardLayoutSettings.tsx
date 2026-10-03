"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import {
  movePosDashCard,
  POS_DASH_DEFAULT_ORDER,
  posDashCardLabel,
  samePosDashOrder,
  type PosDashCardId,
} from "@/lib/pos-dash-layout";

/**
 * ตั้งค่าลำดับกล่องแดชบอร์ด — ลากที่ด้ามจับ (pointer events ใช้ได้ทั้งเมาส์/นิ้ว) หรือ ↑↓ / ลูกศรคีย์บอร์ด
 * ทุกการวางเรียก onChange ทันที — parent บันทึกขึ้น cloud
 */
export function PosSalesDashboardLayoutSettings({
  order,
  status,
  onChange,
  onClose,
}: {
  order: PosDashCardId[];
  status: "idle" | "saving" | "saved" | "error";
  onChange: (order: PosDashCardId[]) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: PosDashCardId; draft: PosDashCardId[] } | null>(null);
  const shown = drag?.draft ?? order;

  function targetIndex(clientY: number, id: PosDashCardId): number {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [];
    let idx = 0;
    items.forEach((el) => {
      if (el.dataset.cardId === id) return;
      const r = el.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) idx++;
    });
    return idx;
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, id: PosDashCardId) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ id, draft: order });
  }

  // Window listeners, not pointer capture: React re-inserts the dragged <li> when it moves down,
  // which drops capture on the handle mid-drag.
  const handlers = useRef({ move: onPointerMove, up: onPointerUp });
  handlers.current = { move: onPointerMove, up: onPointerUp };
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: globalThis.PointerEvent) => handlers.current.move(e);
    const up = () => handlers.current.up();
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging]);

  function onPointerMove(e: { clientY: number }) {
    if (!drag) return;
    const edge = 72;
    if (e.clientY < edge) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    const from = drag.draft.indexOf(drag.id);
    const to = targetIndex(e.clientY, drag.id);
    if (from !== to) setDrag({ id: drag.id, draft: movePosDashCard(drag.draft, from, to) });
  }

  function onPointerUp() {
    if (!drag) return;
    const next = drag.draft;
    setDrag(null);
    if (!samePosDashOrder(next, order)) onChange(next);
  }

  function step(id: PosDashCardId, dir: -1 | 1) {
    const from = order.indexOf(id);
    const next = movePosDashCard(order, from, from + dir);
    if (!samePosDashOrder(next, order)) onChange(next);
  }

  function onHandleKey(e: KeyboardEvent<HTMLButtonElement>, id: PosDashCardId) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      step(id, e.key === "ArrowUp" ? -1 : 1);
    }
  }

  const isDefault = samePosDashOrder(order, POS_DASH_DEFAULT_ORDER);

  return (
    <section className="pos-dash-layout" aria-label="จัดลำดับกล่อง">
      <div className="pos-dash-layout-head">
        <h3 className="pos-dash-card-title">จัดลำดับกล่อง</h3>
        <span className={`pos-dash-layout-status is-${status}`} role="status">
          {status === "saving"
            ? "กำลังบันทึก…"
            : status === "saved"
              ? "บันทึกแล้ว"
              : status === "error"
                ? "บันทึกไม่สำเร็จ"
                : "ลากเพื่อย้าย"}
        </span>
        <button
          type="button"
          className="npos-slim-text-btn"
          disabled={isDefault}
          onClick={() => onChange([...POS_DASH_DEFAULT_ORDER])}
        >
          ค่าเริ่มต้น
        </button>
        <button type="button" className="npos-slim-text-btn" onClick={onClose}>
          เสร็จ
        </button>
      </div>
      <ol ref={listRef} className="pos-dash-layout-list">
        {shown.map((id, i) => (
          <li
            key={id}
            data-card-id={id}
            className={`pos-dash-layout-item${drag?.id === id ? " is-dragging" : ""}`}
          >
            <button
              type="button"
              className="pos-dash-layout-handle"
              aria-label={`ลากเพื่อย้าย ${posDashCardLabel(id)}`}
              onPointerDown={(e) => onPointerDown(e, id)}
              onKeyDown={(e) => onHandleKey(e, id)}
            >
              <GripVertical size={16} aria-hidden />
            </button>
            <span className="pos-dash-layout-num">{i + 1}</span>
            <span className="pos-dash-layout-label">{posDashCardLabel(id)}</span>
            <button
              type="button"
              className="pos-dash-layout-step"
              aria-label={`เลื่อนขึ้น ${posDashCardLabel(id)}`}
              disabled={i === 0 || !!drag}
              onClick={() => step(id, -1)}
            >
              <ChevronUp size={15} aria-hidden />
            </button>
            <button
              type="button"
              className="pos-dash-layout-step"
              aria-label={`เลื่อนลง ${posDashCardLabel(id)}`}
              disabled={i === shown.length - 1 || !!drag}
              onClick={() => step(id, 1)}
            >
              <ChevronDown size={15} aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
