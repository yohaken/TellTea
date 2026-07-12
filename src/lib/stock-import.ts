import { collection, doc, writeBatch } from "firebase/firestore";
import { stockCountSessionId } from "./stock-count";
import { DEFAULT_STOCK_ITEMS, listStockItems } from "./stock";
import { getDb } from "./firebase";
import type { StockCountRound, StockMovementType } from "./types";

export type ParsedStockCount = { date: number; qty: number };

export type ParsedStockProduct = {
  name: string;
  unit: string;
  qty: number;
  minQty: number;
  safetyStock: number;
  unitCost: number;
  barcode: string;
  counts: ParsedStockCount[];
  sourceRow: number;
};

export type ParsedStockMovement = {
  itemName: string;
  type: StockMovementType;
  quantity: number;
  date: number;
  remark: string;
};

export type StockImportPreview = {
  products: ParsedStockProduct[];
  movements: ParsedStockMovement[];
  skipped: { row: number; reason: string; detail?: string }[];
  format: "catalog" | "grid" | "transposed";
};

export type StockImportResult = {
  productsCreated: number;
  productsUpdated: number;
  movements: number;
  sessions: number;
  parseSkipped: number;
};

const PRODUCT_ALIASES: { canonical: string; keys: string[] }[] = [
  { canonical: "ถุงเก็บความเย็น", keys: ["ถุงเก็บความเย็น", "ถุงเก็บ"] },
  { canonical: "ถุงกระดาษเบเกอรี่", keys: ["ถุงกระดาษเบเกอรี่", "ถุงกระดาษ", "กระดาษเบเกอรี่"] },
  { canonical: "แก้วชา", keys: ["แก้วชา", "แก้ว"] },
  { canonical: "หลอดใหญ่", keys: ["หลอดใหญ่", "หลอดใหญ่-"] },
  { canonical: "หลอดเล็ก 0.5 มล", keys: ["หลอดเล็ก0.5มล", "หลอดเล็ก", "หลอด0.5"] },
  { canonical: "ฝาซีล", keys: ["ฝาซีล", "ฝา"] },
  { canonical: "โซดา", keys: ["โซดา"] },
  { canonical: "โคน S", keys: ["โคนs", "cones", "cone s"] },
  { canonical: "โคน M", keys: ["โคนm", "cone m"] },
  { canonical: "โคน L", keys: ["โคนl", "cone l"] },
  { canonical: "IC.นม", keys: ["ic.นม", "icนม", "ไอซีนม"] },
  { canonical: "IC.รสอื่นๆ", keys: ["ic.รสอื่น", "icรส", "ไอซีรส"] },
];

const SKIP_ROW_KEYS = [
  "รายการ",
  "ชื่อ",
  "สินค้า",
  "วันที่",
  "รวม",
  "สรุป",
  "หมายเหตุ",
  "item",
  "product",
  "stock",
];

function norm(s: string) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9.]/g, "")
    .toLowerCase();
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r") i += 1;
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

