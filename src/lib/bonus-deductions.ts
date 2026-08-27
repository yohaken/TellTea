import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type BonusDeductionRuleId = "generalFail" | "waste";

export type BonusDeductionRule = {
  id: BonusDeductionRuleId;
  label: string;
  pctPerUnit: number;
};

export type BonusDeductionSettings = {
  rules: BonusDeductionRule[];
  updatedAt: number;
};

/** จำนวนหักทั้งร้านต่อเดือน — เจ้าของกรอกสิ้นเดือน */
export type BonusDeductionMonthCounts = Record<BonusDeductionRuleId, number>;

/** รูปหลักฐานต่อกองต่องวด (ระวัง / ตัด) */
export const BONUS_DEDUCTION_EVIDENCE_MAX = 8;

export type BonusEvidencePileId = "caution" | "cut";

export type BonusDeductionMonthDoc = {
  year: number;
  month: number;
  counts: BonusDeductionMonthCounts;
  /**
   * กองตัด — แคปสาเหตุตัดคะแนน / ฟีดแบคที่หักโบนัสจริง
   * (ฟิลด์เดิม evidenceUrls — คงชื่อเพื่อไม่พังข้อมูลเก่า)
   */
  evidenceUrls: string[];
  /** โน้ตกองตัด */
  note: string;
  /** กองระวัง — เตือน/ให้ระมัดระวัง ไม่ตัดโบนัส */
  cautionUrls: string[];
  /** โน้ตกองระวัง */
  cautionNote: string;
  updatedAt: number;
};

export type BonusDeductionLine = {
  id: BonusDeductionRuleId;
  label: string;
  qty: number;
  ratePct: number;
  linePct: number;
};

export const DEFAULT_BONUS_DEDUCTION_RULES: BonusDeductionRule[] = [
  { id: "generalFail", label: "ผิดพลาดทั่วไป", pctPerUnit: 1 },
  { id: "waste", label: "ของเสีย", pctPerUnit: 3 },
];

export const EMPTY_BONUS_DEDUCTION_COUNTS: BonusDeductionMonthCounts = {
  generalFail: 0,
  waste: 0,
};

function settingsRef() {
  return doc(getDb(), "meta", "bonusDeductionSettings");
}

function monthRef(year: number, month: number) {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  return doc(getDb(), "bonusDeductionMonths", key);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeRule(raw: Partial<BonusDeductionRule>, fallback: BonusDeductionRule): BonusDeductionRule {
  return {
    id: fallback.id,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : fallback.label,
    pctPerUnit: Math.max(0, Number(raw.pctPerUnit) || fallback.pctPerUnit),
  };
}

export function normalizeBonusDeductionSettings(
  data: Partial<BonusDeductionSettings> | undefined,
): BonusDeductionSettings {
  const rules = DEFAULT_BONUS_DEDUCTION_RULES.map((fallback) => {
    const hit = data?.rules?.find((r) => r.id === fallback.id);
    return normalizeRule(hit || {}, fallback);
  });
  return {
    rules,
    updatedAt: Number(data?.updatedAt) || 0,
  };
}

function normalizeMonthCounts(raw: Partial<BonusDeductionMonthCounts> | undefined): BonusDeductionMonthCounts {
  return {
    generalFail: Math.max(0, Number(raw?.generalFail) || 0),
    waste: Math.max(0, Number(raw?.waste) || 0),
  };
}

function normalizeEvidenceUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, BONUS_DEDUCTION_EVIDENCE_MAX);
}

/** รองรับข้อมูลเก่าที่เก็บแยกรายคน — ไม่ migrate อัตโนมัติ */
export function normalizeBonusDeductionMonthDoc(
  year: number,
  month: number,
  data: Partial<BonusDeductionMonthDoc & { workers?: unknown }> | undefined,
): BonusDeductionMonthDoc {
  return {
    year,
    month,
    counts: normalizeMonthCounts(data?.counts),
    evidenceUrls: normalizeEvidenceUrls(data?.evidenceUrls),
    note: typeof data?.note === "string" ? data.note.trim() : "",
    cautionUrls: normalizeEvidenceUrls(data?.cautionUrls),
    cautionNote: typeof data?.cautionNote === "string" ? data.cautionNote.trim() : "",
    updatedAt: Number(data?.updatedAt) || 0,
  };
}

export function bonusEvidencePileHasContent(
  doc: Pick<BonusDeductionMonthDoc, "cautionUrls" | "cautionNote" | "evidenceUrls" | "note">,
  pile: BonusEvidencePileId,
): boolean {
  if (pile === "caution") {
    return doc.cautionUrls.length > 0 || Boolean(doc.cautionNote.trim());
  }
  return doc.evidenceUrls.length > 0 || Boolean(doc.note.trim());
}

/** ลำดับบังคับดู: ระวังก่อน แล้วค่อยตัด (ข้ามกองที่ว่าง) */
export function bonusEvidenceViewOrder(
  doc: Pick<BonusDeductionMonthDoc, "cautionUrls" | "cautionNote" | "evidenceUrls" | "note">,
): BonusEvidencePileId[] {
  const order: BonusEvidencePileId[] = [];
  if (bonusEvidencePileHasContent(doc, "caution")) order.push("caution");
  if (bonusEvidencePileHasContent(doc, "cut")) order.push("cut");
  return order;
}

export function bonusEvidenceViewedStorageKey(
  actorId: string,
  periodMonth: string,
): string {
  const actor = (actorId || "anon").trim() || "anon";
  return `telltea:bonusEvidenceViewed:${actor}:${periodMonth}`;
}

