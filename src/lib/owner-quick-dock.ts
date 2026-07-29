/**
 * แถบทางลัดเจ้าของ — ลอยเหนือเมนูล่างทุกหน้า
 * แยกจากแถบเมนูพนักงาน (nav-menu dockTabKeys)
 */

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export const OWNER_QUICK_MAX = 6;

/** คีย์ทางลัดเจ้าของ (หน้าที่ใช้บ่อย มักอยู่ใต้ อื่นๆ) */
export const OWNER_QUICK_KEYS = [
  "ownerBooks",
  "vatSales",
  "pnl",
  "staff",
  "menu",
  "posSales",
  "settings",
  "export",
  "ledger",
] as const;

export type OwnerQuickKey = (typeof OWNER_QUICK_KEYS)[number];

export type OwnerQuickItem = {
  key: OwnerQuickKey;
  /** ตัวย่อสั้นบนไอคอน */
  abbr: string;
  label: string;
  href: string;
};

export const OWNER_QUICK_CATALOG: Record<OwnerQuickKey, OwnerQuickItem> = {
  ownerBooks: {
    key: "ownerBooks",
    abbr: "เจ",
    label: "บช.เจ้าของ",
    href: "/owner-books/",
  },
  vatSales: {
    key: "vatSales",
    abbr: "VAT",
    label: "VAT เดือน",
    href: "/vat-sales/",
  },
  pnl: {
    key: "pnl",
    abbr: "กำไร",
    label: "กำไรเดือน",
    href: "/pnl/",
  },
  staff: {
    key: "staff",
    abbr: "พนง",
    label: "พนักงาน",
    href: "/staff/",
  },
  menu: {
    key: "menu",
    abbr: "เมนู",
    label: "เมนูอาหาร",
    href: "/menu/",
  },
  posSales: {
    key: "posSales",
    abbr: "ขาย",
    label: "ยอดขาย POS",
    href: "/pos-sales/",
  },
  settings: {
    key: "settings",
    abbr: "ตั้ง",
    label: "ตั้งค่า",
    href: "/settings/",
  },
  export: {
    key: "export",
    abbr: "ส่ง",
    label: "ส่งออก",
    href: "/export/",
  },
  ledger: {
    key: "ledger",
    abbr: "บัญชี",
    label: "บัญชีพนักงาน",
    href: "/ledger/",
  },
};

/** ค่าเริ่มต้น — ทางลัดที่เจ้าของใช้บ่อย (ไม่ซ้ำแถบล่าง) */
export const DEFAULT_OWNER_QUICK_KEYS: OwnerQuickKey[] = [
  "ownerBooks",
  "vatSales",
  "pnl",
  "staff",
];

const KEY_SET = new Set<string>(OWNER_QUICK_KEYS);

function uiRef() {
  return doc(getDb(), "meta", "ui");
}

export function normalizeOwnerQuickKeys(
  input?: string[] | null,
): OwnerQuickKey[] {
  const out: OwnerQuickKey[] = [];
  for (const raw of input || []) {
    if (KEY_SET.has(raw) && !out.includes(raw as OwnerQuickKey)) {
      out.push(raw as OwnerQuickKey);
    }
    if (out.length >= OWNER_QUICK_MAX) break;
  }
  return out.length ? out : [...DEFAULT_OWNER_QUICK_KEYS];
}

export function resolveOwnerQuickItems(keys: OwnerQuickKey[]): OwnerQuickItem[] {
  return normalizeOwnerQuickKeys(keys).map((k) => OWNER_QUICK_CATALOG[k]);
}

export function moveOwnerQuickKey(
  keys: OwnerQuickKey[],
  key: OwnerQuickKey,
  dir: -1 | 1,
): OwnerQuickKey[] {
  const list = normalizeOwnerQuickKeys(keys);
  const idx = list.indexOf(key);
  if (idx < 0) return list;
  const next = idx + dir;
  if (next < 0 || next >= list.length) return list;
  const copy = [...list];
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  return copy;
}

export function toggleOwnerQuickKey(
  keys: OwnerQuickKey[],
  key: OwnerQuickKey,
  on: boolean,
): OwnerQuickKey[] {
  const list = normalizeOwnerQuickKeys(keys);
  if (on) {
    if (list.includes(key) || list.length >= OWNER_QUICK_MAX) return list;
    return [...list, key];
  }
  const next = list.filter((k) => k !== key);
  return next.length ? next : list;
}

export async function getOwnerQuickKeys(): Promise<OwnerQuickKey[]> {
  const snap = await getDoc(uiRef());
  if (!snap.exists()) return [...DEFAULT_OWNER_QUICK_KEYS];
  return normalizeOwnerQuickKeys(
    (snap.data() as { ownerQuickKeys?: string[] }).ownerQuickKeys,
  );
}

export async function saveOwnerQuickKeys(
  keys: OwnerQuickKey[],
  updatedBy: string,
): Promise<void> {
  await setDoc(
    uiRef(),
    {
      ownerQuickKeys: normalizeOwnerQuickKeys(keys),
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export function subscribeOwnerQuickKeys(
  onKeys: (keys: OwnerQuickKey[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => {
      if (!snap.exists()) {
        onKeys([...DEFAULT_OWNER_QUICK_KEYS]);
        return;
      }
      onKeys(
        normalizeOwnerQuickKeys(
          (snap.data() as { ownerQuickKeys?: string[] }).ownerQuickKeys,
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}
