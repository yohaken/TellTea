import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { bangkokDateKey } from "./utils";

export type ProdPolicyLabels = {
  product: string;
  minRange: string;
  monthQty: string;
  wasteQty: string;
  wasteMoney: string;
  bonus: string;
};

export type ProdPolicySettings = {
  /** ทิ้ง/เสีย: เรทเสีย = % ของเรทผลิต · หักโบนัส = ทิ้ง × เรทเสีย */
  wasteBonusPct: number;
  /** เด้งป๊อปอัปนโยบายเมื่อเข้าหน้าผลิต */
  popupEnabled: boolean;
  labels: ProdPolicyLabels;
  updatedAt: number;
  updatedBy: string;
};

export type ProdPolicyProductMin = {
  id: string;
  name: string;
  prodRate?: number;
  minQtyLow?: number;
  minQtyHigh?: number;
};

export type ProdPolicyMonthRow = {
  productId: string;
  productName: string;
  minRange: string;
  prodRate: number;
  wasteRate: number;
  /** จำนวนผลิตวันนี้ (ชื่อฟิลด์เดิม monthQty — นโยบายคิดต่อวัน) */
  monthQty: number;
  wasteQty: number;
  wasteMoney: number;
  bonus: number;
};

export const DEFAULT_PROD_POLICY_LABELS: ProdPolicyLabels = {
  product: "สินค้า",
  minRange: "ขั้นต่ำ",
  monthQty: "วันนี้",
  wasteQty: "ทิ้ง",
  wasteMoney: "เงินทิ้ง",
  bonus: "โบนัส",
};

export const DEFAULT_PROD_POLICY: ProdPolicySettings = {
  wasteBonusPct: 30,
  popupEnabled: true,
  labels: { ...DEFAULT_PROD_POLICY_LABELS },
  updatedAt: 0,
  updatedBy: "",
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clampPct(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, round2(n));
}

function cleanLabel(raw: unknown, fallback: string) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || fallback;
}

export function productHasMinPolicy(
  product: Pick<ProdPolicyProductMin, "minQtyLow" | "minQtyHigh">,
): boolean {
  return (Number(product.minQtyLow) || 0) > 0 || (Number(product.minQtyHigh) || 0) > 0;
}

export function hasAnyProdMinPolicy(products: ProdPolicyProductMin[]): boolean {
  return products.some(productHasMinPolicy);
}

export function formatProdMinRange(low?: number, high?: number): string {
  const lo = Math.max(0, Number(low) || 0);
  const hi = Math.max(0, Number(high) || 0);
  if (lo > 0 && hi > 0) {
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    return a === b ? String(a) : `${a}–${b}`;
  }
  if (lo > 0) return `≥ ${lo}`;
  if (hi > 0) return `≤ ${hi}`;
  return "";
}

/** เรทเสียต่อชิ้น = เรทผลิต × %ทิ้ง (เช่น 1.25 × 30% = 0.375) */
export function computeWasteRate(prodRate: number, wasteBonusPct: number): number {
  const rate = Math.max(0, Number(prodRate) || 0);
  const pct = clampPct(Number(wasteBonusPct) || 0);
  return rate * (pct / 100);
}

/** หักโบนัส = จำนวนเสีย × เรทเสีย · เรทเสีย = เรทผลิต × %ทิ้ง */
export function computeWasteBonusMoney(
  qtyWaste: number,
  prodRate: number,
  wasteBonusPct: number,
): number {
  const waste = Math.max(0, Number(qtyWaste) || 0);
  return round2(waste * computeWasteRate(prodRate, wasteBonusPct));
}

/** เรทเสียโชว์เป็นเรทหักต่อชิ้นทิ้ง — ไม่ใช่เรทบวกโบนัส */
export function formatDeductRate(amount: number): string {
  const s = formatPolicyRate(amount);
  return s ? `−${s}` : "";
}

