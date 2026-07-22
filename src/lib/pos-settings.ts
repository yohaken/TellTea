import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";
import { getPosDb } from "./pos-firebase";
import { normalizePromptPayId } from "./pos-promptpay";
import {
  normalizeMenuArrangeMode,
  normalizeWindowDays,
  type MenuArrangeMode,
} from "./pos-bestseller-rank";

/** owner = หลังร้าน Google · pos = แท็บเล็ต (anonymous / device) */
export type PosSettingsDbMode = "pos" | "owner";
let settingsDbMode: PosSettingsDbMode = "pos";

export function setPosSettingsDbMode(mode: PosSettingsDbMode): void {
  settingsDbMode = mode;
}

function settingsDb() {
  return settingsDbMode === "owner" ? getDb() : getPosDb();
}

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
  /** ลำดับเมนูหน้า POS: fix = คงที่/มือ · bestsellers = กลุ่มขายดีจริง */
  menuArrangeMode: MenuArrangeMode;
  /** หน้าต่างสถิติขายดี (วัน) — 7 ช่วงแรก · ขยายได้ถึง 14 */
  bestsellerWindowDays: number;
};

export type SavePosShopSettingsResult = {
  /** บันทึกบนเครื่องสำเร็จแล้ว — ใช้ได้ทันที */
  savedLocal: true;
  /** อัปโหลด Firebase สำเร็จในรอบนี้ (false = จะลองใหม่ทีหลัง) */
  synced: boolean;
};

type StoredShopSettings = PosShopSettings & {
  updatedAt: number;
  syncPending?: boolean;
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
  menuArrangeMode: "fix",
  bestsellerWindowDays: 7,
};

const LOCAL_KEY = "telltea-pos-shop-settings";

type SettingsListener = (settings: PosShopSettings) => void;
const localListeners = new Set<SettingsListener>();

let flushInFlight: Promise<boolean> | null = null;
let onlineHookInstalled = false;

function metaPosRef() {
  return doc(settingsDb(), "meta", "pos");
}

function toPublic(stored: StoredShopSettings): PosShopSettings {
  return {
    shopName: stored.shopName,
    shopNameTh: stored.shopNameTh,
    shopAddress: stored.shopAddress,
    shopPhone: stored.shopPhone,
    promptPayId: stored.promptPayId,
    autoPrintReceipt: stored.autoPrintReceipt,
    receiptStaffName: stored.receiptStaffName,
    receiptFooterNote: stored.receiptFooterNote,
    menuArrangeMode: stored.menuArrangeMode,
    bestsellerWindowDays: stored.bestsellerWindowDays,
  };
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
    menuArrangeMode: normalizeMenuArrangeMode(data?.menuArrangeMode),
    bestsellerWindowDays: normalizeWindowDays(data?.bestsellerWindowDays),
  };
}

function remoteUpdatedAt(data: Record<string, unknown> | undefined): number {
  const v = data?.shopSettingsUpdatedAt ?? data?.updatedAt;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readStored(): StoredShopSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const settings = mapSettings(parsed);
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now();
    return {
      ...settings,
      updatedAt,
      syncPending: parsed.syncPending === true,
    };
  } catch {
    return null;
  }
}

