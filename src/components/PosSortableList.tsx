"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { reorderById } from "@/lib/pos-drag-reorder";

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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  function applyOver(id: string | null) {
    overIdRef.current = id;
    setOverId(id);
  }

  function commitDrop(targetId: string) {
    const fromId = dragIdRef.current;
    const currentIds = idsRef.current;
    if (!fromId || !currentIds.includes(targetId)) {
      endDrag();
      return;
    }
    const next = reorderById(currentIds, fromId, targetId);
    dragIdRef.current = null;
    applyOver(null);
    setDragId(null);
    if (next.join() !== currentIds.join()) onReorder(next);
  }

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

  function startDrag(id: string) {
    dragIdRef.current = id;
    setDragId(id);
  }

  function endDrag() {
    dragIdRef.current = null;
    applyOver(null);
    setDragId(null);
  }

  return (
    <ul className={className}>
      {ids.map((id, index) => (
        <li
          key={id}
          data-sort-id={id}
          className={`pos-sortable-row ${overId === id ? "pos-sortable-row--over" : ""} ${dragId === id ? "pos-sortable-row--drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            applyOver(id);
          }}
          onDragLeave={() => applyOver(overIdRef.current === id ? null : overIdRef.current)}
          onDrop={(e) => {
            e.preventDefault();
            commitDrop(id);
          }}
        >
          <div className="pos-sortable-controls">
            <button
              type="button"
              className="pos-sortable-step"
              aria-label="เลื่อนขึ้น"
              disabled={index === 0}
              onClick={() => moveBy(id, -1)}
            >
              <ChevronUp size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="pos-sortable-step"
              aria-label="เลื่อนลง"
              disabled={index === ids.length - 1}
              onClick={() => moveBy(id, 1)}
            >
              <ChevronDown size={16} aria-hidden />
            </button>
            <span
              className="pos-sortable-handle"
              draggable
              onDragStart={() => startDrag(id)}
              onDragEnd={endDrag}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                startDrag(id);
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerUp={(e) => {
                const target = overIdRef.current;
                if (dragIdRef.current && target) commitDrop(target);
                else endDrag();
                try {
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
              }}
              onPointerCancel={endDrag}
              onPointerMove={(e) => {
                if (!dragIdRef.current) return;
                const el = document.elementFromPoint(e.clientX, e.clientY);
                const row = el?.closest(".pos-sortable-row");
                const targetId = row?.getAttribute("data-sort-id");
                if (targetId && idsRef.current.includes(targetId)) applyOver(targetId);
              }}
              data-sort-id={id}
              aria-label="ลากเรียงลำดับ"
              title="ลากเรียงลำดับ"
            >
              <GripVertical size={16} aria-hidden />
            </span>
          </div>
          <div className="pos-sortable-body" data-sort-id={id}>
            {renderItem(id, index)}
          </div>
        </li>
      ))}
    </ul>
  );
}
