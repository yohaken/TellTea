/**
 * แถบทางลัดเจ้าของ — ลอยเหนือเมนูล่างทุกหน้า
 * แยกจากแถบเมนูพนักงาน (nav-menu dockTabKeys)
 * ตั้งค่าได้ที่ อื่นๆ → ตั้งค่าโมดูล → ไอคอนลอย
 */

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

/** จำนวนชิปสูงสุดบนแถบลอย */
export const OWNER_QUICK_MAX = 10;

/** ความยาวชื่อย่อสูงสุดบนชิป */
export const OWNER_QUICK_ABBR_MAX = 4;

/**
 * ทุกหมวดที่เลือกใส่ไอคอนลอยได้
 * (โมดูลแถบล่าง + เครื่องมือใต้ อื่นๆ + ทางลัดเจ้าของ)
 */
export const OWNER_QUICK_KEYS = [
  "ownerBooks",
  "vatSales",
  "capital",
  "pnl",
  "ledger",
  "production",
  "otBonus",
  "bonus",
  "checklist",
  "stock",
  "assignTasks",
  "staff",
  "menu",
  "posSales",
  "businessNotes",
  "utility",
  "export",
  "settings",
  "profile",
  "more",
] as const;

export type OwnerQuickKey = (typeof OWNER_QUICK_KEYS)[number];

export type OwnerQuickItem = {
  key: OwnerQuickKey;
  /** ตัวย่อสั้นบนไอคอน (ค่าเริ่มจากแคตตาล็อก หรือที่เจ้าของตั้ง) */
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
  capital: {
    key: "capital",
    abbr: "ทุน",
    label: "บช ทุน",
    href: "/capital/",
  },
  pnl: {
    key: "pnl",
    abbr: "กำไร",
    label: "สรุปรายเดือน",
    href: "/pnl/",
  },
  ledger: {
    key: "ledger",
    abbr: "บัญชี",
    label: "บัญชีพนักงาน",
    href: "/ledger/",
  },
  production: {
    key: "production",
    abbr: "ผลิต",
    label: "ผลิต",
    href: "/production/",
  },
  otBonus: {
    key: "otBonus",
    abbr: "ชง",
    label: "โบนัสชง / OT",
    href: "/ot/",
  },
  bonus: {
    key: "bonus",
    abbr: "จ่าย",
    label: "จ่ายเงิน / โบนัส",
    href: "/bonus/",
  },
  checklist: {
    key: "checklist",
    abbr: "เช็ค",
    label: "SmartCheck",
    href: "/check/",
  },
  stock: {
    key: "stock",
    abbr: "คลัง",
    label: "คลังวัตถุดิบ",
    href: "/stock/",
  },
  assignTasks: {
    key: "assignTasks",
    abbr: "งาน",
    label: "งานมอบหมาย",
    href: "/tasks/",
  },
  staff: {
    key: "staff",
    abbr: "พนง",
    label: "ศูนย์รวมพนักงาน",
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
  businessNotes: {
    key: "businessNotes",
    abbr: "โนต",
    label: "โนตกิจการ",
    href: "/business-notes/",
  },
  utility: {
    key: "utility",
    abbr: "ยูท",
    label: "ยูทิลิตี้",
    href: "/utility/",
  },
  export: {
    key: "export",
    abbr: "ส่ง",
    label: "ส่งออก",
    href: "/export/",
  },
  settings: {
    key: "settings",
    abbr: "ตั้ง",
    label: "ตั้งค่าโมดูล",
    href: "/settings/",
  },
  profile: {
    key: "profile",
    abbr: "โปร",
    label: "โปรไฟล์",
    href: "/profile/",
  },
  more: {
    key: "more",
    abbr: "อื่น",
    label: "อื่นๆ",
    href: "/more/",
  },
};

/** ค่าเริ่มต้น — ทางลัดที่เจ้าของใช้บ่อย */
export const DEFAULT_OWNER_QUICK_KEYS: OwnerQuickKey[] = [
  "ownerBooks",
  "vatSales",
  "pnl",
  "staff",
];

export type OwnerQuickAbbrs = Partial<Record<OwnerQuickKey, string>>;

export type OwnerQuickSettings = {
  keys: OwnerQuickKey[];
  abbrs: OwnerQuickAbbrs;
};

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

/** ตัด/จำกัดชื่อย่อ — ว่าง = ใช้ค่าเริ่มจากแคตตาล็อก */
export function normalizeOwnerQuickAbbr(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/\s+/g, "")
    .trim();
  if (!text) return "";
  return [...text].slice(0, OWNER_QUICK_ABBR_MAX).join("");
}

