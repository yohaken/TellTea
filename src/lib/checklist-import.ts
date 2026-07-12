import {
  addEmployee,
  listEmployees,
  type Employee,
} from "./employees";
import {
  DEFAULT_CHECKLIST_ITEMS,
  listChecklistItems,
  newCheckId,
  seedChecklistItemsIfEmpty,
  type CheckShiftId,
  type CheckStatus,
  type ChecklistItem,
} from "./checklist";
import { getDb } from "./firebase";
import { collection, doc, writeBatch } from "firebase/firestore";

export type ParsedCheckSession = {
  date: number;
  shift: CheckShiftId;
  inspector: string;
  items: { itemName: string; status: CheckStatus; remark: string }[];
  sourceRow: number;
};

export type ChecklistImportResult = {
  sessions: number;
  records: number;
  skipped: number;
  newEmployees: number;
};

const ITEM_MATCHERS: { name: string; keys: string[] }[] = [
  { name: "กลุ่มเบสนม", keys: ["เบสนม", "กลุ่มเบสนม"] },
  { name: "กลุ่มเบสชา", keys: ["เบสชา", "กลุ่มเบสชา"] },
  { name: "ครีมชีส", keys: ["ครีมชีส"] },
  { name: "ขนมปัง", keys: ["ขนมปัง"] },
  { name: "ไอศกรีม", keys: ["ไอศกรีม"] },
  { name: "นมสด", keys: ["นมสด"] },
  { name: "วัตถุดิบอื่น", keys: ["วัตถุดิบอื่น", "วัตถุดิบ"] },
  { name: "น้ำเต้าหู้", keys: ["น้ำเต้าหู้", "เต้าหู้"] },
  { name: "น้ำมะพร้าว", keys: ["น้ำมะพร้าว", "มะพร้าว"] },
  { name: "ท็อปปิ้งในตู้เย็น", keys: ["ท็อปปิ้ง", "ตู้เย็น"] },
  { name: "เครื่องไอศกรีม", keys: ["เครื่องไอศกรีม"] },
  { name: "แอร์ ความเย็น", keys: ["แอร์", "ความเย็น"] },
  { name: "กลิ่นภายในร้าน", keys: ["กลิ่น"] },
  { name: "เปิดปิดเมนูตัวเลือกให้ถูกต้องทุกแอพ", keys: ["เมนู", "แอพ", "ตัวเลือก"] },
  { name: "เครื่องกาแฟ ล้าง เช็ค ปรับปรุง", keys: ["กาแฟ", "เครื่องกาแฟ"] },
];

function norm(s: string) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9]/g, "")
    .toLowerCase();
}

