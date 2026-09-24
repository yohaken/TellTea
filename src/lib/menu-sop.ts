/**
 * SOP เบเกอรี่ — ขั้นตอน/ปริมาณ (พนักงาน) + ลิงก์จับคู่คลัง (menuSopCosts)
 * ตัวเลขต้นทุน (unitCost) คำนวณฝั่งเจ้าของจาก stockCosts เท่านั้น — ห้ามเก็บในเอกสารที่พนักงานอ่าน
 * กฎ: .cursor/rules/bakery-sop-cost-owner-only.mdc
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { listStockCostMap } from "./stock-costs";
import { createStockItem, findStockByNameOrAlias, listStockItems, updateStockItem } from "./stock";

export const MENU_SOPS_COL = "menuSops";
export const MENU_SOP_COSTS_COL = "menuSopCosts";

export type MenuSopStep = {
  id: string;
  order: number;
  title: string;
  body: string;
  qtyNote?: string;
};

export type MenuSopIngredient = {
  id: string;
  nameFreeText: string;
  qty: number;
  unit: string;
};

/** ลิงก์ส่วนผสม → คลัง หรือเบส (ไม่มีราคา — ราคาอยู่ stockCosts / สูตรเบส) */
export type MenuSopIngredientLink = {
  ingredientId: string;
  /** ว่างได้ถ้าผูกเบสแทน */
  stockItemId: string;
  /** เบสที่ผสมแล้ว ใช้เป็นส่วนผสมของเมนูอื่น */
  baseSopId?: string;
  /** จำนวนใช้ต่อสูตร (หน่วยเดียวกับ stock.unit หรือกรัม) */
  qty: number;
  unit: string;
};

export type MenuSop = {
  id: string;
  name: string;
  /** bakery = seed เก่า · menu = จากเมนูหลังร้าน · base = วัตถุดิบเบส (ผสมก่อนลงเมนู) */
  category: "bakery" | "menu" | "base";
  menuItemId?: string;
  prodProductId?: string;
  /** จำนวนชิ้นที่ได้ต่อสูตร */
  yieldQty: number;
  yieldUnit: string;
  /** น้ำหนักต่อชิ้น (กรัม) — ถ้ามี */
  pieceWeightG?: number;
  /** คำบรรยายเมนู (พนักงานใส่ข้อความอิสระ) */
  description: string;
  /** ส่วนผสมหลัก — ข้อความอิสระก่อนจัดระเบียบ */
  ingredientsText: string;
  /** ขั้นตอนการทำ — ข้อความอิสระ */
  makeStepsText: string;
  /** ขั้นตอนการขาย + วัสดุตอนขาย — ข้อความอิสระ */
  sellStepsText: string;
  /** โครงเก่า (ใช้ตอน AI จัด / ต้นทุน) — อาจว่างตอนใส่ข้อมูลก่อน */
  steps: MenuSopStep[];
  ingredients: MenuSopIngredient[];
  /** ข้ามงานนี้ (ไม่บังคับกรอก) */
  skipped: boolean;
  /** ไฮไลต์/โฟกัสงาน — ค่าเริ่มเปิด · พนักงานเห็นรายการทั้งหมดอยู่แล้ว */
  staffVisible: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type MenuSopCategory = MenuSop["category"];

export type MenuSopDraftChecks = {
  description: boolean;
  ingredients: boolean;
  make: boolean;
  sell: boolean;
  /** เสร็จ = มีส่วนผสม (ต้นทุนทางตรง) — ไม่บังคับบรรยาย/ทำ/ขาย */
  complete: boolean;
  missingLabels: string[];
};

export function normalizeMenuSopCategory(raw: unknown): MenuSopCategory {
  if (raw === "bakery" || raw === "menu" || raw === "base") return raw;
  return "menu";
}

export type MenuSopCostDoc = {
  sopId: string;
  ingredientLinks: MenuSopIngredientLink[];
  updatedAt: number;
  updatedBy: string;
};

export type MenuSopCostLine = {
  ingredientId: string;
  name: string;
  qty: number;
  unit: string;
  stockItemId: string;
  stockName: string;
  unitCost: number;
  lineCost: number;
};

export type MenuSopCostSummary = {
  lines: MenuSopCostLine[];
  batchCost: number;
  perPiece: number;
  yieldQty: number;
  missingLinks: string[];
  missingCosts: string[];
};

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapStep(raw: unknown, index: number): MenuSopStep {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: String(d.id || newId("step")),
    order: Number(d.order) || index + 1,
    title: String(d.title || "").trim(),
    body: String(d.body || "").trim(),
    ...(d.qtyNote ? { qtyNote: String(d.qtyNote).trim() } : {}),
  };
}

function mapIngredient(raw: unknown): MenuSopIngredient {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: String(d.id || newId("ing")),
    nameFreeText: String(d.nameFreeText || d.name || "").trim(),
    qty: Number(d.qty) || 0,
    unit: String(d.unit || "ก.").trim() || "ก.",
  };
}

