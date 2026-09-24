/**
 * Client → Cloud Functions: AI สำหรับต้นทุน SOP / อ่านบิล → stockCosts
 */
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";

export type BillCostLineProposal = {
  name: string;
  packSize: number | null;
  packUnit: string;
  price: number | null;
  /** ฿ ต่อหน่วยฐาน (เช่น ต่อกรัม) ถ้าคำนวณได้ */
  unitCost: number | null;
  baseUnit: string;
  matchStockItemId: string | null;
  matchStockName: string | null;
  confidence: number;
  note: string;
};

export type ExtractStockCostsFromBillResult = {
  lines: BillCostLineProposal[];
  model: string;
  usedImages: number;
  reason: string;
};

export type SopLinkProposal = {
  ingredientId: string;
  ingredientName: string;
  stockItemId: string | null;
  stockName: string | null;
  qty: number;
  unit: string;
  note: string;
};

export type AnalyzeMenuSopCostResult = {
  links: SopLinkProposal[];
  batchCostEstimate: number | null;
  perPieceEstimate: number | null;
  model: string;
  reason: string;
};

export async function extractStockCostsFromBill(input: {
  imageRefs: string[];
  stockCatalog: { id: string; name: string; unit: string; aliases?: string[] }[];
  model?: string;
}): Promise<ExtractStockCostsFromBillResult> {
  const refs = (input.imageRefs || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!refs.length) throw new Error("ต้องมีรูปอย่างน้อย 1 รูป");

  const fn = httpsCallable<
    {
      imageRefs: string[];
      stockCatalog: { id: string; name: string; unit: string; aliases?: string[] }[];
      model?: string;
    },
    Record<string, unknown>
  >(getFirebaseFunctions(), "extractStockCostsFromBill", { timeout: 180_000 });

  const result = await fn({
    imageRefs: refs,
    stockCatalog: input.stockCatalog || [],
    ...(input.model ? { model: input.model } : {}),
  });
  const data = result.data || {};
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines: BillCostLineProposal[] = rawLines.map((row) => {
    const d = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const price = Number(d.price);
    const unitCost = Number(d.unitCost);
    const packSize = Number(d.packSize);
    return {
      name: String(d.name || "").trim(),
      packSize: Number.isFinite(packSize) && packSize > 0 ? packSize : null,
      packUnit: String(d.packUnit || "").trim(),
      price: Number.isFinite(price) && price > 0 ? price : null,
      unitCost: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : null,
      baseUnit: String(d.baseUnit || "ก.").trim() || "ก.",
      matchStockItemId: d.matchStockItemId ? String(d.matchStockItemId) : null,
      matchStockName: d.matchStockName ? String(d.matchStockName) : null,
      confidence: Number(d.confidence) || 0,
      note: String(d.note || "").trim(),
    };
  });

  return {
    lines,
    model: String(data.model || ""),
    usedImages: Number(data.usedImages) || 0,
    reason: String(data.reason || "").trim(),
  };
}

export async function analyzeMenuSopCost(input: {
  sop: {
    name: string;
    yieldQty: number;
    yieldUnit: string;
    pieceWeightG?: number;
    ingredientsText?: string;
    steps: { title: string; body: string }[];
    ingredients: { id: string; nameFreeText: string; qty: number; unit: string }[];
  };
  stockCatalog: {
    id: string;
    name: string;
    unit: string;
    unitCost: number;
    aliases?: string[];
  }[];
  model?: string;
}): Promise<AnalyzeMenuSopCostResult> {
  try {
    const fn = httpsCallable<typeof input, Record<string, unknown>>(
      getFirebaseFunctions(),
      "analyzeMenuSopCost",
      { timeout: 120_000 },
    );
    const result = await fn(input);
    const data = result.data || {};
    const rawLinks = Array.isArray(data.links) ? data.links : [];
    const links: SopLinkProposal[] = rawLinks.map((row) => {
      const d = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return {
        ingredientId: String(d.ingredientId || "").trim(),
        ingredientName: String(d.ingredientName || "").trim(),
        stockItemId: d.stockItemId ? String(d.stockItemId) : null,
        stockName: d.stockName ? String(d.stockName) : null,
        qty: Number(d.qty) || 0,
        unit: String(d.unit || "ก.").trim() || "ก.",
        note: String(d.note || "").trim(),
      };
    });
    const batch = Number(data.batchCostEstimate);
    const piece = Number(data.perPieceEstimate);
    return {
      links,
      batchCostEstimate: Number.isFinite(batch) ? batch : null,
      perPieceEstimate: Number.isFinite(piece) ? piece : null,
      model: String(data.model || ""),
      reason: String(data.reason || "").trim(),
    };
  } catch (e) {
    // ฟังก์ชันยังไม่ขึ้น / AI ล่ม — แยกสูตรท้องถิ่นให้พนักงานใช้ต่อได้
    const code = String((e as { code?: string })?.code || "");
    if (
      /not-found|internal|unavailable|failed-precondition|unauthenticated/i.test(
        code,
      ) ||
      /not-found|internal|unavailable|API key|ปิดการจัดประเภท/i.test(
        String((e as Error)?.message || ""),
      )
    ) {
      return analyzeMenuSopCostLocal(input);
    }
    throw e;
  }
}

