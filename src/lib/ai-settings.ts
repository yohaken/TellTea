import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export const LEDGER_AI_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (แนะนำ)" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "gemini-flash-lite-latest", label: "Flash Lite (ล่าสุด)" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
] as const;

export type LedgerAiSettings = {
  /** เปิดจัดประเภทด้วย AI */
  enabled: boolean;
  /** ชื่อโมเดล Gemini */
  model: string;
  /** API key — อ่านได้เฉพาะเจ้าของ (Cloud Function ใช้ Admin) */
  apiKey: string;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_LEDGER_AI_SETTINGS: LedgerAiSettings = {
  enabled: true,
  model: "gemini-2.5-flash",
  apiKey: "",
  updatedAt: 0,
  updatedBy: "",
};

function aiSettingsRef() {
  return doc(getDb(), "meta", "aiSettings");
}

function mapSettings(data: Partial<LedgerAiSettings> | undefined): LedgerAiSettings {
  const model = String(data?.model || "").trim() || DEFAULT_LEDGER_AI_SETTINGS.model;
  return {
    enabled: data?.enabled !== false,
    model,
    apiKey: String(data?.apiKey || ""),
    updatedAt: Number(data?.updatedAt) || 0,
    updatedBy: String(data?.updatedBy || ""),
  };
}

export async function getLedgerAiSettings(): Promise<LedgerAiSettings> {
  const snap = await getDoc(aiSettingsRef());
  if (!snap.exists()) return { ...DEFAULT_LEDGER_AI_SETTINGS };
  return mapSettings(snap.data() as Partial<LedgerAiSettings>);
}

export async function saveLedgerAiSettings(
  patch: Pick<LedgerAiSettings, "enabled" | "model" | "apiKey">,
  updatedBy: string,
): Promise<void> {
  const model = String(patch.model || "").trim() || DEFAULT_LEDGER_AI_SETTINGS.model;
  const apiKey = String(patch.apiKey || "").trim();
  await setDoc(
    aiSettingsRef(),
    {
      enabled: Boolean(patch.enabled),
      model,
      apiKey,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
}

export function subscribeLedgerAiSettings(
  onSettings: (settings: LedgerAiSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    aiSettingsRef(),
    (snap) => {
      if (!snap.exists()) {
        onSettings({ ...DEFAULT_LEDGER_AI_SETTINGS });
        return;
      }
      onSettings(mapSettings(snap.data() as Partial<LedgerAiSettings>));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function maskApiKey(key: string) {
  const k = key.trim();
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
