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

export function getPosSettingsDbMode(): PosSettingsDbMode {
  return settingsDbMode;
}

function settingsDb(mode: PosSettingsDbMode = settingsDbMode) {
  return mode === "owner" ? getDb() : getPosDb();
}

export type PosShopSettings = {
  shopName: string;
  shopNameTh: string;
  shopAddress: string;
  shopPhone: string;
  /** เลขประจำตัวผู้เสียภาษี — แสดงบนสลิปเมื่อมีค่า */
  taxId: string;
  promptPayId: string;
  autoPrintReceipt: boolean;
  /** ชื่อพนักงานบนใบเสร็จ (ค่าเริ่มต้น) */
  receiptStaffName: string;
  /** ข้อความท้ายสลิป */
  receiptFooterNote: string;
  /**
   * พิมพ์โลโก้ร้านบนหัวสลิป — ค่าเริ่มเปิดเมื่อมีรูปใน meta/brandLogo
   * (โลโก้อยู่คนละเอกสาร · ธงนี้อยู่ meta/pos)
   */
  receiptPrintLogo: boolean;
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
  /** ข้อความ error ล่าสุดตอนอัปไม่สำเร็จ (ถ้ามี) */
  syncError?: string;
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
  taxId: "",
  promptPayId: "",
  autoPrintReceipt: true,
  receiptStaffName: "หน้าร้าน",
  receiptFooterNote: "ขอบคุณที่อุดหนุน",
  receiptPrintLogo: true,
  menuArrangeMode: "fix",
  bestsellerWindowDays: 7,
};

const LOCAL_KEY = "telltea-pos-shop-settings";

type SettingsListener = (settings: PosShopSettings) => void;
const localListeners = new Set<SettingsListener>();

let flushInFlight: Promise<boolean> | null = null;
let onlineHookInstalled = false;
let lastSyncError = "";

function metaPosRef(mode: PosSettingsDbMode = settingsDbMode) {
  return doc(settingsDb(mode), "meta", "pos");
}

function toPublic(stored: StoredShopSettings): PosShopSettings {
  return {
    shopName: stored.shopName,
    shopNameTh: stored.shopNameTh,
    shopAddress: stored.shopAddress,
    shopPhone: stored.shopPhone,
    taxId: stored.taxId,
    promptPayId: stored.promptPayId,
    autoPrintReceipt: stored.autoPrintReceipt,
    receiptStaffName: stored.receiptStaffName,
    receiptFooterNote: stored.receiptFooterNote,
    receiptPrintLogo: stored.receiptPrintLogo,
    menuArrangeMode: stored.menuArrangeMode,
    bestsellerWindowDays: stored.bestsellerWindowDays,
  };
}

/**
 * Map remote/local JSON → settings.
 * When {@code preferRemoteEmpty} (cloud snapshot), keep empty strings instead of
 * inventing the Udon default — empty means "omit on bill", not "use template".
 */
function mapSettings(
  data: Record<string, unknown> | undefined,
  opts?: { preferRemoteEmpty?: boolean },
): PosShopSettings {
  const emptyOk = opts?.preferRemoteEmpty === true;
  const str = (v: unknown, fallback: string) => {
    if (typeof v !== "string") return emptyOk ? "" : fallback;
    const t = v.trim();
    if (t) return t;
    return emptyOk ? "" : fallback;
  };
  return {
    shopName: str(data?.shopName, DEFAULTS.shopName) || DEFAULTS.shopName,
    shopNameTh: str(data?.shopNameTh, DEFAULTS.shopNameTh),
    shopAddress: str(data?.shopAddress, emptyOk ? "" : DEFAULTS.shopAddress),
    shopPhone: str(data?.shopPhone, emptyOk ? "" : DEFAULTS.shopPhone),
    taxId: typeof data?.taxId === "string" ? data.taxId.trim() : "",
    promptPayId: typeof data?.promptPayId === "string" ? data.promptPayId.trim() : "",
    autoPrintReceipt: data?.autoPrintReceipt !== false,
    receiptStaffName: str(data?.receiptStaffName, DEFAULTS.receiptStaffName) || DEFAULTS.receiptStaffName,
    receiptFooterNote: str(data?.receiptFooterNote, DEFAULTS.receiptFooterNote) || DEFAULTS.receiptFooterNote,
    // Owner lock: default ON (print logo when brandLogo exists). Explicit false turns off.
    receiptPrintLogo: data?.receiptPrintLogo !== false,
    menuArrangeMode: normalizeMenuArrangeMode(data?.menuArrangeMode),
    bestsellerWindowDays: normalizeWindowDays(data?.bestsellerWindowDays),
  };
}