function toNumber(v: string): number | null {
  const t = String(v || "").trim();
  if (!t || t === "-" || t === "—") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function canonicalProductName(raw: string): string {
  const n = norm(raw);
  if (!n) return raw.trim();
  for (const alias of PRODUCT_ALIASES) {
    for (const key of alias.keys) {
      if (n === norm(key) || n.includes(norm(key))) return alias.canonical;
    }
  }
  for (const item of DEFAULT_STOCK_ITEMS) {
    if (n === norm(item.name) || n.includes(norm(item.name))) return item.name;
  }
  return raw.trim();
}

function isSkipRowName(raw: string) {
  const n = norm(raw);
  if (!n) return true;
  return SKIP_ROW_KEYS.some((k) => n === norm(k) || n.startsWith(norm(k)));
}

function colIndex(headers: string[], ...needles: string[]): number | null {
  const idx = headers.findIndex((h) => {
    const n = norm(h);
    return needles.some((x) => n.includes(norm(x)));
  });
  return idx >= 0 ? idx : null;
}

export function parseDateHeader(cell: string, year: number, month: number): number | null {
  const t = String(cell || "").trim();
  if (!t) return null;

  const dmy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (dmy) {
    const day = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = dmy[3]
      ? dmy[3].length === 2
        ? 2000 + Number(dmy[3])
        : Number(dmy[3])
      : year;
    if (day >= 1 && day <= 31 && mo >= 1 && mo <= 12) {
      return new Date(y, mo - 1, day).getTime();
    }
  }

  const dm = /^(\d{1,2})-(\d{1,2})$/.exec(t);
  if (dm) {
    const day = Number(dm[1]);
    const mo = Number(dm[2]);
    if (day >= 1 && day <= 31 && mo >= 1 && mo <= 12) {
      return new Date(year, mo - 1, day).getTime();
    }
  }

  if (/^\d{1,2}$/.test(t)) {
    const day = Number(t);
    if (day >= 1 && day <= 31) return new Date(year, month - 1, day).getTime();
  }

  return null;
}

function isProductHeader(raw: string) {
  const n = norm(raw);
  if (!n || isSkipRowName(raw)) return false;
  if (parseDateHeader(raw, 2026, 7) != null) return false;
  const canonical = canonicalProductName(raw);
  if (DEFAULT_STOCK_ITEMS.some((d) => d.name === canonical)) return true;
  return /[\u0E00-\u0E7F]/.test(raw) && raw.length >= 2 && raw.length <= 40;
}

function scoreLayout(rows: string[][], year: number, month: number) {
  let bestRowIdx = 0;
  let bestRowScore = 0;
  let bestTransposedIdx = 0;
  let bestTransposedScore = 0;

  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const row = rows[i] || [];
    let rowScore = 0;
    let transposedScore = 0;
    const h0 = norm(row[0] || "");
    if (h0.includes("รายการ") || h0.includes("ชื่อ") || h0.includes("สินค้า")) rowScore += 5;
    if (colIndex(row, "หน่วย") != null) rowScore += 2;
    if (colIndex(row, "คงเหลือ", "qty", "stock", "ยอด") != null) rowScore += 3;
    rowScore += row.filter((c) => parseDateHeader(c, year, month) != null).length * 2;

    if (h0.includes("วันที่") || h0.includes("ช่วง") || h0.includes("date")) transposedScore += 6;
    transposedScore += row.slice(1).filter((c) => isProductHeader(c)).length * 2;

    if (rowScore > bestRowScore) {
      bestRowScore = rowScore;
      bestRowIdx = i;
    }
    if (transposedScore > bestTransposedScore) {
      bestTransposedScore = transposedScore;
      bestTransposedIdx = i;
    }
  }

  const mode = bestTransposedScore > bestRowScore + 2 ? "transposed" : "row";
  return {
    headerIdx: mode === "transposed" ? bestTransposedIdx : bestRowIdx,
    mode,
  } as const;
}

function findHeaderRow(rows: string[][], year: number, month: number): number {
  return scoreLayout(rows, year, month).headerIdx;
}

function parseDateCell(
  cell: string,
  year: number,
  month: number,
  carry?: { day: number | null },
): number | null {
  const fromHeader = parseDateHeader(cell, year, month);
  if (fromHeader != null) return fromHeader;

  const t = String(cell || "").trim();
  if (!t) return null;
  const day = Number(t.replace(/[^\d]/g, ""));
  if (day >= 1 && day <= 31) {
    if (carry) carry.day = day;
    return new Date(year, month - 1, day).getTime();
  }
  if (carry?.day != null) return new Date(year, month - 1, carry.day).getTime();
  return null;
}

