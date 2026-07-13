"use client";

import { useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
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

  function commitDrop(targetId: string) {
    const fromId = dragIdRef.current;
    if (!fromId) return;
    const next = reorderById(ids, fromId, targetId);
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
    if (next.join() !== ids.join()) onReorder(next);
  }

  function startDrag(id: string) {
    dragIdRef.current = id;
    setDragId(id);
  }

  function endDrag() {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
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
            setOverId(id);
          }}
          onDragLeave={() => setOverId((cur) => (cur === id ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            commitDrop(id);
          }}
        >
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
              if (dragIdRef.current && overId) commitDrop(overId);
              endDrag();
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
            onPointerMove={(e) => {
              if (!dragIdRef.current) return;
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const row = el?.closest(".pos-sortable-row");
              const targetId = row?.getAttribute("data-sort-id");
              if (targetId) setOverId(targetId);
            }}
            data-sort-id={id}
            aria-label="ลากเรียงลำดับ"
            title="ลากเรียงลำดับ"
          >
            <GripVertical size={16} aria-hidden />
          </span>
          <div className="pos-sortable-body" data-sort-id={id}>
            {renderItem(id, index)}
          </div>
        </li>
      ))}
    </ul>
  );
}
