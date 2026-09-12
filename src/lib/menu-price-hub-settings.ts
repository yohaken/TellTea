import {
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getMenuDb } from "@/lib/pos-menu-db";
import {
  DEFAULT_CHANNEL_RULES,
  DEFAULT_DELIVERY_RULE,
  DEFAULT_FOLLOWER_ADD,
  DEFAULT_MAIN_CHANNEL,
  defaultMenuPriceHubSettings,
  type ChannelPriceRule,
  type ChannelRules,
  type DeliveryChannel,
  type FollowerAddRule,
  type FollowerAddRules,
  type ItemChannelOverrides,
  type MenuPriceHubSettings,
} from "@/lib/menu-channel-price";

const COL = "menuPriceHub";
const DOC_ID = "settings";

function settingsDocRef() {
  return doc(getMenuDb(), COL, DOC_ID);
}

function parseRule(raw: unknown, fallback: ChannelPriceRule): ChannelPriceRule {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  const mode =
    o.mode === "percent" ||
    o.mode === "offset" ||
    o.mode === "absolute" ||
    o.mode === "gp"
      ? o.mode
      : fallback.mode;
  const value = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : fallback.value;
  return { mode, value };
}

function parseChannels(raw: unknown): ChannelRules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    shopee: parseRule(src.shopee, DEFAULT_CHANNEL_RULES.shopee),
    grab: parseRule(src.grab, DEFAULT_CHANNEL_RULES.grab),
    lineman: parseRule(src.lineman, DEFAULT_CHANNEL_RULES.lineman),
  };
}

function parseKeyedOverrides(raw: unknown): Record<string, ItemChannelOverrides> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ItemChannelOverrides> = {};
  for (const [key, ch] of Object.entries(raw as Record<string, unknown>)) {
    if (!ch || typeof ch !== "object") continue;
    const row: ItemChannelOverrides = {};
    for (const channel of ["shopee", "grab", "lineman"] as DeliveryChannel[]) {
      const cell = (ch as Record<string, unknown>)[channel];
      if (cell && typeof cell === "object") {
        row[channel] = parseRule(cell, { mode: "absolute", value: 0 });
      }
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

function parseFollowerAdd(raw: unknown): FollowerAddRules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FOLLOWER_ADD };
  const src = raw as Record<string, unknown>;
  const out: FollowerAddRules = { ...DEFAULT_FOLLOWER_ADD };
  for (const channel of ["shopee", "grab", "lineman"] as DeliveryChannel[]) {
    const cell = src[channel];
    if (!cell || typeof cell !== "object") continue;
    const o = cell as Record<string, unknown>;
    const mode = o.mode === "percent" || o.mode === "offset" ? o.mode : "offset";
    const value = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : 0;
    out[channel] = { mode, value };
  }
  return out;
}

function parseMainChannel(raw: unknown): DeliveryChannel {
  if (raw === "shopee" || raw === "grab" || raw === "lineman") return raw;
  return DEFAULT_MAIN_CHANNEL;
}

export type ChannelOverrideWrite = {
  scope: "item" | "option";
  id: string;
  channel: DeliveryChannel;
  rule: ChannelPriceRule | null;
};

export function normalizeMenuPriceHubSettings(data: unknown): MenuPriceHubSettings {
  if (!data || typeof data !== "object") return defaultMenuPriceHubSettings();
  const o = data as Record<string, unknown>;
  const tableNote =
    typeof o.tableNote === "string" && o.tableNote.trim() ? o.tableNote.trim() : undefined;
  const deliveryRule =
    o.deliveryRule && typeof o.deliveryRule === "object"
      ? parseRule(o.deliveryRule, DEFAULT_DELIVERY_RULE)
      : undefined;
  return {
    channels: parseChannels(o.channels),
    mainChannel: parseMainChannel(o.mainChannel),
    followerAdd: parseFollowerAdd(o.followerAdd),
    ...(deliveryRule ? { deliveryRule } : {}),
    itemOverrides: parseKeyedOverrides(o.itemOverrides),
    optionOverrides: parseKeyedOverrides(o.optionOverrides),
    ...(tableNote ? { tableNote } : {}),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : undefined,
  };
}

export async function loadMenuPriceHubSettings(): Promise<MenuPriceHubSettings> {
  const snap = await getDoc(settingsDocRef());
  if (!snap.exists()) return defaultMenuPriceHubSettings();
  return normalizeMenuPriceHubSettings(snap.data());
}