export function computeRuleLinePct(qty: number, ratePct: number) {
  return round2(Math.max(0, qty) * Math.max(0, ratePct));
}

export function buildBonusDeductionLines(
  counts: BonusDeductionMonthCounts,
  rules: BonusDeductionRule[],
): BonusDeductionLine[] {
  return rules.map((rule) => {
    const qty = counts[rule.id] || 0;
    return {
      id: rule.id,
      label: rule.label,
      qty,
      ratePct: rule.pctPerUnit,
      linePct: computeRuleLinePct(qty, rule.pctPerUnit),
    };
  });
}

export function computeShopDeductPct(
  counts: BonusDeductionMonthCounts,
  rules: BonusDeductionRule[],
): number {
  const raw = buildBonusDeductionLines(counts, rules).reduce((sum, line) => sum + line.linePct, 0);
  return Math.min(100, round2(raw));
}

export async function getBonusDeductionSettings(): Promise<BonusDeductionSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) {
    return normalizeBonusDeductionSettings(undefined);
  }
  return normalizeBonusDeductionSettings(snap.data() as Partial<BonusDeductionSettings>);
}

export async function getBonusDeductionSettingsFromServer(): Promise<BonusDeductionSettings> {
  const snap = await getDocFromServer(settingsRef());
  if (!snap.exists()) {
    return normalizeBonusDeductionSettings(undefined);
  }
  return normalizeBonusDeductionSettings(snap.data() as Partial<BonusDeductionSettings>);
}

export function subscribeBonusDeductionSettings(
  onData: (settings: BonusDeductionSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsRef(),
    (snap) => {
      onData(
        normalizeBonusDeductionSettings(
          snap.exists() ? (snap.data() as Partial<BonusDeductionSettings>) : undefined,
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveBonusDeductionRulePct(
  ruleId: BonusDeductionRuleId,
  pctPerUnit: number,
): Promise<void> {
  const current = await getBonusDeductionSettings();
  const rules = current.rules.map((rule) =>
    rule.id === ruleId
      ? { ...rule, pctPerUnit: Math.max(0, Number(pctPerUnit) || 0) }
      : rule,
  );
  await setDoc(
    settingsRef(),
    { rules, updatedAt: Date.now() },
    { merge: true },
  );
}

export async function getBonusDeductionMonth(
  year: number,
  month: number,
): Promise<BonusDeductionMonthDoc> {
  const snap = await getDoc(monthRef(year, month));
  if (!snap.exists()) {
    return normalizeBonusDeductionMonthDoc(year, month, undefined);
  }
  return normalizeBonusDeductionMonthDoc(year, month, snap.data() as Partial<BonusDeductionMonthDoc>);
}

export async function getBonusDeductionMonthFromServer(
  year: number,
  month: number,
): Promise<BonusDeductionMonthDoc> {
  const snap = await getDocFromServer(monthRef(year, month));
  if (!snap.exists()) {
    return normalizeBonusDeductionMonthDoc(year, month, undefined);
  }
  return normalizeBonusDeductionMonthDoc(year, month, snap.data() as Partial<BonusDeductionMonthDoc>);
}

export function subscribeBonusDeductionMonth(
  year: number,
  month: number,
  onData: (doc: BonusDeductionMonthDoc) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    monthRef(year, month),
    (snap) => {
      onData(
        normalizeBonusDeductionMonthDoc(
          year,
          month,
          snap.exists() ? (snap.data() as Partial<BonusDeductionMonthDoc>) : undefined,
        ),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveBonusDeductionMonthQty(
  year: number,
  month: number,
  ruleId: BonusDeductionRuleId,
  qty: number,
): Promise<void> {
  const current = await getBonusDeductionMonth(year, month);
  const counts = {
    ...current.counts,
    [ruleId]: Math.max(0, Number(qty) || 0),
  };
  await setDoc(
    monthRef(year, month),
    {
      year,
      month,
      counts,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/** แนบหลักฐานระวัง/ตัด + โน้ตของงวด (เก็บตามเดือน — ย้อนหลังได้) */
export async function saveBonusDeductionMonthEvidence(
  year: number,
  month: number,
  input: {
    evidenceUrls?: string[];
    note?: string;
    cautionUrls?: string[];
    cautionNote?: string;
  },
): Promise<BonusDeductionMonthDoc> {
  const current = await getBonusDeductionMonth(year, month);
  const evidenceUrls =
    input.evidenceUrls != null
      ? normalizeEvidenceUrls(input.evidenceUrls)
      : current.evidenceUrls;
  const cautionUrls =
    input.cautionUrls != null
      ? normalizeEvidenceUrls(input.cautionUrls)
      : current.cautionUrls;
  if (
    evidenceUrls.some((u) => u.startsWith("data:")) ||
    cautionUrls.some((u) => u.startsWith("data:"))
  ) {
    throw new Error("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่");
  }
  const note =
    input.note != null ? String(input.note).trim().slice(0, 500) : current.note;
  const cautionNote =
    input.cautionNote != null
      ? String(input.cautionNote).trim().slice(0, 500)
      : current.cautionNote;
  const next: BonusDeductionMonthDoc = {
    year,
    month,
    counts: current.counts,
    evidenceUrls,
    note,
    cautionUrls,
    cautionNote,
    updatedAt: Date.now(),
  };
  await setDoc(monthRef(year, month), next, { merge: true });
  return next;
}