/** แยกข้อความส่วนผสม → ปริมาณ/หน่วย + จับคู่แคตตาล็อก (ไม่ใช้ Gemini) */
export function parseIngredientsTextLocal(text: string): {
  name: string;
  qty: number;
  unit: string;
}[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const unitTok =
    "(?:มล\\.?|ml|ก\\.?|กรัม|g|กก\\.?|kg|ลิตร|ล\\.?|ชิ้น|ช้อนชา|ชช\\.?|ช้อนดำ|ฟอง)";
  const chunks = raw
    .split(
      new RegExp(
        String.raw`\n|\+|·|•|,(?=\s*[^0-9])|(?<=\d\s*${unitTok})\s+(?=[\u0E00-\u0E7F])`,
        "i",
      ),
    )
    .map((s) =>
      s
        .replace(/\(.*?\)/g, " ")
        .replace(/ไม่พูน/gi, " ")
        // ปริมาณเสิร์ฟบนแก้ว ไม่ใช่ปริมาณวัตถุดิบ (\b ท้ายไทยใช้ไม่ได้)
        .replace(/1\s*แก้ว/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((s) => !/^\(?\s*1\s*แก้ว/i.test(s) && !/^ไม่พูน$/i.test(s));

  const out: { name: string; qty: number; unit: string }[] = [];
  for (const chunk of chunks) {
    let s = chunk
      .replace(/\(.*?\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!s || s.length < 2) continue;
    // ชื่อ … จำนวน หน่วย
    const m = s.match(
      new RegExp(
        String.raw`^(.+?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(${unitTok})?`,
        "i",
      ),
    );
    if (m) {
      let unit = String(m[3] || "ก.").toLowerCase();
      if (/^ml|มล/.test(unit)) unit = "มล.";
      else if (/^g$|^กรัม|^ก\.?$/.test(unit)) unit = "ก.";
      else if (/กก|kg/.test(unit)) unit = "กก.";
      else if (/ลิตร|^ล\.?$/.test(unit)) unit = "ล.";
      else if (/ช้อน|ชช/.test(unit)) unit = "ก.";
      else if (/ชิ้น/.test(unit)) unit = "ชิ้น";
      else if (/ฟอง/.test(unit)) unit = "ชิ้น";
      else unit = "ก.";
      const name = m[1]
        .replace(/[.+=]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name) out.push({ name, qty: Number(m[2]) || 0, unit });
      continue;
    }
    // ไม่มีตัวเลข — เก็บชื่อไว้ให้แก้ปริมาณเอง
    const nameOnly = s.replace(/[.+=]+$/g, "").trim();
    if (nameOnly && !/น้ำแข็ง\+|เติมโซดา|ตกแต่ง/.test(nameOnly)) {
      out.push({ name: nameOnly, qty: 0, unit: "ก." });
    }
  }
  return out.slice(0, 40);
}

function matchCatalogId(
  name: string,
  catalog: { id: string; name: string; aliases?: string[] }[],
): { id: string; name: string } | null {
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!key) return null;
  for (const c of catalog) {
    const cn = c.name.trim().toLowerCase().replace(/\s+/g, "");
    if (cn === key) return { id: c.id, name: c.name };
    for (const a of c.aliases || []) {
      if (a.trim().toLowerCase().replace(/\s+/g, "") === key) {
        return { id: c.id, name: c.name };
      }
    }
  }
  if (key.length >= 3) {
    for (const c of catalog) {
      const names = [c.name, ...(c.aliases || [])];
      for (const n of names) {
        const nk = n.trim().toLowerCase().replace(/\s+/g, "");
        if (nk.includes(key) || key.includes(nk)) {
          return { id: c.id, name: c.name };
        }
      }
    }
  }
  return null;
}

export function analyzeMenuSopCostLocal(input: {
  sop: {
    ingredientsText?: string;
    ingredients: { id: string; nameFreeText: string; qty: number; unit: string }[];
  };
  stockCatalog: {
    id: string;
    name: string;
    unit: string;
    unitCost: number;
    aliases?: string[];
  }[];
}): AnalyzeMenuSopCostResult {
  const text = String(input.sop.ingredientsText || "").trim();
  const parsed = text
    ? parseIngredientsTextLocal(text)
    : input.sop.ingredients.map((i) => ({
        name: i.nameFreeText,
        qty: i.qty,
        unit: i.unit,
      }));
  const links: SopLinkProposal[] = parsed.map((p, i) => {
    const hit = matchCatalogId(p.name, input.stockCatalog);
    const existing = input.sop.ingredients[i];
    return {
      ingredientId: existing?.id || `ing_${Math.random().toString(36).slice(2, 10)}`,
      ingredientName: p.name,
      stockItemId: hit?.id || null,
      stockName: hit?.name || null,
      qty: p.qty,
      unit: p.unit || "ก.",
      note: hit ? "จับคู่ท้องถิ่น" : "ยังไม่คู่ในคลัง/เบส",
    };
  });
  return {
    links,
    batchCostEstimate: null,
    perPieceEstimate: null,
    model: "local-parse",
    reason: "แยกสูตรแบบท้องถิ่น (AI คลาวด์ยังไม่พร้อม) — ตรวจปริมาณแล้วกดตกลง",
  };
}
