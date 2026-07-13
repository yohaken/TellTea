import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";

export type PosShopSettings = {
  shopName: string;
  promptPayId: string;
  autoPrintReceipt: boolean;
};

const DEFAULTS: PosShopSettings = {
  shopName: "TellTea",
  promptPayId: "",
  autoPrintReceipt: true,
};

function metaPosRef(db: ReturnType<typeof getDb> | ReturnType<typeof getPosDb>) {
  return doc(db, "meta", "pos");
}

function mapSettings(data: Record<string, unknown> | undefined): PosShopSettings {
  return {
    shopName: typeof data?.shopName === "string" && data.shopName.trim() ? data.shopName.trim() : DEFAULTS.shopName,
    promptPayId: typeof data?.promptPayId === "string" ? data.promptPayId.trim() : "",
    autoPrintReceipt: data?.autoPrintReceipt !== false,
  };
}

export function subscribePosShopSettings(
  onSettings: (settings: PosShopSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    metaPosRef(getPosDb()),
    (snap) => onSettings(mapSettings(snap.data() as Record<string, unknown> | undefined)),
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getPosShopSettings(): Promise<PosShopSettings> {
  const snap = await getDoc(metaPosRef(getPosDb()));
  return mapSettings(snap.data() as Record<string, unknown> | undefined);
}

export async function savePosShopSettings(
  patch: Partial<PosShopSettings>,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.shopName != null) next.shopName = patch.shopName.trim() || DEFAULTS.shopName;
  if (patch.promptPayId != null) next.promptPayId = patch.promptPayId.trim();
  if (patch.autoPrintReceipt != null) next.autoPrintReceipt = patch.autoPrintReceipt;
  try {
    await setDoc(metaPosRef(getDb()), next, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกตั้งค่า POS"));
  }
}
