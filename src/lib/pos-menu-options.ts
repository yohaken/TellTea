import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getMenuDb, menuErrorHint, type MenuPriceChannel } from "./pos-menu-db";
import { mapFirestoreError } from "./firestore-errors";
import type { MenuOptionChoice, MenuOptionGroup, MenuOptionSelectionType } from "./types";

export const MENU_OPTION_GROUPS_COL = "menuOptionGroups";

function groupsCol() {
  return collection(getMenuDb(), MENU_OPTION_GROUPS_COL);
}

function newChoiceId() {
  return `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** ราคาเพิ่มตัวเลือกตามช่องทาง — ไม่มี deliveryPriceDelta → ใช้ priceDelta */
export function resolveOptionPriceDelta(
  choice: Pick<MenuOptionChoice, "priceDelta" | "deliveryPriceDelta">,
  channel: MenuPriceChannel = "store",
): number {
  if (channel === "delivery" && typeof choice.deliveryPriceDelta === "number") {
    return Math.max(0, choice.deliveryPriceDelta);
  }
  return Math.max(0, choice.priceDelta);
}

function mapChoice(raw: unknown): MenuOptionChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    priceDelta: typeof o.priceDelta === "number" ? o.priceDelta : 0,
    ...(typeof o.deliveryPriceDelta === "number"
      ? { deliveryPriceDelta: o.deliveryPriceDelta }
      : {}),
    ...(typeof o.priceDeltaMax === "number" ? { priceDeltaMax: o.priceDeltaMax } : {}),
    sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : 0,
    active: o.active !== false,
  };
}

function mapGroup(id: string, data: Record<string, unknown>): MenuOptionGroup {
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options = rawOptions
    .map(mapChoice)
    .filter((c): c is MenuOptionChoice => c != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    required: data.required === true,
    selectionType:
      data.selectionType === "multi" || data.selectionType === "unlimited"
        ? data.selectionType
        : "single",
    minSelect: typeof data.minSelect === "number" ? data.minSelect : undefined,
    maxSelect: typeof data.maxSelect === "number" ? data.maxSelect : undefined,
    options,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
    active: data.active !== false,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function subscribeMenuOptionGroups(
  onData: (groups: MenuOptionGroup[], fromCache?: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(groupsCol(), orderBy("sortOrder", "asc"));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      onData(
        snap.docs.map((d) => mapGroup(d.id, d.data() as Record<string, unknown>)),
        snap.metadata.fromCache,
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function listMenuOptionGroups(): Promise<MenuOptionGroup[]> {
  const snap = await getDocs(query(groupsCol(), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => mapGroup(d.id, d.data() as Record<string, unknown>));
}

export async function addMenuOptionGroup(name: string): Promise<string> {
  const now = Date.now();
  try {
    const ref = await addDoc(groupsCol(), {
      name: name.trim(),
      required: false,
      selectionType: "single",
      options: [
        {
          id: newChoiceId(),
          name: "ไม่รับ",
          priceDelta: 0,
          sortOrder: 0,
          active: true,
        },
      ],
      sortOrder: now,
      active: true,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เพิ่มกลุ่มตัวเลือก", menuErrorHint()));
  }
}

export async function updateMenuOptionGroup(
  id: string,
  patch: Partial<
    Pick<
      MenuOptionGroup,
      | "name"
      | "required"
      | "selectionType"
      | "minSelect"
      | "maxSelect"
      | "options"
      | "sortOrder"
      | "active"
    >
  >,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.required != null) next.required = patch.required;
  if (patch.selectionType != null) next.selectionType = patch.selectionType;
  if (patch.minSelect != null) next.minSelect = patch.minSelect;
  if (patch.maxSelect != null) next.maxSelect = patch.maxSelect;
  if (patch.options != null) {
    next.options = patch.options.map((o) => serializeMenuOptionChoice(o));
  }
  if (patch.sortOrder != null) next.sortOrder = patch.sortOrder;
  if (patch.active != null) next.active = patch.active;
  try {
    await updateDoc(doc(getMenuDb(), MENU_OPTION_GROUPS_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตกลุ่มตัวเลือก", menuErrorHint()));
  }
}

export async function deleteMenuOptionGroup(id: string): Promise<void> {
  try {
    await deleteDoc(doc(getMenuDb(), MENU_OPTION_GROUPS_COL, id));
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลบกลุ่มตัวเลือก", menuErrorHint()));
  }
}

export function serializeMenuOptionChoice(o: MenuOptionChoice): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: o.id,
    name: o.name.trim(),
    priceDelta: Math.max(0, Number(o.priceDelta) || 0),
    sortOrder: o.sortOrder,
    active: o.active !== false,
  };
  if (typeof o.deliveryPriceDelta === "number") {
    row.deliveryPriceDelta = Math.max(0, o.deliveryPriceDelta);
  }
  if (typeof o.priceDeltaMax === "number") row.priceDeltaMax = o.priceDeltaMax;
  return row;
}

export function createMenuOptionChoice(
  name: string,
  priceDelta = 0,
  deliveryPriceDelta?: number,
): MenuOptionChoice {
  return {
    id: newChoiceId(),
    name: name.trim(),
    priceDelta: Math.max(0, priceDelta),
    ...(typeof deliveryPriceDelta === "number"
      ? { deliveryPriceDelta: Math.max(0, deliveryPriceDelta) }
      : {}),
    sortOrder: Date.now(),
    active: true,
  };
}

export async function reorderMenuOptionGroups(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, index) => updateMenuOptionGroup(id, { sortOrder: (index + 1) * 1000 })),
  );
}

export type MenuOptionGroupInput = {
  name: string;
  required: boolean;
  selectionType: MenuOptionSelectionType;
  minSelect?: number;
  maxSelect?: number;
  options: MenuOptionChoice[];
};

export async function saveMenuOptionGroupFull(id: string, input: MenuOptionGroupInput): Promise<void> {
  const options = input.options
    .filter((o) => o.name.trim())
    .map((o, i) =>
      serializeMenuOptionChoice({
        ...o,
        name: o.name.trim(),
        priceDelta: Math.max(0, Number(o.priceDelta) || 0),
        sortOrder: (i + 1) * 100,
        active: o.active !== false,
      }),
    );

  const next: Record<string, unknown> = {
    updatedAt: Date.now(),
    name: input.name.trim(),
    required: input.required,
    selectionType: input.selectionType,
    options,
  };

  if (input.selectionType === "multi") {
    next.minSelect = input.minSelect ?? 1;
    next.maxSelect = input.maxSelect ?? options.length;
  } else {
    next.minSelect = deleteField();
    next.maxSelect = input.selectionType === "single" ? 1 : deleteField();
  }

  try {
    await updateDoc(doc(getMenuDb(), MENU_OPTION_GROUPS_COL, id), next);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "อัปเดตกลุ่มตัวเลือก", menuErrorHint()));
  }
}
