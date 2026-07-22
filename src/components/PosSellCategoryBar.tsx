"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { reorderById } from "@/lib/pos-drag-reorder";

const HOLD_MS = 380;
const MOVE_CANCEL_PX = 12;

type Cat = { id: string; name: string };

/**
 * แถบหมวดหน้าขาย — แตะเลือก / กดค้างแล้วลากจัดลำดับ
 */
export function PosSellCategoryBar({
  categories,
  selectedId,
  onSelect,
  onReorder,
}: {
  categories: Cat[];
  selectedId: string;
  onSelect: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
}) {
  const [displayIds, setDisplayIds] = useState(() => categories.map((c) => c.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const displayIdsRef = useRef(displayIds);
  const categoriesRef = useRef(categories);
  const draggingIdRef = useRef<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const movedWhileDragRef = useRef(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  displayIdsRef.current = displayIds;
  categoriesRef.current = categories;
  draggingIdRef.current = draggingId;

  // sync จากภายนอกเมื่อไม่ได้ลาก
  useEffect(() => {
    if (draggingIdRef.current) return;
    const next = categories.map((c) => c.id);
    setDisplayIds((prev) => (prev.join("|") === next.join("|") ? prev : next));
  }, [categories]);

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function catById(id: string) {
    return categoriesRef.current.find((c) => c.id === id);
  }

  function beginDrag(id: string, pointerId: number, target: HTMLElement) {
    clearHoldTimer();
    suppressClickRef.current = true;
    movedWhileDragRef.current = false;
    draggingIdRef.current = id;
    setDraggingId(id);
    pointerIdRef.current = pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    try {
      navigator.vibrate?.(12);
    } catch {
      /* ignore */
    }
  }

  function hoverReorder(clientX: number, clientY: number) {
    const dragId = draggingIdRef.current;
    if (!dragId) return;
    const el = document.elementFromPoint(clientX, clientY);
    const chip = el?.closest?.("[data-pos-cat-id]") as HTMLElement | null;
    const targetId = chip?.dataset.posCatId;
    if (!targetId || targetId === dragId) return;
    const current = displayIdsRef.current;
    const next = reorderById(current, dragId, targetId);
    if (next.join("|") === current.join("|")) return;
    movedWhileDragRef.current = true;
    displayIdsRef.current = next;
    setDisplayIds(next);
  }

  function endDrag() {
    clearHoldTimer();
    const dragId = draggingIdRef.current;
    const ordered = displayIdsRef.current;
    const baseline = categoriesRef.current.map((c) => c.id);
    const changed = movedWhileDragRef.current && ordered.join("|") !== baseline.join("|");

    draggingIdRef.current = null;
    setDraggingId(null);
    pointerIdRef.current = null;
    startPosRef.current = null;

    if (changed && onReorder) onReorder(ordered);

    // ปล่อยคลิกปลอมหลังลาก
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0) return;
    if (!onReorder) return;
    clearHoldTimer();
    suppressClickRef.current = false;
    movedWhileDragRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    const target = e.currentTarget;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      beginDrag(id, e.pointerId, target);
    }, HOLD_MS);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const start = startPosRef.current;
    if (!draggingIdRef.current && start && holdTimerRef.current != null) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
        clearHoldTimer();
      }
      return;
    }
    if (!draggingIdRef.current) return;
    if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) return;
    hoverReorder(e.clientX, e.clientY);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) return;
    if (draggingIdRef.current) {
      endDrag();
      return;
    }
    clearHoldTimer();
  }

  function onPointerCancel() {
    clearHoldTimer();
    if (draggingIdRef.current) {
      // ยกเลิกลาก — กลับลำดับเดิม
      setDisplayIds(categoriesRef.current.map((c) => c.id));
      draggingIdRef.current = null;
      setDraggingId(null);
      movedWhileDragRef.current = false;
    }
    pointerIdRef.current = null;
    startPosRef.current = null;
  }

  function onClick(id: string) {
    if (suppressClickRef.current) return;
    onSelect(id);
  }

  return (
    <div
      ref={barRef}
      className={`pos-sell-cats ${draggingId ? "is-reordering" : ""}`}
      role="tablist"
      aria-label="หมวดเมนู — กดค้างลากเพื่อจัดลำดับ"
    >
      {displayIds.map((id) => {
        const cat = catById(id);
        if (!cat) return null;
        const isDragging = draggingId === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            data-pos-cat-id={id}
            aria-selected={selectedId === id}
            aria-grabbed={isDragging}
            className={`pos-sell-cat ${selectedId === id ? "is-active" : ""} ${isDragging ? "is-dragging" : ""}`}
            onPointerDown={(e) => onPointerDown(e, id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={() => onClick(id)}
          >
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
