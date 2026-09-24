/**
 * รายการในบิล (billLines) บน ledger — แยกจากลิสต์บัญชี
 * AI แยก → เก็บในรายละเอียดบิล → เจ้าของยืนยันก่อนอัปเดต stockCosts
 */
import {
  extractStockCostsFromBill,
  type BillCostLineProposal,
} from "./menu-sop-ai";
import { canonicalLedgerType } from "./ledger-labels";
import { addStockAliasIfNew, createStockItem, findStockByNameOrAlias, normalizeStockMatchKey } from "./stock";
import {
  convertUnitCost,
  setStockUnitCost,
  stockUnitsCompatible,
} from "./stock-costs";
import type { LedgerBillLine, StockItem } from "./types";

export function normalizeLedgerBillLines(raw: unknown): LedgerBillLine[] {
  if (!Array.isArray(raw)) return [];
  const out: LedgerBillLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const d = row as Record<string, unknown>;
    const name = String(d.name || "").trim();
    if (!name) continue;
    const price = Number(d.price);
    const unitCost = Number(d.unitCost);
    const packSize = Number(d.packSize);
    const confidence = Number(d.confidence);
    const costAppliedAt = Number(d.costAppliedAt);
    out.push({
      name: name.slice(0, 120),
      packSize: Number.isFinite(packSize) && packSize > 0 ? packSize : null,
      packUnit: String(d.packUnit || "").trim().slice(0, 20),
      price: Number.isFinite(price) && price > 0 ? price : null,
      unitCost: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : null,
      baseUnit: String(d.baseUnit || "ก.").trim().slice(0, 20) || "ก.",
      matchStockItemId: d.matchStockItemId
        ? String(d.matchStockItemId).slice(0, 80)
        : null,
      matchStockName: d.matchStockName
        ? String(d.matchStockName).slice(0, 120)
        : null,
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0,
      note: String(d.note || "").trim().slice(0, 160),
      costAppliedAt:
        Number.isFinite(costAppliedAt) && costAppliedAt > 0
          ? costAppliedAt
          : null,
    });
    if (out.length >= 40) break;
  }
  return out;
}

export function billLinesFromAiProposals(
  lines: BillCostLineProposal[],
): LedgerBillLine[] {
  return normalizeLedgerBillLines(lines);
}

/** จับคู่ชื่อ/alias ฝั่ง client ถ้า AI ไม่ส่ง match */
export function rematchBillLinesToStock(
  lines: LedgerBillLine[],
  stock: StockItem[],
): LedgerBillLine[] {
  return lines.map((line) => {
    if (line.matchStockItemId) {
      const hit = stock.find((s) => s.id === line.matchStockItemId);
      if (hit) {
        return {
          ...line,
          matchStockName: hit.name,
        };
      }
    }
    const hit = findStockByNameOrAlias(stock, line.name);
    if (!hit) return { ...line, matchStockItemId: null, matchStockName: null };
    return {
      ...line,
      matchStockItemId: hit.id,
      matchStockName: hit.name,
      confidence: Math.max(line.confidence, 0.55),
    };
  });
}

export async function extractBillLinesFromPhotos(input: {
  imageRefs: string[];
  stock: StockItem[];
}): Promise<LedgerBillLine[]> {
  const refs = (input.imageRefs || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!refs.length) return [];

  // ส่งแค็ตตาล็อกแถบไม่นับก่อน แล้วตามด้วยรายการอื่น (สูงสุด 200 ที่ CF)
  const skip = input.stock.filter((s) => s.includeInCount === false);
  const rest = input.stock.filter((s) => s.includeInCount !== false);
  const catalog = [...skip, ...rest].slice(0, 200).map((s) => ({
    id: s.id,
    name: s.name,
    unit: s.unit,
    aliases: s.aliases || [],
  }));

  const result = await extractStockCostsFromBill({
    imageRefs: refs,
    stockCatalog: catalog,
  });
  return rematchBillLinesToStock(
    billLinesFromAiProposals(result.lines),
    input.stock,
  );
}

export type ApplyBillLineResult = {
  unitCost: number;
  unit: string;
  stockItemId: string;
};

