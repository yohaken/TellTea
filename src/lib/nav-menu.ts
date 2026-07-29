import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { can, hasAnyExtraPermission, type PermissionKey } from "./permissions";
import type { StaffMember } from "./types";

/** ขอบเขตจำนวนปุ่มโมดูลบนแถบล่าง (ไม่รวม อื่นๆ) — ปรับได้ใน Settings */
export const DOCK_TAB_MIN = 3;
export const DOCK_TAB_MAX_LIMIT = 8;
export const DEFAULT_DOCK_TAB_MAX = 5;

/** @deprecated use DEFAULT_DOCK_TAB_MAX or ui.dockTabMax */
export const DOCK_TAB_MAX = DEFAULT_DOCK_TAB_MAX;

/** โมดูลที่จัดได้ทั้งแถบล่างและหน้า อื่นๆ */
export const NAV_MODULE_KEYS = [
  "ledger",
  "production",
  "otBonus",
  "bonus",
  "checklist",
  "stock",
  "assignTasks",
] as const;

export type NavModuleKey = (typeof NAV_MODULE_KEYS)[number];

export const NAV_TAB_KEYS = [...NAV_MODULE_KEYS, "more"] as const;

export type NavTabKey = (typeof NAV_TAB_KEYS)[number];

export const NAV_TAB_LABELS: Record<NavTabKey, string> = {
  ledger: "บัญชี",
  production: "ผลิต",
  otBonus: "ชง",
  bonus: "โบนัส",
  checklist: "เช็ค",
  stock: "คลัง",
  assignTasks: "งาน",
  more: "อื่นๆ",
};

export const NAV_MODULE_HREFS: Record<NavModuleKey, string> = {
  ledger: "/ledger/",
  production: "/production/",
  otBonus: "/ot/",
  bonus: "/bonus/",
  checklist: "/check/",
  stock: "/stock/",
  assignTasks: "/tasks/",
};

const NAV_MODULE_PERMS: Record<NavModuleKey, PermissionKey | "signedIn"> = {
  ledger: "ledger",
  production: "production",
  otBonus: "otBonus",
  bonus: "bonus",
  checklist: "checklist",
  stock: "stock",
  assignTasks: "signedIn",
};

export const NAV_MODULE_DESCRIPTIONS: Record<NavModuleKey, string> = {
  ledger: "บัญชีเข้า–ออกรายวัน",
  production: "บันทึกผลิต / โบนัสเบเกอรี่",
  otBonus: "โบนัสชง / OT",
  bonus: "สรุปโบนัสเดือน",
  checklist: "SmartCheck SOP",
  stock: "คลังวัตถุดิบ",
  assignTasks: "งานมอบหมายประจำสัปดาห์",
};

/** ค่าเริ่มต้น — 5 โมดูลหลักบนแถบล่าง โบนัสไปหน้า อื่นๆ */
export const DEFAULT_DOCK_TAB_KEYS: NavModuleKey[] = [
  "ledger",
  "production",
  "otBonus",
  "checklist",
  "stock",
];

export const DEFAULT_NAV_ORDER: NavTabKey[] = [...NAV_TAB_KEYS];

export type NavUiSettings = {
  navOrder: NavTabKey[];
  dockTabKeys: NavModuleKey[];
  /** จำนวนโมดูลสูงสุดบนแถบล่าง (ไม่รวม อื่นๆ) */
  dockTabMax: number;
};

function uiRef() {
  return doc(getDb(), "meta", "ui");
}

