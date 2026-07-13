import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";

export type PosShopSettings = {
  shopName: string;
  shopNameTh: string;
  shopAddress: string;
  shopPhone: string;
  promptPayId: string;
  autoPrintReceipt: boolean;
  /** ชื่อพนักงานบนใบเสร็จ (ค่าเริ่มต้น) */
  receiptStaffName: string;
  /** ข้อความท้ายสลิป */
  receiptFooterNote: string;
};

const DEFAULTS: PosShopSettings = {
  shopName: "TELL TEA",
  shopNameTh: "เทล ที",
  shopAddress: "ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี",
  shopPhone: "0884818817",
  promptPayId: "",
  autoPrintReceipt: true,
  receiptStaffName: "หน้าร้าน",
  receiptFooterNote: "ขอบคุณที่อุดหนุน",
};

const LOCAL_KEY = "telltea-pos-shop-settings";

function metaPosRef(db: ReturnType<typeof getDb> | ReturnType<typeof getPosDb>) {
  return doc(db, "meta", "pos");
}

function mapSettings(data: Record<string, unknown> | undefined): PosShopSettings {
  return {
    shopName: typeof data?.shopName === "string" && data.shopName.trim() ? data.shopName.trim() : DEFAULTS.shopName,
    shopNameTh: typeof data?.shopNameTh === "string" && data.shopNameTh.trim() ? data.shopNameTh.trim() : DEFAULTS.shopNameTh,
    shopAddress:
      typeof data?.shopAddress === "string" && data.shopAddress.trim() ? data.shopAddress.trim() : DEFAULTS.shopAddress,
    shopPhone: typeof data?.shopPhone === "string" && data.shopPhone.trim() ? data.shopPhone.trim() : DEFAULTS.shopPhone,
    promptPayId: typeof data?.promptPayId === "string" ? data.promptPayId.trim() : "",
    autoPrintReceipt: data?.autoPrintReceipt !== false,
    receiptStaffName:
      typeof data?.receiptStaffName === "string" && data.receiptStaffName.trim()
        ? data.receiptStaffName.trim()
        : DEFAULTS.receiptStaffName,
    receiptFooterNote:
      typeof data?.receiptFooterNote === "string" && data.receiptFooterNote.trim()
        ? data.receiptFooterNote.trim()
        : DEFAULTS.receiptFooterNote,
  };
}

function readLocalShopSettings(): PosShopSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return mapSettings(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function writeLocalShopSettings(settings: PosShopSettings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
  } catch {
    /* quota */
  }
}

/** อ่านทันทีสำหรับ boot UI — local → defaults */
export function getLocalPosShopSettings(): PosShopSettings {
  return readLocalShopSettings() ?? { ...DEFAULTS };
}

export function subscribePosShopSettings(
  onSettings: (settings: PosShopSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const local = readLocalShopSettings();
  if (local) onSettings(local);
  else onSettings({ ...DEFAULTS });

  return onSnapshot(
    metaPosRef(getPosDb()),
    (snap) => {
      const next = mapSettings(snap.data() as Record<string, unknown> | undefined);
      writeLocalShopSettings(next);
      onSettings(next);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getPosShopSettings(): Promise<PosShopSettings> {
  const local = readLocalShopSettings();
  try {
    const snap = await getDoc(metaPosRef(getPosDb()));
    const next = mapSettings(snap.data() as Record<string, unknown> | undefined);
    writeLocalShopSettings(next);
    return next;
  } catch {
    return local ?? { ...DEFAULTS };
  }
}

export async function savePosShopSettings(patch: Partial<PosShopSettings>): Promise<void> {
  const current = getLocalPosShopSettings();
  const next: PosShopSettings = {
    shopName: patch.shopName != null ? patch.shopName.trim() || DEFAULTS.shopName : current.shopName,
    shopNameTh: patch.shopNameTh != null ? patch.shopNameTh.trim() || DEFAULTS.shopNameTh : current.shopNameTh,
    shopAddress:
      patch.shopAddress != null ? patch.shopAddress.trim() || DEFAULTS.shopAddress : current.shopAddress,
    shopPhone: patch.shopPhone != null ? patch.shopPhone.trim() || DEFAULTS.shopPhone : current.shopPhone,
    promptPayId: patch.promptPayId != null ? patch.promptPayId.trim() : current.promptPayId,
    autoPrintReceipt: patch.autoPrintReceipt != null ? patch.autoPrintReceipt : current.autoPrintReceipt,
    receiptStaffName:
      patch.receiptStaffName != null
        ? patch.receiptStaffName.trim() || DEFAULTS.receiptStaffName
        : current.receiptStaffName,
    receiptFooterNote:
      patch.receiptFooterNote != null
        ? patch.receiptFooterNote.trim() || DEFAULTS.receiptFooterNote
        : current.receiptFooterNote,
  };
  writeLocalShopSettings(next);

  const remote: Record<string, unknown> = {
    updatedAt: Date.now(),
    shopName: next.shopName,
    shopNameTh: next.shopNameTh,
    shopAddress: next.shopAddress,
    shopPhone: next.shopPhone,
    promptPayId: next.promptPayId,
    autoPrintReceipt: next.autoPrintReceipt,
    receiptStaffName: next.receiptStaffName,
    receiptFooterNote: next.receiptFooterNote,
  };
  try {
    await setDoc(metaPosRef(getDb()), remote, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกตั้งค่า POS"));
  }
}