function parseTransposedGrid(
  rows: string[][],
  headerIdx: number,
  year: number,
  month: number,
): StockImportPreview {
  const headers = rows[headerIdx] || [];
  const skipped: StockImportPreview["skipped"] = [];
  const productCols: {
    col: number;
    name: string;
    unit: string;
    minQty: number;
    safetyStock: number;
  }[] = [];

  headers.forEach((h, col) => {
    if (col === 0) return;
    const raw = String(h || "").trim();
    if (!isProductHeader(raw)) return;
    const name = canonicalProductName(raw);
    const def = DEFAULT_STOCK_ITEMS.find((d) => d.name === name);
    productCols.push({
      col,
      name,
      unit: def?.unit || "ชิ้น",
      minQty: def?.minQty || 0,
      safetyStock: def?.safetyStock || 0,
    });
  });

  if (!productCols.length) {
    return { products: [], movements: [], skipped: [{ row: headerIdx + 1, reason: "no-products" }], format: "transposed" };
  }

  const countsByProduct = new Map<string, ParsedStockCount[]>();
  let monthCursor = month;
  let yearCursor = year;
  let prevDay: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < headers.length) row.push("");

    const dayCell = String(row[0] || "").trim();
    if (!dayCell) continue;
    const day = Number(dayCell.replace(/[^\d]/g, ""));
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      skipped.push({ row: i + 1, reason: "no-date", detail: dayCell });
      continue;
    }
    if (prevDay != null && day < prevDay) {
      monthCursor += 1;
      if (monthCursor > 12) {
        monthCursor = 1;
        yearCursor += 1;
      }
    }
    prevDay = day;
    const date = new Date(yearCursor, monthCursor - 1, day).getTime();

    let any = false;
    for (const pc of productCols) {
      const val = toNumber(row[pc.col] || "");
      if (val == null) continue;
      any = true;
      const list = countsByProduct.get(pc.name) || [];
      list.push({ date, qty: val });
      countsByProduct.set(pc.name, list);
    }
    if (!any) skipped.push({ row: i + 1, reason: "empty-row" });
  }

  const products: ParsedStockProduct[] = productCols
    .map((pc) => {
      const counts = (countsByProduct.get(pc.name) || []).sort((a, b) => a.date - b.date);
      const qty = counts.length ? counts[counts.length - 1]!.qty : 0;
      return {
        name: pc.name,
        unit: pc.unit,
        qty,
        minQty: pc.minQty,
        safetyStock: pc.safetyStock,
        unitCost: 0,
        barcode: "",
        counts,
        sourceRow: headerIdx + 1,
      };
    })
    .filter((p) => p.counts.length > 0);

  const movements: ParsedStockMovement[] = [];
  for (const p of products) {
    if (p.counts.length > 1) movements.push(...buildMovementsFromCounts(p.name, p.counts));
    else if (p.qty > 0) {
      movements.push({
        itemName: p.name,
        type: "ADJUST",
        quantity: p.qty,
        date: p.counts[0]?.date ?? Date.now(),
        remark: "Import CSV — ยอดจากชีท",
      });
    }
  }

  return { products, movements, skipped, format: "transposed" };
}

function buildMovementsFromCounts(
  itemName: string,
  counts: ParsedStockCount[],
): ParsedStockMovement[] {
  const sorted = [...counts].sort((a, b) => a.date - b.date);
  const moves: ParsedStockMovement[] = [];
  if (!sorted.length) return moves;

  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i]!;
    if (i === 0) {
      if (curr.qty > 0) {
        moves.push({
          itemName,
          type: "ADJUST",
          quantity: curr.qty,
          date: curr.date,
          remark: `Import CSV — ยอดเริ่ม ${curr.qty}`,
        });
      }
      continue;
    }
    const prev = sorted[i - 1]!;
    const delta = curr.qty - prev.qty;
    if (delta === 0) continue;
    moves.push({
      itemName,
      type: delta > 0 ? "IN" : "OUT",
      quantity: Math.abs(delta),
      date: curr.date,
      remark: `Import CSV — ${prev.qty} → ${curr.qty}`,
    });
  }
  return moves;
}

