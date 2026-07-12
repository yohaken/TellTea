import {
  doc,
  getDoc,
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

export type WorkerDeductionCounts = {
  generalFailCount: number;
  wasteQty: number;
};

export type BonusDeductionMonthDoc = {
  year: number;
  month: number;
  workers: Record<string, WorkerDeductionCounts>;
  updatedAt: number;
};

export const DEFAULT_BONUS_DEDUCTION_RULES: BonusDeductionRule[] = [
  { id: "generalFail", label: "ผิดพลาดทั่วไป", pctPerUnit: 1 },
  { id: "waste", label: "ของเสีย", pctPerUnit: 3 },
];

export const EMPTY_WORKER_DEDUCTION_COUNTS: WorkerDeductionCounts = {
  generalFailCount: 0,
  wasteQty: 0,
};

function settingsRef() {
  return doc(getDb(), "meta", "bonusDeductionSettings");
}

function monthRef(year: number, month: number) {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  return doc(getDb(), "bonusDeductionMonths", key);
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

function normalizeWorkerCounts(raw: Partial<WorkerDeductionCounts> | undefined): WorkerDeductionCounts {
  return {
    generalFailCount: Math.max(0, Math.round(Number(raw?.generalFailCount) || 0)),
    wasteQty: Math.max(0, Number(raw?.wasteQty) || 0),
  };
}

export function normalizeBonusDeductionMonthDoc(
  year: number,
  month: number,
  data: Partial<BonusDeductionMonthDoc> | undefined,
): BonusDeductionMonthDoc {
  const workers: Record<string, WorkerDeductionCounts> = {};
  if (data?.workers && typeof data.workers === "object") {
    for (const [workerId, counts] of Object.entries(data.workers)) {
      workers[workerId] = normalizeWorkerCounts(counts);
    }
  }
  return {
    year,
    month,
    workers,
    updatedAt: Number(data?.updatedAt) || 0,
  };
}

export async function getBonusDeductionSettings(): Promise<BonusDeductionSettings> {
  const snap = await getDoc(settingsRef());
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

export async function saveWorkerDeductionCounts(
  year: number,
  month: number,
  workerId: string,
  counts: WorkerDeductionCounts,
): Promise<void> {
  const current = await getBonusDeductionMonth(year, month);
  const workers = { ...current.workers, [workerId]: normalizeWorkerCounts(counts) };
  await setDoc(monthRef(year, month), {
    year,
    month,
    workers,
    updatedAt: Date.now(),
  });
}

export function getWorkerDeductionCounts(
  monthDoc: BonusDeductionMonthDoc,
  workerId: string,
): WorkerDeductionCounts {
  return monthDoc.workers[workerId] || EMPTY_WORKER_DEDUCTION_COUNTS;
}