/** เรทเล็ก (0.375) — ไม่ปัดเป็น 0.38 แล้วคูณแล้วเพี้ยน */
export function formatPolicyRate(amount: number): string {
  if (!(Number(amount) > 0)) return "";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/** ว่างเมื่อไม่มีตัวเงิน — ไม่โชว์ 0.00 */
export function formatPolicyMoney(amount: number): string {
  if (!(Number(amount) > 0)) return "";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** ว่างเมื่อยังไม่มีจำนวนวันนี้ */
export function formatPolicyQty(amount: number): string {
  if (!(Number(amount) > 0)) return "";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function filterProdEntriesOnBangkokDay<T extends { date: number }>(
  entries: T[],
  dayMs = Date.now(),
): T[] {
  const key = bangkokDateKey(dayMs);
  if (!key) return [];
  return entries.filter((row) => bangkokDateKey(row.date) === key);
}

export function summarizeProdPolicyMonth(
  entries: Array<{
    productId: string;
    qtyProduced: number;
    qtyWaste: number;
    prodRate: number;
  }>,
  products: ProdPolicyProductMin[],
  wasteBonusPct: number,
): ProdPolicyMonthRow[] {
  const pct = clampPct(wasteBonusPct);
  return products.filter(productHasMinPolicy).map((product) => {
    const prodRate = Math.max(0, Number(product.prodRate) || 0);
    let monthQty = 0;
    let wasteQty = 0;
    let wasteMoney = 0;
    let bonus = 0;
    for (const row of entries) {
      if (row.productId !== product.id) continue;
      const qty = Number(row.qtyProduced) || 0;
      const waste = Number(row.qtyWaste) || 0;
      const rate = Number(row.prodRate) || 0;
      const lineWaste = computeWasteBonusMoney(waste, rate, pct);
      monthQty += qty;
      wasteQty += waste;
      wasteMoney += lineWaste;
      bonus += Math.max(0, qty * rate - lineWaste);
    }
    return {
      productId: product.id,
      productName: product.name,
      minRange: formatProdMinRange(product.minQtyLow, product.minQtyHigh),
      prodRate,
      wasteRate: computeWasteRate(prodRate, pct),
      monthQty: round2(monthQty),
      wasteQty: round2(wasteQty),
      wasteMoney: round2(wasteMoney),
      bonus: round2(bonus),
    };
  });
}

export function sumProdPolicyMonth(rows: ProdPolicyMonthRow[]): {
  monthQty: number;
  wasteQty: number;
  wasteMoney: number;
  bonus: number;
} {
  return rows.reduce(
    (acc, row) => ({
      monthQty: round2(acc.monthQty + row.monthQty),
      wasteQty: round2(acc.wasteQty + row.wasteQty),
      wasteMoney: round2(acc.wasteMoney + row.wasteMoney),
      bonus: round2(acc.bonus + row.bonus),
    }),
    { monthQty: 0, wasteQty: 0, wasteMoney: 0, bonus: 0 },
  );
}

export function normalizeProdPolicySettings(
  data: Partial<ProdPolicySettings> | undefined,
): ProdPolicySettings {
  const labels = data?.labels;
  return {
    wasteBonusPct: clampPct(
      data?.wasteBonusPct == null ? DEFAULT_PROD_POLICY.wasteBonusPct : Number(data.wasteBonusPct),
    ),
    popupEnabled: data?.popupEnabled !== false,
    labels: {
      product: cleanLabel(labels?.product, DEFAULT_PROD_POLICY_LABELS.product),
      minRange: cleanLabel(labels?.minRange, DEFAULT_PROD_POLICY_LABELS.minRange),
      monthQty: (() => {
        const raw = typeof labels?.monthQty === "string" ? labels.monthQty.trim() : "";
        if (!raw || raw === "เดือนนี้") return DEFAULT_PROD_POLICY_LABELS.monthQty;
        return raw;
      })(),
      wasteQty: cleanLabel(labels?.wasteQty, DEFAULT_PROD_POLICY_LABELS.wasteQty),
      wasteMoney: cleanLabel(labels?.wasteMoney, DEFAULT_PROD_POLICY_LABELS.wasteMoney),
      bonus: cleanLabel(labels?.bonus, DEFAULT_PROD_POLICY_LABELS.bonus),
    },
    updatedAt: Number(data?.updatedAt) || 0,
    updatedBy: String(data?.updatedBy || ""),
  };
}

function policyRef() {
  return doc(getDb(), "meta", "prodPolicy");
}

export function subscribeProdPolicy(
  onData: (settings: ProdPolicySettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    policyRef(),
    (snap) => {
      onData(
        normalizeProdPolicySettings(
          snap.exists() ? (snap.data() as Partial<ProdPolicySettings>) : undefined,
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getProdPolicy(): Promise<ProdPolicySettings> {
  const snap = await getDoc(policyRef());
  if (!snap.exists()) return { ...DEFAULT_PROD_POLICY, labels: { ...DEFAULT_PROD_POLICY_LABELS } };
  return normalizeProdPolicySettings(snap.data() as Partial<ProdPolicySettings>);
}

export async function saveProdPolicy(
  patch: Partial<Pick<ProdPolicySettings, "wasteBonusPct" | "labels" | "popupEnabled">>,
  actorId: string,
  opts?: { asOwner?: boolean },
): Promise<ProdPolicySettings> {
  if (!opts?.asOwner) {
    throw new Error("ตั้งนโยบายได้เฉพาะเจ้าของ");
  }
  const current = await getProdPolicy();
  const next = normalizeProdPolicySettings({
    ...current,
    wasteBonusPct: patch.wasteBonusPct ?? current.wasteBonusPct,
    popupEnabled: patch.popupEnabled ?? current.popupEnabled,
    labels: patch.labels ? { ...current.labels, ...patch.labels } : current.labels,
    updatedAt: Date.now(),
    updatedBy: actorId || "owner",
  });
  await setDoc(policyRef(), next, { merge: true });
  return next;
}