function mapLink(raw: unknown): MenuSopIngredientLink | null {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ingredientId = String(d.ingredientId || "").trim();
  const stockItemId = String(d.stockItemId || "").trim();
  const baseSopId = String(d.baseSopId || "").trim();
  if (!ingredientId) return null;
  if (!stockItemId && !baseSopId) return null;
  return {
    ingredientId,
    stockItemId,
    baseSopId: baseSopId || undefined,
    qty: Number(d.qty) || 0,
    unit: String(d.unit || "ก.").trim() || "ก.",
  };
}

/** รหัสในแคตตาล็อก AI / select — เบสขึ้นต้นด้วย base: */
export const MENU_SOP_BASE_REF_PREFIX = "base:";

export function encodeMenuSopBaseRef(baseSopId: string): string {
  return `${MENU_SOP_BASE_REF_PREFIX}${String(baseSopId || "").trim()}`;
}

export function parseMenuSopIngredientRef(raw: string): {
  kind: "stock" | "base" | "none";
  id: string;
} {
  const s = String(raw || "").trim();
  if (!s) return { kind: "none", id: "" };
  if (s.startsWith(MENU_SOP_BASE_REF_PREFIX)) {
    return { kind: "base", id: s.slice(MENU_SOP_BASE_REF_PREFIX.length) };
  }
  return { kind: "stock", id: s };
}

export function ingredientLinkHasPair(link: MenuSopIngredientLink | undefined | null): boolean {
  if (!link) return false;
  return !!(link.stockItemId || link.baseSopId);
}

