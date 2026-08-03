/**
 * โนตกิจการ — เจ้าของจดโนตทั่วไป (ขยายแท็บได้ภายหลัง)
 * เก็บที่ meta/businessNotes · อ่าน/เขียนเฉพาะเจ้าของ
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const BUSINESS_NOTES_DOC = "businessNotes";

/** แท็บที่มีตอนนี้ — เพิ่ม id ใหม่ได้โดยไม่พังข้อมูลเก่า */
export const BUSINESS_NOTES_TABS = [
  { id: "general", label: "ทั่วไป" },
] as const;

export type BusinessNotesTabId = (typeof BUSINESS_NOTES_TABS)[number]["id"];

export type BusinessNoteRow = {
  id: string;
  text: string;
  updatedAt: number;
};

export type BusinessNotesDoc = {
  /** แถวในแต่ละแท็บ — คีย์ = tab id */
  byTab: Record<string, BusinessNoteRow[]>;
  updatedAt: number;
  updatedBy: string;
};

const EMPTY: BusinessNotesDoc = {
  byTab: { general: [] },
  updatedAt: 0,
  updatedBy: "",
};

function newRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createBusinessNoteRow(text = "", now = Date.now()): BusinessNoteRow {
  return {
    id: newRowId(),
    text: String(text || ""),
    updatedAt: now,
  };
}

export function normalizeBusinessNotes(
  data?: Record<string, unknown> | null,
): BusinessNotesDoc {
  const byTab: Record<string, BusinessNoteRow[]> = {};
  const rawByTab =
    data?.byTab && typeof data.byTab === "object" && !Array.isArray(data.byTab)
      ? (data.byTab as Record<string, unknown>)
      : null;

  const tabIds = new Set<string>(BUSINESS_NOTES_TABS.map((t) => t.id));
  if (rawByTab) {
    for (const key of Object.keys(rawByTab)) tabIds.add(key);
  }

  for (const tabId of tabIds) {
    const rawRows = Array.isArray(rawByTab?.[tabId])
      ? (rawByTab![tabId] as unknown[])
      : Array.isArray(data?.rows) && tabId === "general"
        ? (data!.rows as unknown[])
        : [];
    const rows: BusinessNoteRow[] = [];
    for (const row of rawRows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id =
        typeof r.id === "string" && r.id.trim() ? r.id.trim() : newRowId();
      const text = typeof r.text === "string" ? r.text : "";
      rows.push({
        id,
        text,
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
      });
    }
    byTab[tabId] = rows;
  }

  if (!byTab.general) byTab.general = [];

  return {
    byTab,
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "",
  };
}

export function rowsForTab(
  docData: BusinessNotesDoc,
  tabId: string,
): BusinessNoteRow[] {
  return Array.isArray(docData.byTab[tabId]) ? docData.byTab[tabId] : [];
}

/** ตัดแถวว่างท้าย (เก็บแถวว่างกลางไว้) ก่อนเซฟ */
export function compactBusinessNoteRows(rows: BusinessNoteRow[]): BusinessNoteRow[] {
  const next = rows.map((r) => ({
    id: r.id,
    text: String(r.text || ""),
    updatedAt: Number(r.updatedAt) || 0,
  }));
  while (next.length > 0 && !next[next.length - 1].text.trim()) {
    next.pop();
  }
  return next;
}

export async function loadBusinessNotes(): Promise<BusinessNotesDoc> {
  try {
    const snap = await getDoc(doc(getDb(), "meta", BUSINESS_NOTES_DOC));
    if (!snap.exists()) return { ...EMPTY, byTab: { general: [] } };
    return normalizeBusinessNotes(snap.data() as Record<string, unknown>);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "โหลดโนตกิจการ", "staff"));
  }
}

export async function saveBusinessNotes(
  byTab: Record<string, BusinessNoteRow[]>,
  actor: string,
): Promise<BusinessNotesDoc> {
  const cleaned: Record<string, BusinessNoteRow[]> = {};
  for (const [tabId, rows] of Object.entries(byTab || {})) {
    cleaned[tabId] = compactBusinessNoteRows(rows || []);
  }
  if (!cleaned.general) cleaned.general = [];

  const next: BusinessNotesDoc = {
    byTab: cleaned,
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
  };
  try {
    await setDoc(doc(getDb(), "meta", BUSINESS_NOTES_DOC), next, { merge: true });
    return next;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกโนตกิจการ", "staff"));
  }
}