/**
 * Only shopSettingsUpdatedAt — never fall back to meta/pos.updatedAt.
 * Bill counter bumps updatedAt and used to wipe local/BO shop edits.
 */
function remoteUpdatedAt(data: Record<string, unknown> | undefined): number {
  const v = data?.shopSettingsUpdatedAt;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function cloudHasShopFields(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return (
    typeof data.shopName === "string" ||
    typeof data.shopNameTh === "string" ||
    typeof data.shopAddress === "string" ||
    typeof data.shopPhone === "string"
  );
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
    // Do not touch generic updatedAt — reserved for bill seq / other writers.
    shopSettingsUpdatedAt: updatedAt,
    shopName: settings.shopName,
    shopNameTh: settings.shopNameTh,
    shopAddress: settings.shopAddress,
    shopPhone: settings.shopPhone,
    taxId: settings.taxId,
    promptPayId: settings.promptPayId,
    autoPrintReceipt: settings.autoPrintReceipt,
    receiptStaffName: settings.receiptStaffName,
    receiptFooterNote: settings.receiptFooterNote,
    receiptPrintLogo: settings.receiptPrintLogo !== false,
    menuArrangeMode: settings.menuArrangeMode,
    bestsellerWindowDays: settings.bestsellerWindowDays,
  };
}