export function mapMenuSop(id: string, data: Record<string, unknown>): MenuSop {
  const stepsRaw = Array.isArray(data.steps) ? data.steps : [];
  const ingsRaw = Array.isArray(data.ingredients) ? data.ingredients : [];
  const steps = stepsRaw.map(mapStep).sort((a, b) => a.order - b.order);
  const ingredients = ingsRaw.map(mapIngredient);
  const ingredientsText =
    String(data.ingredientsText || "").trim() ||
    ingredients
      .filter((i) => i.nameFreeText)
      .map((i) =>
        i.qty > 0 ? `${i.nameFreeText} ${i.qty}${i.unit}` : i.nameFreeText,
      )
      .join("\n");
  const makeStepsText =
    String(data.makeStepsText || "").trim() ||
    steps
      .filter((s) => s.title || s.body)
      .map((s, i) => {
        const head = s.title || `ขั้น ${i + 1}`;
        return s.body ? `${head}\n${s.body}` : head;
      })
      .join("\n\n");
  return {
    id,
    name: String(data.name || "").trim(),
    category: normalizeMenuSopCategory(data.category),
    menuItemId: data.menuItemId ? String(data.menuItemId) : undefined,
    prodProductId: data.prodProductId ? String(data.prodProductId) : undefined,
    yieldQty: Number(data.yieldQty) > 0 ? Number(data.yieldQty) : 1,
    yieldUnit: String(data.yieldUnit || "ชิ้น").trim() || "ชิ้น",
    pieceWeightG:
      data.pieceWeightG != null && Number(data.pieceWeightG) > 0
        ? Number(data.pieceWeightG)
        : undefined,
    description: String(data.description || "").trim(),
    ingredientsText,
    makeStepsText,
    sellStepsText: String(data.sellStepsText || "").trim(),
    steps,
    ingredients,
    skipped: data.skipped === true,
    /* ค่าเริ่มต้น = แสดง (เอกสารเก่าที่ไม่มีฟิลด์ / false จากรอบก่อน → เปิดให้เห็น) */
    staffVisible: data.staffVisible !== false,
    active: data.active !== false,
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

/** มีข้อความ SOP อย่างน้อยหนึ่งช่อง */
export function menuSopHasDraft(sop: Pick<
  MenuSop,
  "description" | "ingredientsText" | "makeStepsText" | "sellStepsText" | "ingredients" | "steps"
>): boolean {
  if (sop.description.trim()) return true;
  if (sop.ingredientsText.trim()) return true;
  if (sop.makeStepsText.trim()) return true;
  if (sop.sellStepsText.trim()) return true;
  if (sop.ingredients.some((i) => i.nameFreeText.trim())) return true;
  if (sop.steps.some((s) => s.title.trim() || s.body.trim())) return true;
  return false;
}

/** เช็คครบ/ขาด — เสร็จเมื่อมีส่วนผสม (บรรยาย/ทำ/ขายเก็บข้อมูลเก่าไว้ ไม่บังคับ) */
export function menuSopDraftChecks(
  sop: Pick<
    MenuSop,
    | "category"
    | "description"
    | "ingredientsText"
    | "makeStepsText"
    | "sellStepsText"
    | "ingredients"
    | "steps"
  > | null
  | undefined,
): MenuSopDraftChecks {
  const hasIngStruct = !!(sop && sop.ingredients.some((i) => i.nameFreeText.trim()));
  const hasStepStruct = !!(sop && sop.steps.some((s) => s.title.trim() || s.body.trim()));
  const description = !!(sop && sop.description.trim());
  const ingredients = !!(sop && (sop.ingredientsText.trim() || hasIngStruct));
  const make = !!(sop && (sop.makeStepsText.trim() || hasStepStruct));
  const sell = !!(sop && sop.sellStepsText.trim());
  const missingLabels: string[] = [];
  if (!ingredients) missingLabels.push("ส่วนผสม");
  return {
    description,
    ingredients,
    make,
    sell,
    complete: ingredients,
    missingLabels,
  };
}

/** สรุปสถานะงาน SOP จากส่วนผสม (ต้นทุนทางตรง) อัตโนมัติ */
export type MenuSopSummaryStatus = "done" | "skipped" | "pending";

export function menuSopSummaryStatus(
  skipped: boolean,
  checks: MenuSopDraftChecks,
): MenuSopSummaryStatus {
  if (skipped) return "skipped";
  if (checks.complete) return "done";
  return "pending";
}

export function labelMenuSopSummaryStatus(status: MenuSopSummaryStatus): string {
  if (status === "done") return "เสร็จแล้ว";
  if (status === "skipped") return "ข้าม";
  return "ยังไม่ครบ";
}

export function mapMenuSopCost(sopId: string, data: Record<string, unknown>): MenuSopCostDoc {
  const linksRaw = Array.isArray(data.ingredientLinks) ? data.ingredientLinks : [];
  return {
    sopId,
    ingredientLinks: linksRaw.map(mapLink).filter(Boolean) as MenuSopIngredientLink[],
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

export function createEmptyStep(order = 1): MenuSopStep {
  return { id: newId("step"), order, title: "", body: "" };
}

export function createEmptyIngredient(): MenuSopIngredient {
  return { id: newId("ing"), nameFreeText: "", qty: 0, unit: "ก." };
}

export async function listMenuSops(): Promise<MenuSop[]> {
  const snap = await getDocs(
    query(collection(getDb(), MENU_SOPS_COL), orderBy("name", "asc")),
  );
  return snap.docs.map((d) => mapMenuSop(d.id, d.data() as Record<string, unknown>));
}

export function subscribeMenuSops(
  onData: (rows: MenuSop[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(getDb(), MENU_SOPS_COL), orderBy("name", "asc")),
    (snap) => {
      onData(snap.docs.map((d) => mapMenuSop(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getMenuSop(id: string): Promise<MenuSop | null> {
  const snap = await getDoc(doc(getDb(), MENU_SOPS_COL, id));
  if (!snap.exists()) return null;
  return mapMenuSop(snap.id, snap.data() as Record<string, unknown>);
}

export function subscribeMenuSop(
  id: string,
  onData: (row: MenuSop | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), MENU_SOPS_COL, id),
    (snap) => {
      onData(snap.exists() ? mapMenuSop(snap.id, snap.data() as Record<string, unknown>) : null);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

function sopWritePayload(
  input: Omit<MenuSop, "id" | "createdAt" | "updatedAt"> & { updatedBy: string },
  createdAt?: number,
): Record<string, unknown> {
  const name = input.name.trim();
  if (!name) throw new Error("ต้องใส่ชื่อ SOP");
  return {
    name,
    category: normalizeMenuSopCategory(input.category),
    menuItemId: (input.menuItemId || "").trim() || null,
    prodProductId: (input.prodProductId || "").trim() || null,
    yieldQty: Number(input.yieldQty) > 0 ? Number(input.yieldQty) : 1,
    yieldUnit: (input.yieldUnit || "ชิ้น").trim() || "ชิ้น",
    pieceWeightG:
      input.pieceWeightG != null && Number(input.pieceWeightG) > 0
        ? Number(input.pieceWeightG)
        : null,
    description: String(input.description || "").trim(),
    ingredientsText: String(input.ingredientsText || "").trim(),
    makeStepsText: String(input.makeStepsText || "").trim(),
    sellStepsText: String(input.sellStepsText || "").trim(),
    steps: (input.steps || []).map((s, i) => ({
      id: s.id || newId("step"),
      order: Number(s.order) || i + 1,
      title: String(s.title || "").trim(),
      body: String(s.body || "").trim(),
      qtyNote: (s.qtyNote || "").trim() || null,
    })),
    ingredients: (input.ingredients || []).map((ing) => ({
      id: ing.id || newId("ing"),
      nameFreeText: String(ing.nameFreeText || "").trim(),
      qty: Number(ing.qty) || 0,
      unit: String(ing.unit || "ก.").trim() || "ก.",
    })),
    skipped: input.skipped === true,
    staffVisible: input.staffVisible !== false,
    active: input.active !== false,
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
    ...(createdAt != null ? { createdAt } : {}),
  };
}

export async function createMenuSop(
  input: Omit<
    MenuSop,
    "id" | "createdAt" | "updatedAt" | "category" | "skipped" | "staffVisible"
  > & {
    updatedBy: string;
    category?: MenuSopCategory;
    skipped?: boolean;
    staffVisible?: boolean;
  },
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(
    collection(getDb(), MENU_SOPS_COL),
    sopWritePayload(
      {
        ...input,
        category: normalizeMenuSopCategory(input.category),
        skipped: input.skipped === true,
        staffVisible: input.staffVisible !== false,
        active: input.active !== false,
      },
      now,
    ),
  );
  return ref.id;
}

export async function updateMenuSop(
  id: string,
  patch: Partial<Omit<MenuSop, "id" | "createdAt" | "category">> & { updatedBy: string },
): Promise<void> {
  const prev = await getMenuSop(id);
  if (!prev) throw new Error("ไม่พบ SOP");
  const merged = {
    name: patch.name ?? prev.name,
    menuItemId: patch.menuItemId !== undefined ? patch.menuItemId : prev.menuItemId,
    prodProductId:
      patch.prodProductId !== undefined ? patch.prodProductId : prev.prodProductId,
    yieldQty: patch.yieldQty ?? prev.yieldQty,
    yieldUnit: patch.yieldUnit ?? prev.yieldUnit,
    pieceWeightG:
      patch.pieceWeightG !== undefined ? patch.pieceWeightG : prev.pieceWeightG,
    description: patch.description !== undefined ? patch.description : prev.description,
    ingredientsText:
      patch.ingredientsText !== undefined ? patch.ingredientsText : prev.ingredientsText,
    makeStepsText:
      patch.makeStepsText !== undefined ? patch.makeStepsText : prev.makeStepsText,
    sellStepsText:
      patch.sellStepsText !== undefined ? patch.sellStepsText : prev.sellStepsText,
    steps: patch.steps ?? prev.steps,
    ingredients: patch.ingredients ?? prev.ingredients,
    skipped: patch.skipped !== undefined ? patch.skipped : prev.skipped,
    staffVisible:
      patch.staffVisible !== undefined ? patch.staffVisible : prev.staffVisible,
    active: patch.active ?? prev.active,
    updatedBy: patch.updatedBy,
    category: prev.category,
  };
  await updateDoc(doc(getDb(), MENU_SOPS_COL, id), sopWritePayload(merged));
}

/** บันทึก SOP ตามเมนูหลังร้าน — มีแล้วอัปเดต ไม่มีสร้างใหม่ */
export async function upsertMenuSopForMenuItem(input: {
  menuItemId: string;
  name: string;
  description?: string;
  ingredientsText?: string;
  makeStepsText?: string;
  sellStepsText?: string;
  yieldQty?: number;
  yieldUnit?: string;
  pieceWeightG?: number;
  existingId?: string;
  updatedBy: string;
}): Promise<string> {
  const menuItemId = input.menuItemId.trim();
  if (!menuItemId) throw new Error("ต้องผูกเมนูหลังร้าน");

  let existingId = input.existingId?.trim() || "";
  if (!existingId) {
    const all = await listMenuSops();
    const hit = all.find((s) => s.menuItemId === menuItemId);
    if (hit) existingId = hit.id;
  }

  const draft = {
    name: input.name.trim() || "เมนู",
    menuItemId,
    category: "menu" as const,
    description: input.description || "",
    ingredientsText: input.ingredientsText || "",
    makeStepsText: input.makeStepsText || "",
    sellStepsText: input.sellStepsText || "",
    yieldQty: input.yieldQty ?? 1,
    yieldUnit: input.yieldUnit || "ชิ้น",
    pieceWeightG: input.pieceWeightG,
    steps: [] as MenuSopStep[],
    ingredients: [] as MenuSopIngredient[],
    active: true,
    updatedBy: input.updatedBy,
  };

  if (existingId) {
    const prev = await getMenuSop(existingId);
    await updateMenuSop(existingId, {
      ...draft,
      // คงโครงจัดแล้วไว้ถ้ามี — รอบนี้โฟกัสกล่องข้อความ
      steps: prev?.steps || [],
      ingredients: prev?.ingredients || [],
      skipped: prev?.skipped,
      staffVisible: prev?.staffVisible,
      updatedBy: input.updatedBy,
    });
    return existingId;
  }

  return createMenuSop({ ...draft, skipped: false, staffVisible: true });
}

/** บันทึกเบสวัตถุดิบ (ผสมก่อนลงเมนู) — ไม่ผูก menuItemId · ชื่อซ้ำไม่ได้ */
export function normalizeBaseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("th");
}

export async function findActiveBaseByName(
  name: string,
  exceptId?: string,
): Promise<MenuSop | null> {
  const key = normalizeBaseNameKey(name);
  if (!key) return null;
  const all = await listMenuSops();
  const except = (exceptId || "").trim();
  return (
    all.find(
      (s) =>
        isBaseSop(s) &&
        s.active !== false &&
        s.id !== except &&
        normalizeBaseNameKey(s.name) === key,
    ) || null
  );
}

export async function upsertMenuSopBase(input: {
  name: string;
  description?: string;
  ingredientsText?: string;
  makeStepsText?: string;
  sellStepsText?: string;
  yieldQty?: number;
  yieldUnit?: string;
  pieceWeightG?: number;
  existingId?: string;
  /** ค่าเริ่มต้นตอนสร้างใหม่ — พนักงานสร้างเองควรเห็นทันที */
  staffVisible?: boolean;
  updatedBy: string;
}): Promise<string> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("ต้องใส่ชื่อเบส");

  const existingId = input.existingId?.trim() || "";
  const dup = await findActiveBaseByName(name, existingId || undefined);
  if (dup) {
    throw new Error(`มีเบสชื่อ «${dup.name}» อยู่แล้ว — ใช้ชื่ออื่น`);
  }

  const draft = {
    name,
    category: "base" as const,
    description: input.description || "",
    ingredientsText: input.ingredientsText || "",
    makeStepsText: input.makeStepsText || "",
    sellStepsText: input.sellStepsText || "",
    yieldQty: input.yieldQty ?? 1,
    yieldUnit: input.yieldUnit || "ลิตร",
    pieceWeightG: input.pieceWeightG,
    steps: [] as MenuSopStep[],
    ingredients: [] as MenuSopIngredient[],
    active: true,
    updatedBy: input.updatedBy,
  };

  if (existingId) {
    const prev = await getMenuSop(existingId);
    if (!prev || prev.category !== "base") {
      throw new Error("ไม่พบเบส");
    }
    await updateMenuSop(existingId, {
      ...draft,
      steps: prev.steps || [],
      ingredients: prev.ingredients || [],
      skipped: prev.skipped,
      staffVisible: prev.staffVisible,
      updatedBy: input.updatedBy,
    });
    return existingId;
  }

  return createMenuSop({
    ...draft,
    skipped: false,
    // พนักงานสร้างเบสเอง → เปิดแสดงให้เห็นทันที (เจ้าของยังกดซ่อนได้)
    staffVisible: input.staffVisible !== false,
  });
}

export function isBaseSop(sop: Pick<MenuSop, "category">): boolean {
  return sop.category === "base";
}

/** เปิด/ปิดแสดงพนักงาน หรือข้าม — สร้าง stub ถ้ายังไม่มี SOP */
export async function patchMenuSopWorkFlags(input: {
  updatedBy: string;
  skipped?: boolean;
  staffVisible?: boolean;
  /** เมนูหลังร้าน */
  menuItemId?: string;
  menuName?: string;
  /** หรือเบสที่มี id แล้ว */
  sopId?: string;
}): Promise<string> {
  const sopId = (input.sopId || "").trim();
  const menuItemId = (input.menuItemId || "").trim();

  if (sopId) {
    const prev = await getMenuSop(sopId);
    if (!prev) throw new Error("ไม่พบ SOP");
    await updateMenuSop(sopId, {
      skipped: input.skipped !== undefined ? input.skipped : prev.skipped,
      staffVisible:
        input.staffVisible !== undefined ? input.staffVisible : prev.staffVisible,
      updatedBy: input.updatedBy,
    });
    return sopId;
  }

  if (!menuItemId) throw new Error("ต้องระบุเมนูหรือ SOP");

  const all = await listMenuSops();
  const hit = all.find((s) => s.menuItemId === menuItemId && !isBaseSop(s));
  if (hit) {
    await updateMenuSop(hit.id, {
      skipped: input.skipped !== undefined ? input.skipped : hit.skipped,
      staffVisible:
        input.staffVisible !== undefined ? input.staffVisible : hit.staffVisible,
      updatedBy: input.updatedBy,
    });
    return hit.id;
  }

  return createMenuSop({
    name: (input.menuName || "เมนู").trim() || "เมนู",
    menuItemId,
    category: "menu",
    description: "",
    ingredientsText: "",
    makeStepsText: "",
    sellStepsText: "",
    yieldQty: 1,
    yieldUnit: "ชิ้น",
    steps: [],
    ingredients: [],
    skipped: input.skipped === true,
    staffVisible: input.staffVisible !== false,
    active: true,
    updatedBy: input.updatedBy,
  });
}

export async function deleteMenuSop(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), MENU_SOPS_COL, id));
  try {
    await deleteDoc(doc(getDb(), MENU_SOP_COSTS_COL, id));
  } catch {
    /* cost doc may not exist */
  }
}

export async function getMenuSopCost(sopId: string): Promise<MenuSopCostDoc | null> {
  const snap = await getDoc(doc(getDb(), MENU_SOP_COSTS_COL, sopId));
  if (!snap.exists()) return null;
  return mapMenuSopCost(sopId, snap.data() as Record<string, unknown>);
}

export async function countMenusLinkedToStock(): Promise<Map<string, number>> {
  const snap = await getDocs(collection(getDb(), MENU_SOP_COSTS_COL));
  const counts = new Map<string, number>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const linksRaw = Array.isArray(data.ingredientLinks) ? data.ingredientLinks : [];
    const seen = new Set<string>();
    for (const row of linksRaw) {
      if (!row || typeof row !== "object") continue;
      const sid = String((row as { stockItemId?: unknown }).stockItemId || "").trim();
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      counts.set(sid, (counts.get(sid) || 0) + 1);
    }
  }
  return counts;
}

export function subscribeMenuSopCost(
  sopId: string,
  onData: (row: MenuSopCostDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getDb(), MENU_SOP_COSTS_COL, sopId),
    (snap) => {
      onData(
        snap.exists()
          ? mapMenuSopCost(sopId, snap.data() as Record<string, unknown>)
          : null,
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function setMenuSopIngredientLinks(
  sopId: string,
  links: MenuSopIngredientLink[],
  updatedBy: string,
): Promise<void> {
  const cleaned = links
    .map((l) => mapLink(l))
    .filter(Boolean) as MenuSopIngredientLink[];
  await setDoc(
    doc(getDb(), MENU_SOP_COSTS_COL, sopId),
    {
      ingredientLinks: cleaned,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

/** คำนวณต้นทุนจากลิงก์ + stockCosts (ฝั่งเจ้าของ) */
export function computeMenuSopCostSummary(
  sop: MenuSop,
  links: MenuSopIngredientLink[],
  stockById: Map<string, { name: string; unit: string }>,
  costMap: Map<string, number>,
): MenuSopCostSummary {
  const linkByIng = new Map(links.map((l) => [l.ingredientId, l]));
  const missingLinks: string[] = [];
  const missingCosts: string[] = [];
  const lines: MenuSopCostLine[] = [];

  for (const ing of sop.ingredients) {
    const link = linkByIng.get(ing.id);
    if (!link) {
      missingLinks.push(ing.nameFreeText || ing.id);
      continue;
    }
    if (link.baseSopId && !link.stockItemId) {
      // เบส — ยังไม่แตกต้นทุนซ้อนในรอบนี้
      const qty = Number(link.qty) > 0 ? Number(link.qty) : Number(ing.qty) || 0;
      lines.push({
        ingredientId: ing.id,
        name: ing.nameFreeText,
        qty,
        unit: link.unit || ing.unit,
        stockItemId: "",
        stockName: ing.nameFreeText || "เบส",
        unitCost: 0,
        lineCost: 0,
      });
      continue;
    }
    const stock = stockById.get(link.stockItemId);
    const unitCost = costMap.get(link.stockItemId) || 0;
    if (!(unitCost > 0)) {
      missingCosts.push(stock?.name || link.stockItemId);
    }
    const qty = Number(link.qty) > 0 ? Number(link.qty) : Number(ing.qty) || 0;
    const lineCost = Math.round(qty * unitCost * 100) / 100;
    lines.push({
      ingredientId: ing.id,
      name: ing.nameFreeText,
      qty,
      unit: link.unit || ing.unit,
      stockItemId: link.stockItemId,
      stockName: stock?.name || link.stockItemId,
      unitCost,
      lineCost,
    });
  }

  const batchCost =
    Math.round(lines.reduce((s, l) => s + l.lineCost, 0) * 100) / 100;
  const yieldQty = sop.yieldQty > 0 ? sop.yieldQty : 1;
  const perPiece = Math.round((batchCost / yieldQty) * 100) / 100;

  return { lines, batchCost, perPiece, yieldQty, missingLinks, missingCosts };
}

/** วัตถุดิบเบเกอรี่ — ชื่อมาตรฐานสั้น + aliases (ยี่ห้อ/ชื่อบิล) */
export const BAKERY_COST_CATALOG_SEED: {
  name: string;
  aliases: string[];
  unit: string;
  /** ฿ ต่อ 1 หน่วยของ stock.unit */
  unitCost: number;
  note: string;
  icon: string;
}[] = [
  {
    name: "แป้งสาลี",
    aliases: ["แป้งสาลี (บัวแดงพิเศษ)", "บัวแดงพิเศษ", "แป้งบัวแดง"],
    unit: "ก.",
    unitCost: 0.043,
    note: "ท็อปเวิลด์ 23–24/09/26 · 43฿/กก.",
    icon: "powder",
  },
  {
    name: "น้ำตาลทรายขาว",
    aliases: ["น้ำตาล", "น้ำตาลมิตรผล", "มิตรผล"],
    unit: "ก.",
    unitCost: 0.028,
    note: "ท็อปเวิลด์ · มิตรผล 28฿/กก.",
    icon: "powder",
  },
  {
    name: "ยีสต์แห้ง",
    aliases: ["ยีสต์แห้ง (Saf Instant)", "Saf Instant", "ยีสต์"],
    unit: "ก.",
    unitCost: 0.25,
    note: "ท็อปเวิลด์ 21/09/26 · 125฿/500ก.",
    icon: "powder",
  },
  {
    name: "ผงฟู",
    aliases: ["ผงเบคกิ้งโซดา / ผงฟู", "ผงเบคกิ้งโซดา", "แม็กกาแรต"],
    unit: "ก.",
    unitCost: 0.11,
    note: "ท็อปเวิลด์ 22/09/26 · แม็กกาแรต 33฿/300ก.",
    icon: "powder",
  },
  {
    name: "น้ำมันรำข้าว",
    aliases: ["น้ำมัน", "น้ำมันคิง", "คิง"],
    unit: "ก.",
    unitCost: 0.075,
    note: "คิง 1ล. 69฿ · ~0.92 ก./มล. → ~0.075฿/ก.",
    icon: "bag",
  },
  {
    name: "น้ำ",
    aliases: ["น้ำดื่ม/ประปา (ผลิต)", "น้ำดื่ม", "ประปา"],
    unit: "ก.",
    unitCost: 0.00002,
    note: "ประมาณค่าประปา ~20฿/ม³",
    icon: "soda",
  },
];

/** ชื่อเก่า → ชื่อมาตรฐาน (ย้ายรายการที่ seed ก่อนหน้า) */
const BAKERY_LEGACY_NAME_MAP: Record<string, string> = {
  "แป้งสาลี (บัวแดงพิเศษ)": "แป้งสาลี",
  "ยีสต์แห้ง (Saf Instant)": "ยีสต์แห้ง",
  "ผงเบคกิ้งโซดา / ผงฟู": "ผงฟู",
  "น้ำดื่ม/ประปา (ผลิต)": "น้ำ",
};

const MANTOU_INGREDIENTS: {
  name: string;
  qty: number;
  unit: string;
  catalogName: string;
}[] = [
  { name: "แป้งสาลี", qty: 400, unit: "ก.", catalogName: "แป้งสาลี" },
  { name: "น้ำ", qty: 240, unit: "ก.", catalogName: "น้ำ" },
  { name: "น้ำตาล", qty: 60, unit: "ก.", catalogName: "น้ำตาลทรายขาว" },
  { name: "ยีสต์", qty: 15, unit: "ก.", catalogName: "ยีสต์แห้ง" },
  { name: "ผงฟู", qty: 10, unit: "ก.", catalogName: "ผงฟู" },
  { name: "น้ำมัน", qty: 40, unit: "ก.", catalogName: "น้ำมันรำข้าว" },
];

/**
 * ย้ายแค็ตตาล็อกต้นทุนเบเกอรี่ไปแถบไม่นับ + รีเนมชื่อมาตรฐาน + aliases
 */
export async function markBakeryCostCatalogNotCounted(
  updatedBy: string,
): Promise<number> {
  const stock = await listStockItems();
  const byName = new Map(stock.map((s) => [s.name, s]));
  let moved = 0;

  // รีเนมชื่อเก่า → มาตรฐาน
  for (const [legacy, canonical] of Object.entries(BAKERY_LEGACY_NAME_MAP)) {
    const item = byName.get(legacy);
    if (!item) continue;
    const seed = BAKERY_COST_CATALOG_SEED.find((r) => r.name === canonical);
    const aliases = Array.from(
      new Set([...(item.aliases || []), legacy, ...(seed?.aliases || [])]),
    );
    // ถ้ามีรายการมาตรฐานอยู่แล้ว — รวม alias แล้วข้ามรีเนม
    if (byName.has(canonical) && canonical !== legacy) {
      const canon = byName.get(canonical)!;
      await updateStockItem(canon.id, {
        aliases: Array.from(
          new Set([...(canon.aliases || []), legacy, ...(seed?.aliases || [])]),
        ),
        includeInCount: false,
        updatedBy,
      });
      await updateStockItem(item.id, {
        includeInCount: false,
        aliases,
        updatedBy,
      });
      moved += 1;
      continue;
    }
    await updateStockItem(item.id, {
      name: canonical,
      aliases,
      includeInCount: false,
      updatedBy,
    });
    byName.delete(legacy);
    byName.set(canonical, { ...item, name: canonical, aliases });
    moved += 1;
  }

  const names = new Set(BAKERY_COST_CATALOG_SEED.map((r) => r.name));
  for (const item of [...byName.values()]) {
    if (!names.has(item.name)) continue;
    const seed = BAKERY_COST_CATALOG_SEED.find((r) => r.name === item.name);
    const nextAliases = Array.from(
      new Set([...(item.aliases || []), ...(seed?.aliases || [])]),
    );
    const needAlias =
      nextAliases.length !== (item.aliases || []).length ||
      nextAliases.some((a, i) => a !== (item.aliases || [])[i]);
    if (item.includeInCount !== false || needAlias) {
      await updateStockItem(item.id, {
        includeInCount: false,
        aliases: nextAliases,
        updatedBy,
      });
      moved += 1;
    }
  }
  return moved;
}

/**
 * สร้างแค็ตตาล็อกต้นทุนเบเกอรี่ + SOP หมั่นโถว (idempotent ตามชื่อ)
 */
export async function seedBakerySopAndCosts(updatedBy: string): Promise<{
  stockCreated: number;
  sopId: string;
  sopCreated: boolean;
}> {
  const stock = await listStockItems();
  const byName = new Map(stock.map((s) => [s.name, s]));
  let stockCreated = 0;

  for (const row of BAKERY_COST_CATALOG_SEED) {
    if (byName.has(row.name)) continue;
    const id = await createStockItem({
      name: row.name,
      unit: row.unit,
      qty: 0,
      minQty: 0,
      safetyStock: 0,
      alertEnabled: false,
      includeInCount: false,
      aliases: row.aliases,
      unitCost: row.unitCost,
      icon: row.icon,
      note: row.note,
      updatedBy,
    });
    byName.set(row.name, {
      id,
      name: row.name,
      unit: row.unit,
      qty: 0,
      minQty: 0,
      alertEnabled: false,
      safetyStock: 0,
      unitCost: row.unitCost,
      includeInCount: false,
      aliases: row.aliases,
      updatedAt: Date.now(),
      updatedBy,
    });
    stockCreated += 1;
  }

  await markBakeryCostCatalogNotCounted(updatedBy);

  // รีเฟรชหลังรีเนมชื่อมาตรฐาน / aliases
  const stockFresh = await listStockItems();
  byName.clear();
  for (const s of stockFresh) byName.set(s.name, s);
  for (const row of BAKERY_COST_CATALOG_SEED) {
    if (byName.has(row.name)) continue;
    const viaAlias = findStockByNameOrAlias(stockFresh, row.aliases[0] || row.name);
    if (viaAlias) byName.set(row.name, viaAlias);
  }

  // refresh costs for existing catalog rows that have 0
  const { setStockUnitCost } = await import("./stock-costs");
  const costMap = await listStockCostMap();
  for (const row of BAKERY_COST_CATALOG_SEED) {
    const item = byName.get(row.name);
    if (!item) continue;
    const existing = costMap.get(item.id) || 0;
    if (!(existing > 0) && row.unitCost > 0) {
      await setStockUnitCost(item.id, row.unitCost, {
        updatedBy,
        note: "seed bakery catalog",
        baseUnit: row.unit,
      });
    }
  }

  let menuItemId: string | undefined;
  let prodProductId: string | undefined;
  try {
    const menuSnap = await getDocs(collection(getDb(), "menuItems"));
    for (const d of menuSnap.docs) {
      const name = String(d.data().name || "");
      if (name.includes("หมั่นโถ")) {
        menuItemId = d.id;
        break;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const prodSnap = await getDocs(collection(getDb(), "prodProducts"));
    for (const d of prodSnap.docs) {
      const name = String(d.data().name || "");
      if (name.includes("หมั่นโถ")) {
        prodProductId = d.id;
        break;
      }
    }
  } catch {
    /* ignore */
  }

  const existingSops = await listMenuSops();
  let sop = existingSops.find((s) => s.name.includes("หมั่นโถ"));
  let sopCreated = false;
  const ingredients: MenuSopIngredient[] = MANTOU_INGREDIENTS.map((m) => ({
    id: newId("ing"),
    nameFreeText: m.name,
    qty: m.qty,
    unit: m.unit,
  }));

  if (!sop) {
    const steps = [
      {
        id: newId("step"),
        order: 1,
        title: "ผสมส่วนผสมแห้ง",
        body: "ผสมแป้งสาลี น้ำตาล ยีสต์ ผงฟู ให้เข้ากัน",
      },
      {
        id: newId("step"),
        order: 2,
        title: "เติมน้ำและน้ำมัน",
        body: "ใส่น้ำและน้ำมัน นวดจนเนียน ไม่ติดมือ",
      },
      {
        id: newId("step"),
        order: 3,
        title: "พักโด / ปั้น / นึ่ง",
        body: "พักโดให้ขึ้นฟู ปั้นเป็นก้อนละ 80 กรัม ได้ 9 ชิ้น แล้วนึ่งจนสุก",
      },
    ];
    const sopId = await createMenuSop({
      name: "หมั่นโถว โฮมเมด",
      category: "bakery",
      menuItemId,
      prodProductId,
      yieldQty: 9,
      yieldUnit: "ชิ้น",
      pieceWeightG: 80,
      description: "หมั่นโถวโฮมเมด · สูตร 9 ชิ้น × 80 กรัม",
      ingredientsText: ingredients
        .map((i) => `${i.nameFreeText} ${i.qty}${i.unit}`)
        .join("\n"),
      makeStepsText: steps
        .map((s) => `${s.title}\n${s.body}`)
        .join("\n\n"),
      sellStepsText: "อุ่นนึ่งให้ร้อน · ใส่ถุงกระดาษเบเกอรี่ตอนขาย",
      steps,
      ingredients,
      active: true,
      updatedBy,
    });
    sop = (await getMenuSop(sopId))!;
    sopCreated = true;
  }

  const costPrev = await getMenuSopCost(sop.id);
  if (!costPrev?.ingredientLinks?.length) {
    const links: MenuSopIngredientLink[] = [];
    const roster = [...byName.values()];
    for (let i = 0; i < MANTOU_INGREDIENTS.length; i++) {
      const meta = MANTOU_INGREDIENTS[i]!;
      const ing = sop.ingredients.find((x) => x.nameFreeText === meta.name) || sop.ingredients[i];
      const stockItem =
        byName.get(meta.catalogName) ||
        findStockByNameOrAlias(roster, meta.catalogName) ||
        findStockByNameOrAlias(roster, meta.name);
      if (!ing || !stockItem) continue;
      links.push({
        ingredientId: ing.id,
        stockItemId: stockItem.id,
        qty: meta.qty,
        unit: meta.unit,
      });
    }
    if (links.length) {
      await setMenuSopIngredientLinks(sop.id, links, updatedBy);
    }
  }

  return { stockCreated, sopId: sop.id, sopCreated };
}
