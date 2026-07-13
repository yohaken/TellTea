"use client";

import { useRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { reorderById } from "@/lib/pos-drag-reorder";

/** เรียงลำดับด้วยปุ่ม ↑↓ เท่านั้น — ไม่ใช้ลาก (ชัวร์บนแท็บเล็ต) */
export function PosSortableList({
  ids,
  onReorder,
  className,
  renderItem,
}: {
  ids: string[];
  onReorder: (nextIds: string[]) => void;
  className?: string;
  renderItem: (id: string, index: number) => ReactNode;
}) {
  const idsRef = useRef(ids);
  idsRef.current = ids;

  function moveBy(id: string, delta: -1 | 1) {
    const currentIds = idsRef.current;
    const from = currentIds.indexOf(id);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= currentIds.length) return;
    const targetId = currentIds[to]!;
    const next = reorderById(currentIds, id, targetId);
    if (next.join() !== currentIds.join()) onReorder(next);
  }

  return (
    <ul className={className}>
      {ids.map((id, index) => (
        <li key={id} data-sort-id={id} className="pos-sortable-row">
          <div className="pos-sortable-controls" aria-label="เลื่อนลำดับ">
            <button
              type="button"
              className="pos-sortable-step"
              aria-label="เลื่อนขึ้น"
              disabled={index === 0}
              onClick={() => moveBy(id, -1)}
            >
              <ChevronUp size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="pos-sortable-step"
              aria-label="เลื่อนลง"
              disabled={index === ids.length - 1}
              onClick={() => moveBy(id, 1)}
            >
              <ChevronDown size={18} aria-hidden />
            </button>
          </div>
          <div className="pos-sortable-body">{renderItem(id, index)}</div>
        </li>
      ))}
    </ul>
  );
}
