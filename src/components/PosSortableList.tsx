"use client";

import { useState, type ReactNode } from "react";
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

  function handleDrop(targetId: string) {
    if (!dragId) return;
    const next = reorderById(ids, dragId, targetId);
    setDragId(null);
    setOverId(null);
    if (next !== ids) onReorder(next);
  }

  return (
    <ul className={className}>
      {ids.map((id, index) => (
        <li
          key={id}
          className={`pos-sortable-row ${overId === id ? "pos-sortable-row--over" : ""} ${dragId === id ? "pos-sortable-row--drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverId(id);
          }}
          onDragLeave={() => setOverId((cur) => (cur === id ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(id);
          }}
        >
          <span
            className="pos-sortable-handle"
            draggable
            onDragStart={() => setDragId(id)}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            aria-label="ลากเรียงลำดับ"
            title="ลากเรียงลำดับ"
          >
            <GripVertical size={16} aria-hidden />
          </span>
          <div className="pos-sortable-body">{renderItem(id, index)}</div>
        </li>
      ))}
    </ul>
  );
}
