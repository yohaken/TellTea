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
  if (patch.shopNameTh != null) next.shopNameTh = patch.shopNameTh.trim() || DEFAULTS.shopNameTh;
  if (patch.shopAddress != null) next.shopAddress = patch.shopAddress.trim() || DEFAULTS.shopAddress;
  if (patch.shopPhone != null) next.shopPhone = patch.shopPhone.trim() || DEFAULTS.shopPhone;
  if (patch.promptPayId != null) next.promptPayId = patch.promptPayId.trim();
  if (patch.autoPrintReceipt != null) next.autoPrintReceipt = patch.autoPrintReceipt;
  if (patch.receiptStaffName != null) next.receiptStaffName = patch.receiptStaffName.trim() || DEFAULTS.receiptStaffName;
  if (patch.receiptFooterNote != null) next.receiptFooterNote = patch.receiptFooterNote.trim() || DEFAULTS.receiptFooterNote;
  try {
    await setDoc(metaPosRef(getDb()), next, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกตั้งค่า POS"));
  }
}