export function canAccessNavModule(
  member: StaffMember | null | undefined,
  key: NavModuleKey,
): boolean {
  const perm = NAV_MODULE_PERMS[key];
  if (perm === "signedIn") return !!member;
  return can(member, perm);
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

export function normalizeDockTabMax(input?: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return DEFAULT_DOCK_TAB_MAX;
  return Math.min(DOCK_TAB_MAX_LIMIT, Math.max(DOCK_TAB_MIN, Math.round(n)));
}

export function normalizeDockTabKeys(
  input?: string[] | null,
  order: NavTabKey[] = DEFAULT_NAV_ORDER,
  dockTabMax: number = DEFAULT_DOCK_TAB_MAX,
): NavModuleKey[] {
  const max = normalizeDockTabMax(dockTabMax);
  const valid = new Set<string>(NAV_MODULE_KEYS);
  const out: NavModuleKey[] = [];
  for (const raw of input || []) {
    if (valid.has(raw) && !out.includes(raw as NavModuleKey)) {
      out.push(raw as NavModuleKey);
    }
    if (out.length >= max) break;
  }
  if (out.length > 0) return out;

  for (const key of order) {
    if (key === "more") continue;
    if (valid.has(key) && !out.includes(key as NavModuleKey)) {
      out.push(key as NavModuleKey);
    }
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : [...DEFAULT_DOCK_TAB_KEYS].slice(0, max);
}

export function normalizeNavUi(data?: Record<string, unknown> | null): NavUiSettings {
  const navOrder = normalizeNavOrder(data?.navOrder as string[] | undefined);
  const dockTabMax = normalizeDockTabMax(data?.dockTabMax);
  return {
    navOrder,
    dockTabMax,
    dockTabKeys: normalizeDockTabKeys(
      data?.dockTabKeys as string[] | undefined,
      navOrder,
      dockTabMax,
    ),
  };
}

export function sortByNavOrder<T extends { key: NavTabKey | NavModuleKey }>(
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

export function moveDockTabKey(keys: NavModuleKey[], key: NavModuleKey, dir: -1 | 1): NavModuleKey[] {
  const idx = keys.indexOf(key);
  if (idx < 0) return keys;
  const next = idx + dir;
  if (next < 0 || next >= keys.length) return keys;
  const copy = [...keys];
  [copy[idx], copy[next]] = [copy[next], copy[idx]];
  return copy;
}

export function toggleDockTabKey(
  keys: NavModuleKey[],
  key: NavModuleKey,
  on: boolean,
  dockTabMax: number = DEFAULT_DOCK_TAB_MAX,
): NavModuleKey[] {
  const max = normalizeDockTabMax(dockTabMax);
  if (on) {
    if (keys.includes(key) || keys.length >= max) return keys;
    return [...keys, key];
  }
  return keys.filter((k) => k !== key);
}

export type ResolvedNavModule = {
  key: NavModuleKey;
  href: string;
  label: string;
  description: string;
};

export function resolveNavForUser(
  staff: StaffMember | null | undefined,
  ui: NavUiSettings,
): {
  dockModules: ResolvedNavModule[];
  moreModules: ResolvedNavModule[];
  showMoreTab: boolean;
} {
  const dockSet = new Set(ui.dockTabKeys);
  const permitted = NAV_MODULE_KEYS.filter((key) => canAccessNavModule(staff, key));

  const toModule = (key: NavModuleKey): ResolvedNavModule => ({
    key,
    href: NAV_MODULE_HREFS[key],
    label: NAV_TAB_LABELS[key],
    description: NAV_MODULE_DESCRIPTIONS[key],
  });

  const dockModules = sortByNavOrder(
    permitted.filter((key) => dockSet.has(key)).map(toModule),
    ui.navOrder,
  );
  const moreModules = sortByNavOrder(
    permitted.filter((key) => !dockSet.has(key)).map(toModule),
    ui.navOrder,
  );

  const showMoreTab =
    moreModules.length > 0 ||
    hasAnyExtraPermission(staff) ||
    staff?.role === "owner";

  return { dockModules, moreModules, showMoreTab };
}

export async function getNavUi(): Promise<NavUiSettings> {
  const snap = await getDoc(uiRef());
  if (!snap.exists()) {
    return {
      navOrder: [...DEFAULT_NAV_ORDER],
      dockTabKeys: [...DEFAULT_DOCK_TAB_KEYS],
      dockTabMax: DEFAULT_DOCK_TAB_MAX,
    };
  }
  return normalizeNavUi(snap.data());
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

export async function saveDockTabKeys(keys: NavModuleKey[], updatedBy: string): Promise<void> {
  const snap = await getDoc(uiRef());
  const ui = normalizeNavUi(snap.data());
  await setDoc(
    uiRef(),
    {
      dockTabKeys: normalizeDockTabKeys(keys, ui.navOrder, ui.dockTabMax),
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export async function saveNavUi(
  partial: Partial<Pick<NavUiSettings, "navOrder" | "dockTabKeys" | "dockTabMax">>,
  updatedBy: string,
): Promise<void> {
  const current = await getNavUi();
  const navOrder = partial.navOrder ? normalizeNavOrder(partial.navOrder) : current.navOrder;
  const dockTabMax = partial.dockTabMax != null ? normalizeDockTabMax(partial.dockTabMax) : current.dockTabMax;
  const dockTabKeys = partial.dockTabKeys
    ? normalizeDockTabKeys(partial.dockTabKeys, navOrder, dockTabMax)
    : normalizeDockTabKeys(current.dockTabKeys, navOrder, dockTabMax);

  await setDoc(
    uiRef(),
    {
      navOrder,
      dockTabMax,
      dockTabKeys,
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
  return subscribeNavUi((ui) => onOrder(ui.navOrder), onError);
}

export function subscribeNavUi(
  onUi: (ui: NavUiSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    uiRef(),
    (snap) => {
      onUi(snap.exists() ? normalizeNavUi(snap.data()) : normalizeNavUi(null));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** @deprecated use NAV_MODULE_PERMS via canAccessNavModule */
export const NAV_TAB_PERMISSION = {
  ledger: "ledger",
  production: "production",
  otBonus: "otBonus",
  bonus: "bonus",
  checklist: "checklist",
  stock: "stock",
  more: "more",
} as const;