export function parseStockCsv(
  text: string,
  year = 2026,
  month = 7,
): StockImportPreview {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length) {
    return { products: [], movements: [], skipped: [{ row: 0, reason: "empty" }], format: "grid" };
  }

  const layout = scoreLayout(rows, year, month);
  const headerIdx = layout.headerIdx;
  if (layout.mode === "transposed") {
    const transposed = parseTransposedGrid(rows, headerIdx, year, month);
    if (transposed.products.length) return transposed;
    return {
      products: [],
      movements: [],
      skipped: transposed.skipped.length
        ? transposed.skipped
        : [{ row: headerIdx + 1, reason: "transposed-empty" }],
      format: "transposed",
    };
  }

  const headers = rows[headerIdx] || [];
  const skipped: StockImportPreview["skipped"] = [];

  const nameCol = colIndex(headers, "รายการ", "ชื่อ", "สินค้า", "item", "product") ?? 0;
  const unitCol = colIndex(headers, "หน่วย", "unit");
  const qtyCol = colIndex(headers, "คงเหลือ", "qty", "stock", "ยอด", "จำนวน");
  const minCol = colIndex(headers, "จุดสั่ง", "reorder", "min", "เตือน", "สั่งซื้อ");
  const safetyCol = colIndex(headers, "สำรอง", "safety");
  const costCol = colIndex(headers, "ราคา", "cost", "฿", "มูลค่า");
  const barcodeCol = colIndex(headers, "บาร์โค้ด", "barcode");

  const dateCols: { col: number; date: number }[] = [];
  headers.forEach((h, col) => {
    const date = parseDateHeader(h, year, month);
    if (date != null && col !== nameCol) dateCols.push({ col, date });
  });
  dateCols.sort((a, b) => a.date - b.date);

  const isCatalog = qtyCol != null && dateCols.length === 0;
  const format: StockImportPreview["format"] = isCatalog ? "catalog" : "grid";

  const products: ParsedStockProduct[] = [];

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < headers.length) row.push("");

    const rawName = String(row[nameCol] || "").trim();
    if (!rawName || isSkipRowName(rawName)) {
      skipped.push({ row: i + 1, reason: "skip-header", detail: rawName });
      continue;
    }

    const name = canonicalProductName(rawName);
    const unit =
      unitCol != null && row[unitCol]
        ? String(row[unitCol]).trim()
        : DEFAULT_STOCK_ITEMS.find((d) => d.name === name)?.unit || "ชิ้น";
    const minQty = minCol != null ? toNumber(row[minCol] || "") ?? 0 : 0;
    const safetyStock = safetyCol != null ? toNumber(row[safetyCol] || "") ?? 0 : 0;
    const unitCost = costCol != null ? toNumber(row[costCol] || "") ?? 0 : 0;
    const barcode = barcodeCol != null ? String(row[barcodeCol] || "").trim() : "";

    const counts: ParsedStockCount[] = [];
    if (format === "grid") {
      for (const { col, date } of dateCols) {
        const val = toNumber(row[col] || "");
        if (val != null) counts.push({ date, qty: val });
      }
    }

    let qty = qtyCol != null ? toNumber(row[qtyCol] || "") : null;
    if (qty == null && counts.length) qty = counts[counts.length - 1]!.qty;
    if (qty == null) {
      const nums = row
        .map((c, col) => (col === nameCol ? null : toNumber(c)))
        .filter((n): n is number => n != null);
      if (nums.length === 1) qty = nums[0]!;
    }
    if (qty == null) {
      skipped.push({ row: i + 1, reason: "no-qty", detail: name });
      continue;
    }

    products.push({
      name,
      unit,
      qty,
      minQty,
      safetyStock,
      unitCost,
      barcode,
      counts,
      sourceRow: i + 1,
    });
  }

  const movements: ParsedStockMovement[] = [];
  for (const p of products) {
    if (p.counts.length > 1) {
      movements.push(...buildMovementsFromCounts(p.name, p.counts));
    } else if (p.qty > 0) {
      movements.push({
        itemName: p.name,
        type: "ADJUST",
        quantity: p.qty,
        date: p.counts[0]?.date ?? Date.now(),
        remark: "Import CSV — ยอดจากชีท",
      });
    }
  }

  return { products, movements, skipped, format };
}

function isCountRoundDay(day: number): day is StockCountRound {
  return day === 1 || day === 10 || day === 20;
}

export type ParsedCountSession = {
  year: number;
  month: number;
  dayOfMonth: StockCountRound;
  date: number;
  lines: { itemId: string; itemName: string; qty: number }[];
};

export function buildCountSessionsFromPreview(
  preview: StockImportPreview,
  itemIdByName: Map<string, string>,
): ParsedCountSession[] {
  const sessionMap = new Map<string, ParsedCountSession>();

  for (const p of preview.products) {
    const itemId = itemIdByName.get(norm(p.name));
    if (!itemId) continue;
    for (const c of p.counts) {
      const d = new Date(c.date);
      const day = d.getDate();
      if (!isCountRoundDay(day)) continue;
      const year = d.getFullYear();
      const month = d.getMonth();
      const key = stockCountSessionId(year, month, day);
      let session = sessionMap.get(key);
      if (!session) {
        session = { year, month, dayOfMonth: day, date: c.date, lines: [] };
        sessionMap.set(key, session);
      }
      session.lines.push({ itemId, itemName: p.name, qty: c.qty });
    }
  }

  return [...sessionMap.values()]
    .filter((s) => s.lines.length > 0)
    .sort((a, b) => a.date - b.date);
}

