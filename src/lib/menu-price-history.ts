import { getAuth } from "firebase/auth";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getMenuDb, getMenuDbMode } from "./pos-menu-db";

/** Written only by Cloud Function triggers (functions/menu-price-history.js) — owner read. */
export const MENU_PRICE_HISTORY_COL = "menuPriceHistory";

const FETCH_LIMIT = 300;

export type MenuPriceChange = "price" | "created" | "deleted" | "added" | "removed";
export type MenuPriceSource = "boh" | "npos" | "script";

export type MenuPriceHistoryRow = {
  id: string;
  kind: "item" | "option";
  itemId?: string;
  groupId?: string;
  choiceId?: string;
  choiceName?: string;
  name: string;
  change: MenuPriceChange;
  from: number | null;
  to: number | null;
  at: number;
  source: MenuPriceSource;
  by: string;
};

/**
 * Stamp on any write that sets store price — trigger trusts it only when
 * priceEditedAt equals the same write's updatedAt.
 */
export function menuPriceEditStamp(updatedAt: number): { priceEditedBy: string; priceEditedAt: number } {
  let who = "";
  try {
    const user = getAuth(getMenuDb().app).currentUser;
    who = user?.email || user?.uid || "";
  } catch {
    who = "";
  }
  const prefix = getMenuDbMode() === "pos" ? "pos" : "boh";
  return { priceEditedBy: `${prefix}:${who}`, priceEditedAt: updatedAt };
}

function asNumOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mapRow(id: string, d: Record<string, unknown>): MenuPriceHistoryRow {
  const change = d.change;
  const source = d.source;
  return {
    id,
    kind: d.kind === "option" ? "option" : "item",
    itemId: typeof d.itemId === "string" ? d.itemId : undefined,
    groupId: typeof d.groupId === "string" ? d.groupId : undefined,
    choiceId: typeof d.choiceId === "string" ? d.choiceId : undefined,
    choiceName: typeof d.choiceName === "string" ? d.choiceName : undefined,
    name: typeof d.name === "string" ? d.name : "",
    change:
      change === "created" || change === "deleted" || change === "added" || change === "removed"
        ? change
        : "price",
    from: asNumOrNull(d.from),
    to: asNumOrNull(d.to),
    at: asNumOrNull(d.at) ?? asNumOrNull(d.eventAt) ?? 0,
    source: source === "boh" || source === "npos" ? source : "script",
    by: typeof d.by === "string" ? d.by : "",
  };
}

/** Oldest first. Sorted client-side so no composite index is needed. */
export async function listItemPriceHistory(itemId: string): Promise<MenuPriceHistoryRow[]> {
  const q = query(
    collection(getMenuDb(), MENU_PRICE_HISTORY_COL),
    where("itemId", "==", itemId),
    limit(FETCH_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => mapRow(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.at - b.at);
}

/** Option-choice price rows for the given groups (Firestore `in` ≤ 30). Oldest first. */
export async function listOptionPriceHistory(groupIds: string[]): Promise<MenuPriceHistoryRow[]> {
  const ids = [...new Set(groupIds.filter(Boolean))].slice(0, 30);
  if (!ids.length) return [];
  const q = query(
    collection(getMenuDb(), MENU_PRICE_HISTORY_COL),
    where("groupId", "in", ids),
    limit(FETCH_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => mapRow(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.at - b.at);
}

export type PriceStep = { at: number; price: number };

/** Price points for the step chart (skips deleted rows). */
export function priceStepsFromRows(rows: MenuPriceHistoryRow[]): PriceStep[] {
  const steps: PriceStep[] = [];
  for (const r of rows) {
    if (r.to == null) continue;
    const last = steps[steps.length - 1];
    if (last && last.price === r.to) continue;
    steps.push({ at: r.at, price: r.to });
  }
  return steps;
}

export function priceSourceLabel(source: MenuPriceSource): string {
  if (source === "npos") return "เครื่อง POS";
  if (source === "boh") return "หลังร้าน";
  return "สคริปต์/อื่นๆ";
}

export function priceChangeLabel(change: MenuPriceChange): string {
  switch (change) {
    case "created":
      return "ตั้งราคาแรก";
    case "added":
      return "เพิ่มตัวเลือก";
    case "removed":
      return "ลบตัวเลือก";
    case "deleted":
      return "ลบเมนู";
    default:
      return "";
  }
}
