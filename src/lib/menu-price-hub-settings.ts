import { doc, getDoc, setDoc } from "firebase/firestore";
import { getMenuDb } from "@/lib/pos-menu-db";
import {
  DEFAULT_CHANNEL_RULES,
  DEFAULT_DELIVERY_RULE,
  defaultMenuPriceHubSettings,
  type ChannelPriceRule,
  type ChannelRules,
  type DeliveryChannel,
  type ItemChannelOverrides,
  type MenuPriceHubSettings,
} from "@/lib/menu-channel-price";

const COL = "menuPriceHub";
const DOC_ID = "settings";

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
    ...(deliveryRule ? { deliveryRule } : {}),
    itemOverrides: parseKeyedOverrides(o.itemOverrides),
    optionOverrides: parseKeyedOverrides(o.optionOverrides),
    ...(tableNote ? { tableNote } : {}),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : undefined,
  };
}

export async function loadMenuPriceHubSettings(): Promise<MenuPriceHubSettings> {
  const snap = await getDoc(doc(getMenuDb(), COL, DOC_ID));
  if (!snap.exists()) return defaultMenuPriceHubSettings();
  return normalizeMenuPriceHubSettings(snap.data());
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
  const next: MenuPriceHubSettings = {
    channels: parseChannels(settings.channels),
    ...(deliveryRule ? { deliveryRule } : {}),
    itemOverrides: parseKeyedOverrides(settings.itemOverrides),
    optionOverrides: parseKeyedOverrides(settings.optionOverrides),
    ...(tableNote ? { tableNote } : {}),
    updatedAt: Date.now(),
  };
  await setDoc(
    doc(getMenuDb(), COL, DOC_ID),
    { ...next, tableNote },
    { merge: true },
  );
  return next;
}

export async function saveChannelRules(channels: ChannelRules): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettings();
  return saveMenuPriceHubSettings({ ...current, channels });
}

export type ChannelOverrideWrite = {
  scope: "item" | "option";
  id: string;
  channel: DeliveryChannel;
  rule: ChannelPriceRule | null;
};

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
  const current = await loadMenuPriceHubSettings();
  return saveMenuPriceHubSettings({
    ...current,
    itemOverrides: writeKeyedOverride(current.itemOverrides, itemId, channel, rule),
  });
}

export async function setOptionChannelOverride(
  optionKey: string,
  channel: DeliveryChannel,
  rule: ChannelPriceRule | null,
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettings();
  return saveMenuPriceHubSettings({
    ...current,
    optionOverrides: writeKeyedOverride(current.optionOverrides, optionKey, channel, rule),
  });
}

/** เขียน override หลายเซลล์ในเอกสารเดียว — ไม่แตะราคาหน้าร้าน */
export async function setManyChannelOverrides(
  writes: ChannelOverrideWrite[],
): Promise<MenuPriceHubSettings> {
  const current = await loadMenuPriceHubSettings();
  return saveMenuPriceHubSettings(applyManyChannelOverrideWrites(current, writes));
}