function writeStored(stored: StoredShopSettings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

function notifyLocal(settings: PosShopSettings) {
  for (const listener of localListeners) {
    try {
      listener(settings);
    } catch {
      /* ignore listener errors */
    }
  }
}

function ensureOnlineFlushHook() {
  if (onlineHookInstalled || typeof window === "undefined") return;
  onlineHookInstalled = true;
  window.addEventListener("online", () => {
    void flushPosShopSettingsUpload();
  });
}

function remotePayload(settings: PosShopSettings, updatedAt: number): Record<string, unknown> {
  return {
    updatedAt,
    shopSettingsUpdatedAt: updatedAt,
    shopName: settings.shopName,
    shopNameTh: settings.shopNameTh,
    shopAddress: settings.shopAddress,
    shopPhone: settings.shopPhone,
    promptPayId: settings.promptPayId,
    autoPrintReceipt: settings.autoPrintReceipt,
    receiptStaffName: settings.receiptStaffName,
    receiptFooterNote: settings.receiptFooterNote,
    menuArrangeMode: settings.menuArrangeMode,
    bestsellerWindowDays: settings.bestsellerWindowDays,
  };
}

async function uploadStored(stored: StoredShopSettings): Promise<boolean> {
  try {
    await setDoc(metaPosRef(), remotePayload(toPublic(stored), stored.updatedAt), { merge: true });
    const latest = readStored();
    // ทับคิวใหม่ระหว่างอัปโหลด — อย่าเคลียร์ pending ของรุ่นที่ใหม่กว่า
    if (latest && latest.updatedAt > stored.updatedAt) {
      return false;
    }
    const next: StoredShopSettings = {
      ...(latest ? toPublic(latest) : toPublic(stored)),
      updatedAt: latest?.updatedAt ?? stored.updatedAt,
      syncPending: false,
    };
    writeStored(next);
    return true;
  } catch {
    return false;
  }
}

/** อัปโหลดค่าที่ค้างส่งขึ้น Firebase (เรียกซ้ำได้) */
export async function flushPosShopSettingsUpload(): Promise<boolean> {
  ensureOnlineFlushHook();
  const stored = readStored();
  if (!stored?.syncPending) return true;
  if (flushInFlight) return flushInFlight;

  flushInFlight = uploadStored(stored).finally(() => {
    flushInFlight = null;
  });
  const ok = await flushInFlight;
  if (!ok) {
    const again = readStored();
    if (again?.syncPending) {
      // ยังค้าง — ลองรอบสั้น ๆ อีกครั้งถ้าเครือข่ายกลับมา
      return false;
    }
  }
  return ok;
}

/** อ่านทันทีสำหรับ boot UI — local → defaults */
export function getLocalPosShopSettings(): PosShopSettings {
  const stored = readStored();
  return stored ? toPublic(stored) : { ...DEFAULTS };
}

export function isPosShopSettingsSyncPending(): boolean {
  return readStored()?.syncPending === true;
}

export function subscribePosShopSettings(
  onSettings: (settings: PosShopSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  ensureOnlineFlushHook();
  localListeners.add(onSettings);

  const local = readStored();
  if (local) onSettings(toPublic(local));
  else onSettings({ ...DEFAULTS });

  void flushPosShopSettingsUpload();

  const unsubSnap = onSnapshot(
    metaPosRef(),
    (snap) => {
      const data = snap.data() as Record<string, unknown> | undefined;
      const remote = mapSettings(data);
      const remoteAt = remoteUpdatedAt(data);
      const stored = readStored();

      // local-first: ถ้ามีคิวอัปโหลดและใหม่กว่า remote — อย่าทับด้วย Firebase เก่า
      if (stored?.syncPending && stored.updatedAt >= remoteAt) {
        void flushPosShopSettingsUpload();
        onSettings(toPublic(stored));
        return;
      }

      if (stored && !stored.syncPending && stored.updatedAt > remoteAt && remoteAt > 0) {
        // local ใหม่กว่าแต่ไม่ได้มาร์ค pending (legacy) — เก็บ local + อัปโหลด
        writeStored({ ...stored, syncPending: true });
        void flushPosShopSettingsUpload();
        onSettings(toPublic(stored));
        return;
      }

      const next: StoredShopSettings = {
        ...remote,
        updatedAt: remoteAt || Date.now(),
        syncPending: false,
      };
      writeStored(next);
      onSettings(toPublic(next));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    localListeners.delete(onSettings);
    unsubSnap();
  };
}

export async function getPosShopSettings(): Promise<PosShopSettings> {
  const stored = readStored();
  if (stored?.syncPending) {
    void flushPosShopSettingsUpload();
    return toPublic(stored);
  }
  try {
    const snap = await getDoc(metaPosRef());
    const data = snap.data() as Record<string, unknown> | undefined;
    const remote = mapSettings(data);
    const remoteAt = remoteUpdatedAt(data);
    if (stored && stored.updatedAt > remoteAt) {
      writeStored({ ...stored, syncPending: true });
      void flushPosShopSettingsUpload();
      return toPublic(stored);
    }
    const next: StoredShopSettings = {
      ...remote,
      updatedAt: remoteAt || Date.now(),
      syncPending: false,
    };
    writeStored(next);
    return toPublic(next);
  } catch {
    return stored ? toPublic(stored) : { ...DEFAULTS };
  }
}

/**
 * บันทึกตั้งค่ากิจการแบบ local-first:
 * 1) เขียนเครื่องทันที → UI ใช้ได้
 * 2) อัปโหลด Firebase เบื้องหลัง (ล้มเหลวไม่บล็อก — จะลองใหม่ตอน online)
 */
export async function savePosShopSettings(
  patch: Partial<PosShopSettings>,
): Promise<SavePosShopSettingsResult> {
  ensureOnlineFlushHook();
  const current = getLocalPosShopSettings();
  const next: PosShopSettings = {
    shopName: patch.shopName != null ? patch.shopName.trim() || DEFAULTS.shopName : current.shopName,
    shopNameTh: patch.shopNameTh != null ? patch.shopNameTh.trim() || DEFAULTS.shopNameTh : current.shopNameTh,
    shopAddress:
      patch.shopAddress != null ? patch.shopAddress.trim() || DEFAULTS.shopAddress : current.shopAddress,
    shopPhone: patch.shopPhone != null ? patch.shopPhone.trim() || DEFAULTS.shopPhone : current.shopPhone,
    promptPayId:
      patch.promptPayId != null ? normalizePromptPayId(patch.promptPayId) : current.promptPayId,
    autoPrintReceipt: patch.autoPrintReceipt != null ? patch.autoPrintReceipt : current.autoPrintReceipt,
    receiptStaffName:
      patch.receiptStaffName != null
        ? patch.receiptStaffName.trim() || DEFAULTS.receiptStaffName
        : current.receiptStaffName,
    receiptFooterNote:
      patch.receiptFooterNote != null
        ? patch.receiptFooterNote.trim() || DEFAULTS.receiptFooterNote
        : current.receiptFooterNote,
    menuArrangeMode:
      patch.menuArrangeMode != null
        ? normalizeMenuArrangeMode(patch.menuArrangeMode)
        : current.menuArrangeMode,
    bestsellerWindowDays:
      patch.bestsellerWindowDays != null
        ? normalizeWindowDays(patch.bestsellerWindowDays)
        : current.bestsellerWindowDays,
  };
  const stored: StoredShopSettings = {
    ...next,
    updatedAt: Date.now(),
    syncPending: true,
  };
  writeStored(stored);
  notifyLocal(next);

  const synced = await flushPosShopSettingsUpload();
  return { savedLocal: true, synced };
}