/** อ่าน settings จากเซิร์ฟเวอร์ตรง ๆ — ใช้ก่อนเขียน/หลังเซฟ กันแคชเก่า */
export async function loadMenuPriceHubSettingsFromServer(): Promise<MenuPriceHubSettings> {
  const snap = await getDocFromServer(settingsDocRef());
  if (!snap.exists()) return defaultMenuPriceHubSettings();
  return normalizeMenuPriceHubSettings(snap.data());
}

function rulesEqual(a: ChannelPriceRule | null | undefined, b: ChannelPriceRule | null | undefined) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.mode === b.mode && Number(a.value) === Number(b.value);
}

function assertOverrideWritesPersisted(
  settings: MenuPriceHubSettings,
  writes: ChannelOverrideWrite[],
) {
  for (const w of writes) {
    const got =
      w.scope === "option"
        ? settings.optionOverrides[w.id]?.[w.channel]
        : settings.itemOverrides[w.id]?.[w.channel];
    if (!rulesEqual(got, w.rule ?? null)) {
      const label = w.scope === "option" ? `ตัวเลือก ${w.id}` : `เมนู ${w.id}`;
      throw new Error(
        `เซฟเป้าแล้วแต่ Firestore ยังไม่ตรง · ${label} · ${w.channel} — ลองอีกครั้ง`,
      );
    }
  }
}