/** ยืนยันอัปเดตต้นทุนคลังจากบรรทัดในบิล + ลิงก์ ledger */
export async function applyLedgerBillLineToStock(input: {
  line: LedgerBillLine;
  stock: StockItem[];
  ledgerEntryId: string;
  updatedBy: string;
}): Promise<ApplyBillLineResult> {
  const { line, stock, ledgerEntryId, updatedBy } = input;
  if (!line.matchStockItemId || !(line.unitCost && line.unitCost > 0)) {
    throw new Error("ต้องมีคู่คลังและราคาต่อหน่วย");
  }
  const stockItem = stock.find((s) => s.id === line.matchStockItemId);
  if (!stockItem) throw new Error("ไม่พบรายการคลัง");

  let unitCost = line.unitCost;
  if (line.baseUnit) {
    if (!stockUnitsCompatible(line.baseUnit, stockItem.unit)) {
      throw new Error(
        `หน่วยไม่เข้ากัน: บิล ${line.baseUnit} · คลัง ${stockItem.unit}`,
      );
    }
    const converted = convertUnitCost(
      line.unitCost,
      line.baseUnit,
      stockItem.unit,
    );
    if (converted != null) unitCost = converted;
  }

  await setStockUnitCost(line.matchStockItemId, unitCost, {
    updatedBy,
    ledgerEntryId,
    billLineName: line.name,
    baseUnit: stockItem.unit || line.baseUnit,
    note: line.note || undefined,
  });
  if (line.name) {
    await addStockAliasIfNew(line.matchStockItemId, line.name, updatedBy);
  }
  return {
    unitCost,
    unit: stockItem.unit,
    stockItemId: line.matchStockItemId,
  };
}

export function markBillLineCostApplied(
  lines: LedgerBillLine[],
  index: number,
  at = Date.now(),
): LedgerBillLine[] {
  return lines.map((line, i) =>
    i === index ? { ...line, costAppliedAt: at } : line,
  );
}

/** ชื่อสั้นสำหรับสร้างรายการคลังจากบิล — ไม่ใส่ราคา */
export function suggestStockCatalogNameFromBillLine(billName: string): string {
  let s = String(billName || "").trim();
  if (!s) return "";
  // ตัดขนาดแพ็คหลัง × / x / จำนวน
  s = s.split(/\s*[×xX]\s*\d+/)[0] || s;
  s = s.replace(
    /\d[\d,]*\s*(กรัม|ก\.|กก\.?|กิโลกรัม|มล\.?|ลิตร|ล\.|ซม|มิล|ชิ้น|ใบ|เส้น|ฝา|ม้วน|กระป๋อง|ถุง|ขวด).*$/i,
    "",
  );
  s = s.replace(/\d[\d,]*\s*$/, "").replace(/\s+/g, " ").trim();
  return (s || billName).trim().slice(0, 80);
}

const PACKAGING_HINT =
  /ถุง|หลอด|แก้ว|ฝา|ฟิล์ม|กระดาษ|โคนไอศ|แก๊ซ|ถ้วยท็อป|ม้วนฝา/i;

/** ค่าบริการ / ขนส่ง / ภาษี / ส่วนลด — ไม่ใช่วัตถุดิบ ห้ามเข้าคลัง */
const NON_INGREDIENT_FEE_HINT =
  /ค่าบริการ|ค่าขนส่ง|ค่าจัดส่ง|ค่าส่งของ|ค่าส่งสินค้า|ค่าธรรมเนียม|ค่าโอน|shipping|freight|delivery\s*fee|service\s*fee|^ภาษี|ภาษีมูลค่า|vat\s*\d|ส่วนลด|discount|มัดจำ|deposit|ค่าแรง|ค่าจ้าง|ค่าเช่า|ค่าไฟ|ค่าน้ำ(?!แข็ง)|ค่าแก๊ส|ค่าอินเทอร์เน็ต|ค่าโทร|ค่าขยะ|ค่าที่จอด/i;

export function isLikelyPackagingBillLine(name: string): boolean {
  return PACKAGING_HINT.test(String(name || ""));
}

export function isLikelyNonIngredientFeeBillLine(name: string): boolean {
  return NON_INGREDIENT_FEE_HINT.test(String(name || "").trim());
}

/** มั่นใจว่าเป็นวัตถุดิบ (เข้าคลังอัตโนมัติได้) */
export const BILL_LINE_INGREDIENT_CONFIDENCE = 0.7;

export type BillLineCatalogTier = "ingredient" | "uncertain" | "skip";