async function uploadStored(
  stored: StoredShopSettings,
  mode: PosSettingsDbMode = settingsDbMode,
): Promise<boolean> {
  try {
    await setDoc(metaPosRef(mode), remotePayload(toPublic(stored), stored.updatedAt), {
      merge: true,
    });
    lastSyncError = "";
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
  } catch (err) {
    lastSyncError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

/** อัปโหลดค่าที่ค้างส่งขึ้น Firebase (เรียกซ้ำได้) */
export async function flushPosShopSettingsUpload(
  mode: PosSettingsDbMode = settingsDbMode,
): Promise<boolean> {
  ensureOnlineFlushHook();
  const stored = readStored();
  if (!stored?.syncPending) return true;
  if (flushInFlight) return flushInFlight;

  flushInFlight = uploadStored(stored, mode).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

/** อ่านทันทีสำหรับ boot UI — local → defaults */
export function getLocalPosShopSettings(): PosShopSettings {
  const stored = readStored();
  return stored ? toPublic(stored) : { ...DEFAULTS };
}

export function isPosShopSettingsSyncPending(): boolean {
  return readStored()?.syncPending === true;
}

export function getPosShopSettingsLastSyncError(): string {
  return lastSyncError;
}

function adoptRemote(
  data: Record<string, unknown> | undefined,
  remoteAt: number,
): PosShopSettings {
  const remote = mapSettings(data, { preferRemoteEmpty: true });
  // Name must never be blank on UI — fall back to brand default only for name.
  if (!remote.shopName.trim()) remote.shopName = DEFAULTS.shopName;
  if (!remote.shopNameTh.trim()) remote.shopNameTh = DEFAULTS.shopNameTh;
  if (!remote.receiptStaffName.trim()) remote.receiptStaffName = DEFAULTS.receiptStaffName;
  if (!remote.receiptFooterNote.trim()) remote.receiptFooterNote = DEFAULTS.receiptFooterNote;
  const next: StoredShopSettings = {
    ...remote,
    updatedAt: remoteAt > 0 ? remoteAt : Date.now(),
    syncPending: false,
  };
  writeStored(next);
  return toPublic(next);
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
      const remoteAt = remoteUpdatedAt(data);
      const stored = readStored();

      // Remote newer than local pending/edit → cloud wins (another device / BO save).
      if (remoteAt > 0 && stored && remoteAt > stored.updatedAt) {
        onSettings(adoptRemote(data, remoteAt));
        return;
      }

      // local-first: คิวอัปโหลดค้าง และยังใหม่กว่าหรือเท่า remote
      if (stored?.syncPending && (remoteAt === 0 || stored.updatedAt >= remoteAt)) {
        void flushPosShopSettingsUpload();
        onSettings(toPublic(stored));
        return;
      }

      // Legacy cloud (no shopSettingsUpdatedAt) but has shop fields — adopt cloud,
      // never let stale localStorage silently win / overwrite.
      if (remoteAt === 0 && cloudHasShopFields(data) && !stored?.syncPending) {
        onSettings(adoptRemote(data, 0));
        return;
      }

      if (remoteAt === 0 && stored) {
        if (stored.syncPending) void flushPosShopSettingsUpload();
        onSettings(toPublic(stored));
        return;
      }

      if (remoteAt > 0) {
        onSettings(adoptRemote(data, remoteAt));
        return;
      }

      onSettings(stored ? toPublic(stored) : { ...DEFAULTS });
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
    const remoteAt = remoteUpdatedAt(data);
    if (remoteAt > 0 && stored && remoteAt >= stored.updatedAt) {
      return adoptRemote(data, remoteAt);
    }
    if (remoteAt === 0 && cloudHasShopFields(data)) {
      return adoptRemote(data, 0);
    }
    if (stored && stored.updatedAt > remoteAt && remoteAt > 0 && stored.syncPending) {
      void flushPosShopSettingsUpload();
      return toPublic(stored);
    }
    if (remoteAt > 0) {
      return adoptRemote(data, remoteAt);
    }
    return stored ? toPublic(stored) : { ...DEFAULTS };
  } catch {
    return stored ? toPublic(stored) : { ...DEFAULTS };
  }
}

/**
 * บันทึกตั้งค่ากิจการแบบ local-first:
 * 1) เขียนเครื่องทันที → UI ใช้ได้
 * 2) อัปโหลด Firebase (owner หลังร้านต้อง sync สำเร็จ — ไม่เงียบ)
 */
export async function savePosShopSettings(
  patch: Partial<PosShopSettings>,
): Promise<SavePosShopSettingsResult> {
  ensureOnlineFlushHook();
  const modeAtSave = settingsDbMode;
  const current = getLocalPosShopSettings();
  const next: PosShopSettings = {
    shopName: patch.shopName != null ? patch.shopName.trim() || DEFAULTS.shopName : current.shopName,
    shopNameTh: patch.shopNameTh != null ? patch.shopNameTh.trim() || DEFAULTS.shopNameTh : current.shopNameTh,
    shopAddress:
      patch.shopAddress != null ? patch.shopAddress.trim() || DEFAULTS.shopAddress : current.shopAddress,
    shopPhone: patch.shopPhone != null ? patch.shopPhone.trim() || DEFAULTS.shopPhone : current.shopPhone,
    taxId: patch.taxId != null ? patch.taxId.trim() : current.taxId,
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
    receiptPrintLogo:
      patch.receiptPrintLogo != null ? patch.receiptPrintLogo !== false : current.receiptPrintLogo !== false,
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

  let synced = await flushPosShopSettingsUpload(modeAtSave);
  // Owner BO: if mode flipped mid-flight, retry once with owner db.
  if (!synced && modeAtSave === "owner") {
    synced = await uploadStored(readStored() ?? stored, "owner");
  }
  if (!synced && modeAtSave === "owner") {
    return {
      savedLocal: true,
      synced: false,
      syncError: lastSyncError || "อัป Firebase ไม่สำเร็จ — ตรวจเน็ต/สิทธิ์แล้วกดบันทึกอีกครั้ง",
    };
  }
  return { savedLocal: true, synced, syncError: synced ? undefined : lastSyncError || undefined };
}