export function normalizeOwnerQuickAbbrs(
  input?: Record<string, unknown> | null,
): OwnerQuickAbbrs {
  const out: OwnerQuickAbbrs = {};
  if (!input || typeof input !== "object") return out;
  for (const key of OWNER_QUICK_KEYS) {
    if (!(key in input)) continue;
    const abbr = normalizeOwnerQuickAbbr(input[key]);
    if (!abbr) continue;
    const def = OWNER_QUICK_CATALOG[key].abbr;
    if (abbr === def) continue;
    out[key] = abbr;
  }
  return out;
}

export function abbrForOwnerQuickKey(
  key: OwnerQuickKey,
  abbrs?: OwnerQuickAbbrs | null,
): string {
  const custom = abbrs?.[key];
  if (custom && custom.trim()) return normalizeOwnerQuickAbbr(custom) || OWNER_QUICK_CATALOG[key].abbr;
  return OWNER_QUICK_CATALOG[key].abbr;
}

export function resolveOwnerQuickItems(
  keys: OwnerQuickKey[],
  abbrs?: OwnerQuickAbbrs | null,
): OwnerQuickItem[] {
  return normalizeOwnerQuickKeys(keys).map((k) => ({
    ...OWNER_QUICK_CATALOG[k],
    abbr: abbrForOwnerQuickKey(k, abbrs),
  }));
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

/** รายการในตั้งค่า: ชิปที่เปิดเรียงตามลำดับจริง แล้วตามด้วยที่ยังไม่เลือก */
export function setupOwnerQuickListOrder(keys: OwnerQuickKey[]): OwnerQuickKey[] {
  const active = normalizeOwnerQuickKeys(keys);
  const on = new Set(active);
  const rest = OWNER_QUICK_KEYS.filter((k) => !on.has(k));
  return [...active, ...rest];
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

export function setOwnerQuickAbbr(
  abbrs: OwnerQuickAbbrs,
  key: OwnerQuickKey,
  raw: string,
): OwnerQuickAbbrs {
  const next = { ...abbrs };
  const abbr = normalizeOwnerQuickAbbr(raw);
  const def = OWNER_QUICK_CATALOG[key].abbr;
  if (!abbr || abbr === def) {
    delete next[key];
  } else {
    next[key] = abbr;
  }
  return next;
}

export function normalizeOwnerQuickSettings(
  data?: { ownerQuickKeys?: string[]; ownerQuickAbbrs?: Record<string, unknown> } | null,
): OwnerQuickSettings {
  return {
    keys: normalizeOwnerQuickKeys(data?.ownerQuickKeys),
    abbrs: normalizeOwnerQuickAbbrs(data?.ownerQuickAbbrs),
  };
}

export async function getOwnerQuickSettings(): Promise<OwnerQuickSettings> {
  const snap = await getDoc(uiRef());
  if (!snap.exists()) {
    return {
      keys: [...DEFAULT_OWNER_QUICK_KEYS],
      abbrs: {},
    };
  }
  return normalizeOwnerQuickSettings(
    snap.data() as {
      ownerQuickKeys?: string[];
      ownerQuickAbbrs?: Record<string, unknown>;
    },
  );
}

/** @deprecated ใช้ getOwnerQuickSettings */
export async function getOwnerQuickKeys(): Promise<OwnerQuickKey[]> {
  return (await getOwnerQuickSettings()).keys;
}

export async function saveOwnerQuickSettings(
  settings: OwnerQuickSettings,
  updatedBy: string,
): Promise<OwnerQuickSettings> {
  const next = {
    keys: normalizeOwnerQuickKeys(settings.keys),
    abbrs: normalizeOwnerQuickAbbrs(settings.abbrs),
  };
  await setDoc(
    uiRef(),
    {
      ownerQuickKeys: next.keys,
      ownerQuickAbbrs: next.abbrs,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
  return next;
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

export function subscribeOwnerQuickSettings(
  onSettings: (settings: OwnerQuickSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => {
      if (!snap.exists()) {
        onSettings({
          keys: [...DEFAULT_OWNER_QUICK_KEYS],
          abbrs: {},
        });
        return;
      }
      onSettings(
        normalizeOwnerQuickSettings(
          snap.data() as {
            ownerQuickKeys?: string[];
            ownerQuickAbbrs?: Record<string, unknown>;
          },
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeOwnerQuickKeys(
  onKeys: (keys: OwnerQuickKey[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeOwnerQuickSettings((s) => onKeys(s.keys), onError);
}