/**
 * แยกระดับสำหรับดึงชื่อเข้าคลัง
 * · ingredient = มั่นใจว่าเป็นวัตถุดิบ
 * · uncertain = ไม่มั่นใจ แต่ยังอยู่ในรายชื่อบิล
 * · skip = วัสดุบรรจุ / ค่าบริการ·ขนส่ง / ไม่ใช่วัตถุดิบ
 *
 * ใช้ประเภทบัญชีที่มีอยู่แล้ว: ถ้าเป็นต้นทุน (cogs) → ถือว่าใช่ (ingredient)
 * ยกเว้นบรรจุ / ค่าบริการ·ขนส่ง / โน้ตข้าม
 */
export function classifyBillLineForCatalog(
  line: {
    name: string;
    confidence?: number;
    note?: string;
  },
  opts?: { ledgerType?: string | null },
): BillLineCatalogTier {
  const name = String(line.name || "").trim();
  if (!name) return "skip";
  if (isLikelyPackagingBillLine(name)) return "skip";
  if (isLikelyNonIngredientFeeBillLine(name)) return "skip";
  const note = String(line.note || "");
  if (/บรรจุ|ไม่ใช่วัตถุดิบ|ข้าม|สลิป|โอนเงิน|ค่าบริการ|ค่าขนส่ง/i.test(note))
    return "skip";
  // ประเภทบช. ต้นทุน — จัดหมวดไว้แล้ว ถือว่าเป็นวัตถุดิบ
  if (canonicalLedgerType(opts?.ledgerType) === "cogs") {
    return "ingredient";
  }
  const conf = Number(line.confidence);
  if (Number.isFinite(conf) && conf >= BILL_LINE_INGREDIENT_CONFIDENCE) {
    return "ingredient";
  }
  return "uncertain";
}

export type ImportBillLinesToStockResult = {
  created: { stockItemId: string; name: string; billName: string }[];
  aliased: { stockItemId: string; name: string; billName: string }[];
  skipped: { billName: string; reason: string }[];
};

/**
 * นำชื่อจากรายการในบิลเข้าคลังแบบไม่ซ้ำ
 * — ไม่ใส่ unitCost (ต้นทุนต้องยืนยันทีหลัง)
 * — รายการใหม่เข้าแถบ «ไม่นับ» (แค็ตตาล็อกสูตร/ต้นทุน)
 * — ค่าเริ่ม: เข้าเฉพาะที่มั่นใจว่าเป็นวัตถุดิบ
 */