function stockDocFields(
  input: {
    name: string;
    unit: string;
    qty: number;
    minQty: number;
    safetyStock: number;
    unitCost: number;
    barcode: string;
    updatedBy: string;
  },
  now: number,
) {
  return {
    name: input.name,
    unit: input.unit,
    qty: input.qty,
    minQty: input.minQty,
    safetyStock: input.safetyStock,
    unitCost: input.unitCost,
    barcode: input.barcode || null,
    note: "",
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
}

export async function importStockCsvText(
  text: string,
  createdBy: string,
  year = 2026,
  month = 7,
): Promise<StockImportResult> {
  const preview = parseStockCsv(text, year, month);
  if (!preview.products.length) {
    throw new Error(
      preview.skipped.length
        ? `อ่านไฟล์ไม่ได้ — ข้าม ${preview.skipped.length} แถว`
        : "ไม่พบรายการวัตถุดิบในไฟล์",
    );
  }

  const existing = await listStockItems();
  const byName = new Map(existing.map((i) => [norm(i.name), i]));
  const now = Date.now();
  const db = getDb();

  let productsCreated = 0;
  let productsUpdated = 0;
  let movementCount = 0;
  let sessionCount = 0;

  let batch = writeBatch(db);
  let ops = 0;

  async function flush() {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }

  const itemIdByName = new Map<string, string>();

  for (const p of preview.products) {
    const key = norm(p.name);
    const hit = byName.get(key);
    const ref = hit ? doc(db, "stock", hit.id) : doc(collection(db, "stock"));
    if (!hit) {
      productsCreated += 1;
      itemIdByName.set(key, ref.id);
    } else {
      productsUpdated += 1;
      itemIdByName.set(key, hit.id);
    }

    batch.set(
      ref,
      stockDocFields(
        {
          name: p.name,
          unit: p.unit,
          qty: p.qty,
          minQty: p.minQty,
          safetyStock: p.safetyStock,
          unitCost: p.unitCost,
          barcode: p.barcode,
          updatedBy: createdBy,
        },
        now,
      ),
    );
    ops += 1;
    if (ops >= 400) await flush();
  }

  const parsedSessions = buildCountSessionsFromPreview(preview, itemIdByName);
  for (const s of parsedSessions) {
    const id = stockCountSessionId(s.year, s.month, s.dayOfMonth);
    const sessionRef = doc(db, "stockCountSessions", id);
    batch.set(sessionRef, {
      date: s.date,
      dayOfMonth: s.dayOfMonth,
      year: s.year,
      month: s.month,
      inspector: "Import CSV",
      inspectorId: null,
      submittedAt: s.date,
      createdBy,
      lines: s.lines.map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        qty: line.qty,
      })),
      updatedAt: now,
      source: "csv-import",
    });
    sessionCount += 1;
    ops += 1;
    if (ops >= 400) await flush();
  }

  for (const m of preview.movements) {
    if (parsedSessions.length) continue;
    const itemId = itemIdByName.get(norm(m.itemName));
    if (!itemId) continue;
    const moveRef = doc(collection(db, "stockMovements"));
    batch.set(moveRef, {
      itemId,
      itemName: m.itemName,
      type: m.type,
      quantity: m.quantity,
      date: m.date,
      inspector: createdBy,
      remark: m.remark,
      createdAt: now,
      createdBy,
    });
    movementCount += 1;
    ops += 1;
    if (ops >= 400) await flush();
  }

  await flush();

  return {
    productsCreated,
    productsUpdated,
    movements: movementCount,
    sessions: sessionCount,
    parseSkipped: preview.skipped.length,
  };
}

export function previewStockImportLabel(preview: StockImportPreview): string {
  const sessionCount = buildCountSessionsFromPreview(
    preview,
    new Map(preview.products.map((p) => [norm(p.name), "x"])),
  ).length;
  const moveIn = preview.movements.filter((m) => m.type === "IN").length;
  const moveOut = preview.movements.filter((m) => m.type === "OUT").length;
  const moveAdj = preview.movements.filter((m) => m.type === "ADJUST").length;
  return (
    `พบ ${preview.products.length} รายการ (${preview.format})` +
    (sessionCount ? ` · ${sessionCount} รอบนับ` : "") +
    (sessionCount ? "" : ` · IN ${moveIn} · OUT ${moveOut} · ADJ ${moveAdj}`) +
    (preview.skipped.length ? ` · ข้าม ${preview.skipped.length} แถว` : "")
  );
}
