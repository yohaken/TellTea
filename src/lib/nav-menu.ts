import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { PermissionKey } from "./permissions";

/** แท็บล่างหลัก — คีย์คงที่สำหรับจัดลำดับ */
export const NAV_TAB_KEYS = [
  "ledger",
  "production",
  "otBonus",
  "bonus",
  "checklist",
  "stock",
  "more",
] as const;

export type NavTabKey = (typeof NAV_TAB_KEYS)[number];

export const NAV_TAB_LABELS: Record<NavTabKey, string> = {
  ledger: "บัญชี",
  production: "ผลิต",
  otBonus: "ชง",
  bonus: "โบนัส",
  checklist: "เช็ค",
  stock: "คลัง",
  more: "อื่นๆ",
};

/** สิทธิ์ที่ใช้แสดงแท็บ (more = hasAnyExtraPermission ใน AppShell) */
export const NAV_TAB_PERMISSION: Record<NavTabKey, PermissionKey | "more"> = {
  ledger: "ledger",
  production: "production",
  otBonus: "otBonus",
  bonus: "bonus",
  checklist: "checklist",
  stock: "stock",
  more: "more",
};

export const DEFAULT_NAV_ORDER: NavTabKey[] = [...NAV_TAB_KEYS];

function uiRef() {
  return doc(getDb(), "meta", "ui");
}

export function normalizeNavOrder(input?: string[] | null): NavTabKey[] {
  const valid = new Set<string>(NAV_TAB_KEYS);
  const out: NavTabKey[] = [];
  for (const raw of input || []) {
    if (valid.has(raw) && !out.includes(raw as NavTabKey)) {
      out.push(raw as NavTabKey);
    }
  }
  for (const key of NAV_TAB_KEYS) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function sortByNavOrder<T extends { key: NavTabKey }>(
  items: T[],
  order: NavTabKey[],
): T[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items].sort(
    (a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999),
  );
}

export function moveNavOrderItem(order: NavTabKey[], key: NavTabKey, dir: -1 | 1): NavTabKey[] {
  const idx = order.indexOf(key);
  if (idx < 0) return order;
  const next = idx + dir;
  if (next < 0 || next >= order.length) return order;
  const copy = [...order];
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  return copy;
}

export async function getNavOrder(): Promise<NavTabKey[]> {
  const snap = await getDoc(uiRef());
  if (!snap.exists()) return [...DEFAULT_NAV_ORDER];
  const data = snap.data() as { navOrder?: string[] };
  return normalizeNavOrder(data.navOrder);
}

export async function saveNavOrder(order: NavTabKey[], updatedBy: string): Promise<void> {
  await setDoc(
    uiRef(),
    {
      navOrder: normalizeNavOrder(order),
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export function subscribeNavOrder(
  onOrder: (order: NavTabKey[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => {
      if (!snap.exists()) {
        onOrder([...DEFAULT_NAV_ORDER]);
        return;
      }
      const data = snap.data() as { navOrder?: string[] };
      onOrder(normalizeNavOrder(data.navOrder));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}
