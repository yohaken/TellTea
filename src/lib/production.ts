import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type ProdStatus = "unpaid" | "paid";

export type ProdProduct = {
  id: string;
  name: string;
  /** เรทขาย */
  salesRate: number;
  /** เรทผลิต */
  prodRate: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ProdWorker = {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
};

export type ProdEntry = {
  id: string;
  date: number;
  workerIds: string[];
  workerNames: string[];
  productId: string;
  productName: string;
  salesRate: number;
  prodRate: number;
  qtyProduced: number;
  qtyWaste: number;
  note: string;
  status: ProdStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type ProdEntryInput = {
  date: number;
  workerIds: string[];
  workerNames: string[];
  productId: string;
  productName: string;
  salesRate: number;
  prodRate: number;
  qtyProduced: number;
  qtyWaste: number;
  note?: string;
  createdBy: string;
};

export type ProdComputed = {
  salesBonus: number;
  prodBonus: number;
  workerCount: number;
  bonusPerPerson: number;
};

export function computeProdBonus(entry: {
  qtyProduced: number;
  salesRate: number;
  prodRate: number;
  workerNames: string[];
}): ProdComputed {
  const qty = Number(entry.qtyProduced) || 0;
  const salesBonus = qty * (Number(entry.salesRate) || 0);
  const prodBonus = qty * (Number(entry.prodRate) || 0);
  const workerCount = Math.max(1, (entry.workerNames || []).filter(Boolean).length);
  const bonusPerPerson = prodBonus / workerCount;
  return { salesBonus, prodBonus, workerCount, bonusPerPerson };
}

export function labelProdStatus(status: ProdStatus) {
  return status === "paid" ? "จ่ายโบนัสแล้ว" : "ยังไม่จ่าย";
}

function productsCol() {
  return collection(getDb(), "prodProducts");
}
function workersCol() {
  return collection(getDb(), "prodWorkers");
}
function entriesCol() {
  return collection(getDb(), "prodEntries");
}

export async function listProdProducts(): Promise<ProdProduct[]> {
  const snap = await getDocs(query(productsCol(), orderBy("name", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProdProduct, "id">) }));
}

export async function listProdWorkers(): Promise<ProdWorker[]> {
  const snap = await getDocs(query(workersCol(), orderBy("name", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProdWorker, "id">) }));
}

export function subscribeProdEntries(
  onRows: (rows: ProdEntry[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(entriesCol(), orderBy("date", "desc"), orderBy("createdAt", "desc")),
    (snap) => {
      onRows(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ProdEntry, "id">),
        })),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function addProdProduct(input: {
  name: string;
  salesRate: number;
  prodRate: number;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("ต้องใส่ชื่อสินค้า");
  const now = Date.now();
  const ref = await addDoc(productsCol(), {
    name,
    salesRate: Number(input.salesRate) || 0,
    prodRate: Number(input.prodRate) || 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateProdProduct(
  id: string,
  patch: Partial<Pick<ProdProduct, "name" | "salesRate" | "prodRate" | "active">>,
): Promise<void> {
  const next: Record<string, string | number | boolean> = { updatedAt: Date.now() };
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.salesRate != null) next.salesRate = Number(patch.salesRate) || 0;
  if (patch.prodRate != null) next.prodRate = Number(patch.prodRate) || 0;
  if (patch.active != null) next.active = patch.active;
  await updateDoc(doc(getDb(), "prodProducts", id), next);
}

export async function addProdWorker(name: string): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error("ต้องใส่ชื่อพนักงาน");
  const ref = await addDoc(workersCol(), {
    name: n,
    active: true,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateProdWorker(
  id: string,
  patch: Partial<Pick<ProdWorker, "name" | "active">>,
): Promise<void> {
  const next: Record<string, string | boolean> = {};
  if (patch.name != null) next.name = patch.name.trim();
  if (patch.active != null) next.active = patch.active;
  await updateDoc(doc(getDb(), "prodWorkers", id), next);
}

export async function addProdEntry(input: ProdEntryInput): Promise<string> {
  if (!input.workerNames.length) throw new Error("เลือกพนักงานอย่างน้อย 1 คน");
  if (!input.productId) throw new Error("เลือกสินค้า");
  if (!(input.qtyProduced > 0)) throw new Error("ใส่จำนวนผลิต");
  const now = Date.now();
  const ref = await addDoc(entriesCol(), {
    date: input.date,
    workerIds: input.workerIds,
    workerNames: input.workerNames,
    productId: input.productId,
    productName: input.productName.trim(),
    salesRate: Number(input.salesRate) || 0,
    prodRate: Number(input.prodRate) || 0,
    qtyProduced: Number(input.qtyProduced) || 0,
    qtyWaste: Number(input.qtyWaste) || 0,
    note: (input.note || "").trim(),
    status: "unpaid" as ProdStatus,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateProdEntry(
  id: string,
  patch: Partial<
    Pick<
      ProdEntry,
      | "date"
      | "workerIds"
      | "workerNames"
      | "productId"
      | "productName"
      | "salesRate"
      | "prodRate"
      | "qtyProduced"
      | "qtyWaste"
      | "note"
      | "status"
    >
  >,
): Promise<void> {
  const next: Record<string, string | number | boolean | string[]> = {
    updatedAt: Date.now(),
  };
  if (patch.date != null) next.date = patch.date;
  if (patch.workerIds != null) next.workerIds = patch.workerIds;
  if (patch.workerNames != null) {
    if (!patch.workerNames.length) throw new Error("เลือกพนักงานอย่างน้อย 1 คน");
    next.workerNames = patch.workerNames;
  }
  if (patch.productId != null) next.productId = patch.productId;
  if (patch.productName != null) next.productName = patch.productName.trim();
  if (patch.salesRate != null) next.salesRate = Number(patch.salesRate) || 0;
  if (patch.prodRate != null) next.prodRate = Number(patch.prodRate) || 0;
  if (patch.qtyProduced != null) {
    if (!(Number(patch.qtyProduced) > 0)) throw new Error("ใส่จำนวนผลิต");
    next.qtyProduced = Number(patch.qtyProduced);
  }
  if (patch.qtyWaste != null) next.qtyWaste = Number(patch.qtyWaste) || 0;
  if (patch.note != null) next.note = patch.note.trim();
  if (patch.status != null) next.status = patch.status;
  await updateDoc(doc(getDb(), "prodEntries", id), next);
}

export async function deleteProdEntry(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "prodEntries", id));
}

/** Seed starter catalog if empty (owner). */
export async function seedProdCatalogIfEmpty(): Promise<{ products: number; workers: number }> {
  const [products, workers] = await Promise.all([listProdProducts(), listProdWorkers()]);
  let p = 0;
  let w = 0;
  if (!products.length) {
    const starter = [
      { name: "มันอบ", salesRate: 0.6, prodRate: 1.25 },
      { name: "ขนมปังมันม่วง", salesRate: 0.6, prodRate: 1.8 },
      { name: "บราวนี่", salesRate: 0.6, prodRate: 1.25 },
      { name: "ซอฟคุ้กกี้-โกโก้", salesRate: 0.6, prodRate: 1.25 },
      { name: "ซอฟคุ้กกี้-มัจฉะ", salesRate: 0.6, prodRate: 1.25 },
      { name: "ชิโอปัง", salesRate: 0.6, prodRate: 1.8 },
    ];
    for (const row of starter) {
      await addProdProduct(row);
      p += 1;
    }
  }
  if (!workers.length) {
    for (const name of ["เป้", "เตย", "ทัพ"]) {
      await addProdWorker(name);
      w += 1;
    }
  }
  return { products: p, workers: w };
}
