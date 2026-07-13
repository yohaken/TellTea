/** Reorder array by moving one id before another (drag-drop). */
export function reorderById(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return ids;
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * เรียงหมวดที่โชว์บนหน้าขายใหม่ โดยคงช่องของหมวดที่ซ่อน/ไม่โชว์ไว้ในลิสต์เต็ม
 * (เช่น A, X(ซ่อน), B, C → ลากเป็น C,A,B ได้ C, X, A, B)
 */
export function applyActiveIdsOrder<T extends { id: string; sortOrder: number }>(
  all: T[],
  orderedActiveIds: string[],
): T[] {
  const activeSet = new Set(orderedActiveIds);
  if (!orderedActiveIds.length) {
    return all.map((row, i) => ({ ...row, sortOrder: (i + 1) * 1000 }));
  }

  const byId = new Map(all.map((row) => [row.id, row]));
  const queue = orderedActiveIds.filter((id) => byId.has(id));
  const sorted = [...all].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );

  const sequenced: T[] = [];
  for (const row of sorted) {
    if (activeSet.has(row.id)) {
      const nextId = queue.shift();
      if (nextId) {
        const picked = byId.get(nextId);
        if (picked) sequenced.push(picked);
      }
    } else {
      sequenced.push(row);
    }
  }
  // ids ที่เหลือในคิว (กรณีข้อมูลไม่ครบ)
  for (const id of queue) {
    const row = byId.get(id);
    if (row && !sequenced.some((r) => r.id === id)) sequenced.push(row);
  }

  return sequenced.map((row, i) => ({ ...row, sortOrder: (i + 1) * 1000 }));
}