export async function importUnmatchedBillLinesToStock(input: {
  lines: LedgerBillLine[];
  stock: StockItem[];
  updatedBy: string;
  /** ประเภทบัญชี — ถ้าต้นทุน (cogs) ถือว่าเป็นวัตถุดิบ */
  ledgerType?: string | null;
  /** รวมแถวที่ไม่มั่นใจ (ยังอยู่ในรายชื่อบิล) — ค่าเริ่มไม่รวม */
  includeUncertain?: boolean;
  /** รวมของที่น่าเป็นวัสดุบรรจุด้วย — ค่าเริ่มข้าม */
  includePackaging?: boolean;
}): Promise<ImportBillLinesToStockResult> {
  const { lines, updatedBy } = input;
  const includeUncertain = input.includeUncertain === true;
  const includePackaging = input.includePackaging === true;
  const classifyOpts = { ledgerType: input.ledgerType };
  let stock = [...input.stock];
  const created: ImportBillLinesToStockResult["created"] = [];
  const aliased: ImportBillLinesToStockResult["aliased"] = [];
  const skipped: ImportBillLinesToStockResult["skipped"] = [];
  const seenBillKeys = new Set<string>();

  for (const line of lines) {
    const billName = String(line.name || "").trim();
    if (!billName) continue;
    const billKey = normalizeStockMatchKey(billName);
    if (!billKey) continue;
    if (seenBillKeys.has(billKey)) {
      skipped.push({ billName, reason: "ซ้ำในบิลนี้" });
      continue;
    }
    seenBillKeys.add(billKey);

    const tier = classifyBillLineForCatalog(line, classifyOpts);
    if (tier === "skip" && !includePackaging) {
      skipped.push({ billName, reason: "ข้ามวัสดุบรรจุ/ไม่ใช่วัตถุดิบ" });
      continue;
    }
    if (tier === "uncertain" && !includeUncertain) {
      skipped.push({ billName, reason: "ยังไม่มั่นใจว่าเป็นวัตถุดิบ" });
      continue;
    }

    const hit =
      (line.matchStockItemId &&
        stock.find((s) => s.id === line.matchStockItemId)) ||
      findStockByNameOrAlias(stock, billName);

    if (hit) {
      const added = await addStockAliasIfNew(hit.id, billName, updatedBy);
      if (added) {
        aliased.push({
          stockItemId: hit.id,
          name: hit.name,
          billName,
        });
        stock = stock.map((s) =>
          s.id === hit.id
            ? { ...s, aliases: [...(s.aliases || []), billName] }
            : s,
        );
      } else {
        skipped.push({ billName, reason: "มีในคลังแล้ว" });
      }
      continue;
    }

    const catalogName = suggestStockCatalogNameFromBillLine(billName) || billName;
    const fromCogs = canonicalLedgerType(input.ledgerType) === "cogs";
    const uncertainNote =
      tier === "uncertain"
        ? "จากบิล · ไม่มั่นใจว่าเป็นวัตถุดิบ · ยังไม่ยืนยันต้นทุน"
        : fromCogs
          ? "จากบิล · ประเภทต้นทุน · ยังไม่ยืนยันต้นทุน"
          : "จากบิล · ยังไม่ยืนยันต้นทุน";
    const id = await createStockItem({
      name: catalogName,
      unit: (line.baseUnit || "ก.").trim() || "ก.",
      qty: 0,
      minQty: 0,
      includeInCount: false,
      aliases: catalogName === billName ? [] : [billName],
      note: uncertainNote,
      icon: "bag",
      updatedBy,
    });
    created.push({ stockItemId: id, name: catalogName, billName });
    stock.push({
      id,
      name: catalogName,
      unit: (line.baseUnit || "ก.").trim() || "ก.",
      qty: 0,
      minQty: 0,
      alertEnabled: false,
      safetyStock: 0,
      unitCost: 0,
      includeInCount: false,
      aliases: catalogName === billName ? [] : [billName],
      note: uncertainNote,
      icon: "bag",
      updatedAt: Date.now(),
      updatedBy,
    });
  }

  return { created, aliased, skipped };
}

/**
 * บันทึกบิลประเภทต้นทุน (cogs) → สร้าง/เติมชื่อใน /stock/ แถบ «ไม่นับ»
 * (ยังไม่ใส่ unitCost — เจ้าของยืนยันทีหลัง)
 * คืน billLines ที่จับคู่คลังใหม่แล้ว ถ้าสร้าง/alias ได้
 */
export async function syncCogsBillLinesIntoStock(input: {
  lines: LedgerBillLine[];
  stock: StockItem[];
  ledgerType: string | null | undefined;
  updatedBy: string;
}): Promise<{
  lines: LedgerBillLine[];
  importResult: ImportBillLinesToStockResult | null;
}> {
  const { lines, stock, updatedBy } = input;
  if (!updatedBy || !lines.length) {
    return { lines, importResult: null };
  }
  if (canonicalLedgerType(input.ledgerType) !== "cogs") {
    return { lines, importResult: null };
  }
  const importResult = await importUnmatchedBillLinesToStock({
    lines,
    stock,
    updatedBy,
    ledgerType: "cogs",
  });
  if (!importResult.created.length && !importResult.aliased.length) {
    return { lines, importResult };
  }
  const merged: StockItem[] = [
    ...stock.map((s) => {
      const aliasHit = importResult.aliased.find((a) => a.stockItemId === s.id);
      if (!aliasHit) return s;
      if ((s.aliases || []).includes(aliasHit.billName)) return s;
      return { ...s, aliases: [...(s.aliases || []), aliasHit.billName] };
    }),
    ...importResult.created.map((c) => ({
      id: c.stockItemId,
      name: c.name,
      unit: "ก.",
      qty: 0,
      minQty: 0,
      alertEnabled: false,
      safetyStock: 0,
      unitCost: 0,
      includeInCount: false,
      aliases: c.name === c.billName ? [] : [c.billName],
      updatedAt: Date.now(),
      updatedBy,
    })),
  ];
  return {
    lines: rematchBillLinesToStock(lines, merged),
    importResult,
  };
}
