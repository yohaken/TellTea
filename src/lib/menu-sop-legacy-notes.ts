/**
 * สูตรเดิม (ส่วนผสม) สำหรับปุ่ม «ดึงสูตรเดิม» — ถามก่อนใส่
 * ไม่ใช้โน้ตจับคู่คลังจากชีตใน UI อีกแล้ว
 */
import legacy from "@/lib/data/legacy-sop-notes.json";

export type LegacySopDraft = {
  sheetName: string;
  ingredientsText: string;
  makeStepsText: string;
  description: string;
  sellStepsText: string;
};

type LegacyFile = {
  draftByLiveName?: Record<string, LegacySopDraft>;
  sourceSheetId?: string;
  updatedAt?: string;
  matchPolicy?: string;
  summary?: Record<string, number>;
};

const data = legacy as LegacyFile;
const draftByLiveName = data.draftByLiveName || {};

/** สูตรเดิมสำหรับปุ่มดึง — มีเฉพาะรายการที่จับคู่ชื่อแล้ว */
export function legacySopDraftForName(name: string): LegacySopDraft | null {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (draftByLiveName[raw]) return draftByLiveName[raw];
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(draftByLiveName)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

export const LEGACY_SOP_NOTES_META = {
  sourceSheetId: data.sourceSheetId || "",
  updatedAt: data.updatedAt || "",
  matchPolicy: data.matchPolicy || "",
  summary: data.summary || {},
};