/** Realtime สูตร/เป้าในตาราง — แก้ที่เครื่องอื่นหรือสคริปต์แล้วโผล่ทันที */
export function subscribeMenuPriceHubSettings(
  onNext: (settings: MenuPriceHubSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsDocRef(),
    { includeMetadataChanges: true },
    (snap) => {
      // จากแคชก็ส่งได้ — ฝั่ง UI กันด้วย updatedAt / settingsSavedAtRef
      onNext(
        snap.exists()
          ? normalizeMenuPriceHubSettings(snap.data())
          : defaultMenuPriceHubSettings(),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveMenuPriceHubSettings(
  settings: MenuPriceHubSettings,
): Promise<MenuPriceHubSettings> {
  const tableNote =
    typeof settings.tableNote === "string" && settings.tableNote.trim()
      ? settings.tableNote.trim()
      : null;
  const deliveryRule =
    settings.deliveryRule && typeof settings.deliveryRule === "object"
      ? parseRule(settings.deliveryRule, DEFAULT_DELIVERY_RULE)
      : undefined;
  const wroteAt = Date.now();
  const next: MenuPriceHubSettings = {
    channels: parseChannels(settings.channels),
    mainChannel: parseMainChannel(settings.mainChannel),
    followerAdd: parseFollowerAdd(settings.followerAdd),
    ...(deliveryRule ? { deliveryRule } : {}),
    itemOverrides: parseKeyedOverrides(settings.itemOverrides),
    optionOverrides: parseKeyedOverrides(settings.optionOverrides),
    ...(tableNote ? { tableNote } : {}),
    updatedAt: wroteAt,
  };
  // updateDoc แทน setDoc(merge) — ทับ itemOverrides/optionOverrides ทั้งก้อน
  // (merge:true จะ deep-merge map ทำให้ลบ override ไม่หาย / ค่าเก่าปนใหม่ได้)
  const payload: Record<string, unknown> = {
    channels: next.channels,
    mainChannel: next.mainChannel,
    followerAdd: next.followerAdd,
    itemOverrides: next.itemOverrides,
    optionOverrides: next.optionOverrides,
    updatedAt: wroteAt,
  };
  if (deliveryRule) payload.deliveryRule = deliveryRule;
  if (tableNote) payload.tableNote = tableNote;
  else payload.tableNote = deleteField();

  const existing = await getDocFromServer(settingsDocRef());
  if (existing.exists()) {
    await updateDoc(settingsDocRef(), payload);
  } else {
    const createPayload = { ...payload };
    if (!tableNote) delete createPayload.tableNote;
    await setDoc(settingsDocRef(), createPayload);
  }

  // ยืนยันจากเซิร์ฟเวอร์ก่อนบอกว่าเซฟแล้ว — กันแคช/ snapshot เก่า
  const verified = await loadMenuPriceHubSettingsFromServer();
  const verifiedAt = typeof verified.updatedAt === "number" ? verified.updatedAt : 0;
  if (verifiedAt < wroteAt) {
    throw new Error(
      `เซฟ settings แล้วยังไม่อ่านกลับจาก Firestore (updatedAt ${verifiedAt} < ${wroteAt}) — ลองอีกครั้ง`,
    );
  }
  return verified;
}

export async function saveChannelRules(channels: ChannelRules): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettingsFromServer();
  return saveMenuPriceHubSettings({ ...current, channels });
}

/** ซิงก์สูตรคอลัมน์เดียว — ไม่ทับสูตรช่องอื่นที่เพิ่งเซฟจากเครื่องอื่น */
export async function saveChannelRule(
  channel: DeliveryChannel,
  rule: ChannelPriceRule,
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettingsFromServer();
  return saveMenuPriceHubSettings({
    ...current,
    channels: { ...current.channels, [channel]: rule },
  });
}

export async function saveMainChannel(
  mainChannel: DeliveryChannel,
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettingsFromServer();
  return saveMenuPriceHubSettings({ ...current, mainChannel });
}

export async function saveFollowerAdd(
  channel: DeliveryChannel,
  add: FollowerAddRule,
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettingsFromServer();
  const followerAdd: FollowerAddRules = {
    ...(current.followerAdd || DEFAULT_FOLLOWER_ADD),
    [channel]: { mode: add.mode, value: Number(add.value) || 0 },
  };
  return saveMenuPriceHubSettings({ ...current, followerAdd });
}

function writeKeyedOverride(
  map: Record<string, ItemChannelOverrides>,
  key: string,
  channel: DeliveryChannel,
  rule: ChannelPriceRule | null,
): Record<string, ItemChannelOverrides> {
  const next = { ...map };
  const row: ItemChannelOverrides = { ...(next[key] || {}) };
  if (rule == null) {
    delete row[channel];
  } else {
    row[channel] = rule;
  }
  if (!Object.keys(row).length) delete next[key];
  else next[key] = row;
  return next;
}

/** รวม override หลายเซลล์ในหน่วยความจำ — ไม่แตะสูตรคอลัมน์ / ราคาหน้าร้าน / สแกนจริง */
export function applyManyChannelOverrideWrites(
  settings: MenuPriceHubSettings,
  writes: ChannelOverrideWrite[],
): MenuPriceHubSettings {
  let itemOverrides = settings.itemOverrides;
  let optionOverrides = settings.optionOverrides;
  for (const w of writes) {
    if (w.scope === "option") {
      optionOverrides = writeKeyedOverride(optionOverrides, w.id, w.channel, w.rule);
    } else {
      itemOverrides = writeKeyedOverride(itemOverrides, w.id, w.channel, w.rule);
    }
  }
  return { ...settings, itemOverrides, optionOverrides };
}

export async function setItemChannelOverride(
  itemId: string,
  channel: DeliveryChannel,
  rule: ChannelPriceRule | null,
): Promise<MenuPriceHubSettings> {
  const write: ChannelOverrideWrite = { scope: "item", id: itemId, channel, rule };
  const current = await loadMenuPriceHubSettingsFromServer();
  const verified = await saveMenuPriceHubSettings({
    ...current,
    itemOverrides: writeKeyedOverride(current.itemOverrides, itemId, channel, rule),
  });
  assertOverrideWritesPersisted(verified, [write]);
  return verified;
}

export async function setOptionChannelOverride(
  optionKey: string,
  channel: DeliveryChannel,
  rule: ChannelPriceRule | null,
): Promise<MenuPriceHubSettings> {
  const write: ChannelOverrideWrite = { scope: "option", id: optionKey, channel, rule };
  const current = await loadMenuPriceHubSettingsFromServer();
  const verified = await saveMenuPriceHubSettings({
    ...current,
    optionOverrides: writeKeyedOverride(current.optionOverrides, optionKey, channel, rule),
  });
  assertOverrideWritesPersisted(verified, [write]);
  return verified;
}

/** เขียน override หลายเซลล์ในเอกสารเดียว — ไม่แตะราคาหน้าร้าน */
export async function setManyChannelOverrides(
  writes: ChannelOverrideWrite[],
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettingsFromServer();
  const verified = await saveMenuPriceHubSettings(
    applyManyChannelOverrideWrites(current, writes),
  );
  assertOverrideWritesPersisted(verified, writes);
  return verified;
}
