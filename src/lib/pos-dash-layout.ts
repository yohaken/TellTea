import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/**
 * ลำดับกล่องแดชบอร์ด POS (`/pos-sales`) — เก็บใน `meta/ui.posDashCardOrder` (ร่วมทุกเครื่อง)
 * `half` = ครึ่งแถวบนจอกว้าง ≥900px; ถ้าเพื่อนบ้านไม่ใช่ half จะขยายเต็มแถวเอง
 */
export const POS_DASH_CARDS = [
  { id: "daily", label: "ยอดขายรายวัน + กราฟ", size: "full" },
  { id: "ops", label: "ความสัมพันธ์ หน้าร้าน × ชง × ผลิต", size: "full" },
  { id: "net", label: "ยอดรับเงินจริง", size: "half" },
  { id: "bills", label: "บิลที่ปิดไปแล้ว", size: "half" },
  { id: "hour", label: "ยอดขายแยกตามช่วงเวลา (กราฟ)", size: "half" },
  { id: "weekday", label: "ยอดขายตามวันในสัปดาห์", size: "half" },
  { id: "timeTotals", label: "ยอดขายรวมตามช่วงเวลา", size: "full" },
  { id: "productHours", label: "ขายช่วงไหน · สินค้า × ชั่วโมง", size: "full" },
  { id: "products", label: "สินค้า", size: "half" },
  { id: "options", label: "ตัวเลือกยอดนิยม", size: "half" },
  { id: "stock", label: "สินค้าคงคลัง", size: "half" },
  { id: "discount", label: "ส่วนลด / แลกแต้ม", size: "half" },
  { id: "stats", label: "สถิติบิล", size: "half" },
  { id: "activity", label: "กิจกรรม", size: "half" },
  { id: "members", label: "สมาชิก", size: "full" },
  { id: "void", label: "บิลที่ยกเลิก", size: "full" },
] as const;

export type PosDashCardId = (typeof POS_DASH_CARDS)[number]["id"];

export const POS_DASH_DEFAULT_ORDER: PosDashCardId[] = POS_DASH_CARDS.map((c) => c.id);

const CARD_BY_ID = new Map<string, (typeof POS_DASH_CARDS)[number]>(
  POS_DASH_CARDS.map((c) => [c.id, c]),
);

export function posDashCardLabel(id: PosDashCardId): string {
  return CARD_BY_ID.get(id)?.label ?? id;
}

/** ตัดซ้ำ/ไม่รู้จัก · กล่องใหม่ที่ยังไม่อยู่ในลำดับที่บันทึก แทรกตามตำแหน่งค่าเริ่มต้น */
export function normalizePosDashOrder(input?: unknown): PosDashCardId[] {
  const out: PosDashCardId[] = [];
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw === "string" && CARD_BY_ID.has(raw) && !out.includes(raw as PosDashCardId)) {
        out.push(raw as PosDashCardId);
      }
    }
  }
  if (!out.length) return [...POS_DASH_DEFAULT_ORDER];
  POS_DASH_DEFAULT_ORDER.forEach((id, defIdx) => {
    if (out.includes(id)) return;
    const prev = POS_DASH_DEFAULT_ORDER.slice(0, defIdx).reverse().find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
  });
  return out;
}

export function movePosDashCard(
  order: PosDashCardId[],
  from: number,
  to: number,
): PosDashCardId[] {
  const list = [...order];
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const [item] = list.splice(from, 1);
  list.splice(target, 0, item!);
  return list;
}

export function samePosDashOrder(a: PosDashCardId[], b: PosDashCardId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** span 2 = เต็มแถว · half ที่อยู่ติดกันเป็นคู่ได้ span 1 ทั้งคู่ */
export function layoutPosDashCards(
  order: PosDashCardId[],
): { id: PosDashCardId; span: 1 | 2 }[] {
  const out: { id: PosDashCardId; span: 1 | 2 }[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const next = order[i + 1];
    if (CARD_BY_ID.get(id)?.size === "half" && next && CARD_BY_ID.get(next)?.size === "half") {
      out.push({ id, span: 1 }, { id: next, span: 1 });
      i++;
    } else {
      out.push({ id, span: 2 });
    }
  }
  return out;
}

function uiRef() {
  return doc(getDb(), "meta", "ui");
}

export function subscribePosDashOrder(
  onOrder: (order: PosDashCardId[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => onOrder(normalizePosDashOrder(snap.exists() ? snap.data()?.posDashCardOrder : null)),
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function savePosDashOrder(order: PosDashCardId[], updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(),
    {
      posDashCardOrder: normalizePosDashOrder(order),
      posDashCardOrderUpdatedAt: Date.now(),
      posDashCardOrderUpdatedBy: updatedBy,
    },
    { merge: true },
  );
}