function parseCsvRows(text: string): string[][] {
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

export function parseCheckShift(raw: string): CheckShiftId | null {
  const t = String(raw || "").trim();
  if (t.includes("ดึก")) return "late";
  if (t.includes("เช้า")) return "morning";
  if (t.includes("เย็น")) return "evening";
  return null;
}

export function parseCheckStatus(raw: string): CheckStatus | null {
  const s = String(raw || "").trim();
  if (!s || s === "-" || s === "—") return null;
  if (s.includes("ไม่ผ่าน") || s.includes("ไม่ ผ่าน")) return "fail";
  if (s.includes("ผ่าน")) return "pass";
  return null;
}

function matchItemName(header: string): string | null {
  const h = norm(header);
  if (!h || h.includes("วันที่") || h.includes("ผู้ตรวจ") || h.includes("รอบ")) return null;
  for (const m of ITEM_MATCHERS) {
    for (const key of m.keys) {
      if (h.includes(norm(key))) return m.name;
    }
  }
  for (const d of DEFAULT_CHECKLIST_ITEMS) {
    if (h.includes(norm(d.name))) return d.name;
  }
  return null;
}

function findHeaderRow(rows: string[][]) {
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const score = (rows[i] || []).filter((c) => matchItemName(c)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { headerIdx: bestIdx, score: bestScore };
}

function colIndex(headers: string[], ...needles: string[]) {
  const idx = headers.findIndex((h) => {
    const n = norm(h);
    return needles.some((x) => n.includes(norm(x)));
  });
  return idx >= 0 ? idx : null;
}

export function parseChecklistCsv(
  text: string,
  year = 2026,
  month = 7,
): { sessions: ParsedCheckSession[]; skipped: { row: number; reason: string }[] } {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return { sessions: [], skipped: [{ row: 0, reason: "empty-file" }] };

  const { headerIdx, score } = findHeaderRow(rows);
  if (score < 2) {
    return { sessions: [], skipped: [{ row: headerIdx + 1, reason: "no-item-headers" }] };
  }

  const headers = rows[headerIdx] || [];
  const itemCols: { col: number; itemName: string }[] = [];
  headers.forEach((h, col) => {
    const name = matchItemName(h);
    if (name) itemCols.push({ col, itemName: name });
  });

  const dateCol = colIndex(headers, "วันที่") ?? 0;
  const inspectorCol = colIndex(headers, "ผู้ตรวจ");
  const shiftCol = colIndex(headers, "รอบงาน", "รอบ", "กะ");

  const sessions: ParsedCheckSession[] = [];
  const skipped: { row: number; reason: string }[] = [];
  let carryDay: number | null = null;

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    while (row.length < headers.length) row.push("");

    const dayRaw = String(row[dateCol] || "").trim();
    if (dayRaw) {
      const day = Number(dayRaw.replace(/[^\d]/g, ""));
      if (day >= 1 && day <= 31) carryDay = day;
    }

    let shift: CheckShiftId | null = shiftCol != null ? parseCheckShift(row[shiftCol] || "") : null;
    if (!shift) {
      for (const cell of row) {
        shift = parseCheckShift(cell);
        if (shift) break;
      }
    }

    let inspector =
      inspectorCol != null ? String(row[inspectorCol] || "").trim() : "";
    if (!inspector) {
      for (let c = 0; c < Math.min(row.length, 4); c += 1) {
        const v = String(row[c] || "").trim();
        if (v && !parseCheckShift(v) && !/^\d+$/.test(v) && v.length <= 20) {
          inspector = v;
          break;
        }
      }
    }
    inspector = inspector.replace(/^-\s*/, "").trim();

    if (carryDay == null) {
      skipped.push({ row: i + 1, reason: "no-day" });
      continue;
    }
    if (!shift) {
      skipped.push({ row: i + 1, reason: "no-shift" });
      continue;
    }

    const items: ParsedCheckSession["items"] = [];
    for (const { col, itemName } of itemCols) {
      const status = parseCheckStatus(row[col] || "");
      if (!status) continue;
      items.push({
        itemName,
        status,
        remark: status === "fail" ? String(row[col] || "").trim() : "",
      });
    }

    if (!items.length) {
      skipped.push({ row: i + 1, reason: "no-status-cells" });
      continue;
    }

    if (!inspector) inspector = "—";

    const date = new Date(year, month - 1, carryDay).getTime();
    sessions.push({ date, shift, inspector, items, sourceRow: i + 1 });
  }

  return { sessions, skipped };
}

function shiftHour(shift: CheckShiftId) {
  if (shift === "morning") return 8;
  if (shift === "evening") return 17;
  return 1;
}

async function ensureEmployees(names: string[]): Promise<{ byName: Map<string, Employee>; newCount: number }> {
  const existing = await listEmployees();
  const byName = new Map(existing.map((e) => [e.name, e]));
  let newCount = 0;

  for (const name of names) {
    if (!name || name === "—" || byName.has(name)) continue;
    const id = await addEmployee(name);
    byName.set(name, {
      id,
      name,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    newCount += 1;
  }

  return { byName, newCount };
}

export async function importChecklistSessions(
  sessions: ParsedCheckSession[],
  createdBy: string,
): Promise<ChecklistImportResult> {
  if (!sessions.length) throw new Error("ไม่มีข้อมูลที่นำเข้าได้");

  await seedChecklistItemsIfEmpty();
  const catalog = await listChecklistItems();
  const itemIdByName = new Map(catalog.map((i: ChecklistItem) => [i.name, i.id]));

  const inspectors = [...new Set(sessions.map((s) => s.inspector).filter((n) => n && n !== "—"))];
  const { byName: empByName, newCount: newEmployees } = await ensureEmployees(inspectors);

  const col = collection(getDb(), "checklistRecords");
  let records = 0;
  const batchSize = 400;
  let batch = writeBatch(getDb());
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = writeBatch(getDb());
    ops = 0;
  }

  for (const session of sessions) {
    const checkId = newCheckId();
    const inspectorId = empByName.get(session.inspector)?.id || "";
    const submittedAt = session.date + shiftHour(session.shift) * 3600000;

    for (const item of session.items) {
      const itemId = itemIdByName.get(item.itemName) || item.itemName;
      const ref = doc(col);
      batch.set(ref, {
        checkId,
        date: session.date,
        shift: session.shift,
        inspector: session.inspector,
        inspectorId,
        itemId,
        itemName: item.itemName,
        status: item.status,
        remark: item.remark,
        imageUrl: "",
        submittedAt,
        createdBy,
        createdAt: Date.now(),
      });
      records += 1;
      ops += 1;
      if (ops >= batchSize) await flush();
    }
  }
  await flush();

  return {
    sessions: sessions.length,
    records,
    skipped: 0,
    newEmployees,
  };
}

export async function importChecklistCsvText(
  text: string,
  createdBy: string,
  year = 2026,
  month = 7,
): Promise<ChecklistImportResult & { parseSkipped: number }> {
  const { sessions, skipped } = parseChecklistCsv(text, year, month);
  if (!sessions.length) {
    throw new Error(
      skipped.length
        ? `parse ไม่ได้ — ข้าม ${skipped.length} แถว (เช่น แถว ${skipped[0]?.row}: ${skipped[0]?.reason})`
        : "ไม่พบข้อมูลในไฟล์",
    );
  }
  const result = await importChecklistSessions(sessions, createdBy);
  return { ...result, parseSkipped: skipped.length };
}
