import { doc, getDoc, getDocFromServer, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import {
  DELIVERY_CHANNELS,
  emptyChannelLiveStore,
  keepLiveOrderFields,
  UNMATCHED_CLEAN_ACTIONS,
  type ChannelLiveByItem,
  type ChannelLiveObservation,
  type ChannelLiveStore,
  type DeliveryChannel,
  type UnmatchedCleanAction,
  type UnmatchedLiveEntry,
  type UnmatchedLiveKind,
  type UnmatchedLiveReason,
} from "@/lib/menu-channel-price";
import { getMenuDb } from "@/lib/pos-menu-db";

const COL = "menuPriceHub";
const DOC_ID = "channelLive";

function parseObservation(raw: unknown): ChannelLiveObservation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  const price =
    typeof o.price === "number" && Number.isFinite(o.price)
      ? o.price
      : o.price === null
        ? null
        : null;
  if (!name.trim() && price == null) return null;
  const targetPrice =
    typeof o.targetPrice === "number" && Number.isFinite(o.targetPrice) ? o.targetPrice : null;
  const applyStatus = typeof o.applyStatus === "string" ? o.applyStatus : null;
  const applyNote = typeof o.applyNote === "string" ? o.applyNote : null;
  const cooldownUntil = typeof o.cooldownUntil === "string" ? o.cooldownUntil : null;
  const category = typeof o.category === "string" && o.category.trim() ? o.category : null;
  const sortIndex =
    typeof o.sortIndex === "number" && Number.isFinite(o.sortIndex) ? o.sortIndex : null;
  const choiceIndex =
    typeof o.choiceIndex === "number" && Number.isFinite(o.choiceIndex) ? o.choiceIndex : null;
  const groupNames = Array.isArray(o.groupNames)
    ? o.groupNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : null;
  return {
    name,
    price,
    scannedAt: typeof o.scannedAt === "string" ? o.scannedAt : null,
    source:
      o.source === "scan" || o.source === "manual" || o.source === "apply"
        ? o.source
        : "manual",
    externalId: typeof o.externalId === "string" ? o.externalId : null,
    ...(targetPrice != null ? { targetPrice } : {}),
    ...(applyStatus ? { applyStatus } : {}),
    ...(applyNote ? { applyNote } : {}),
    ...(cooldownUntil ? { cooldownUntil } : {}),
    ...(category ? { category } : {}),
    ...(sortIndex != null ? { sortIndex } : {}),
    ...(choiceIndex != null ? { choiceIndex } : {}),
    ...(groupNames?.length ? { groupNames } : {}),
  };
}

function parseByKeyMap(raw: unknown): ChannelLiveByItem {
  if (!raw || typeof raw !== "object") return {};
  const out: ChannelLiveByItem = {};
  for (const [id, chMap] of Object.entries(raw as Record<string, unknown>)) {
    if (!chMap || typeof chMap !== "object") continue;
    const row: Partial<Record<DeliveryChannel, ChannelLiveObservation>> = {};
    for (const ch of DELIVERY_CHANNELS) {
      const obs = parseObservation((chMap as Record<string, unknown>)[ch]);
      if (obs) row[ch] = obs;
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

const UNMATCHED_KINDS = new Set<UnmatchedLiveKind>(["item", "option", "category"]);
const UNMATCHED_REASONS = new Set<UnmatchedLiveReason>([
  "unmatched_name",
  "duplicate",
  "extra",
  "hidden",
]);

function parseUnmatchedEntry(raw: unknown): UnmatchedLiveEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const channel = o.channel;
  const kind = o.kind;
  const reason = o.reason;
  if (typeof channel !== "string" || !DELIVERY_CHANNELS.includes(channel as DeliveryChannel)) {
    return null;
  }
  if (typeof kind !== "string" || !UNMATCHED_KINDS.has(kind as UnmatchedLiveKind)) return null;
  if (typeof reason !== "string" || !UNMATCHED_REASONS.has(reason as UnmatchedLiveReason)) {
    return null;
  }
  const name = typeof o.name === "string" ? o.name : "";
  const price =
    typeof o.price === "number" && Number.isFinite(o.price) ? o.price : null;
  if (!name.trim() && price == null) return null;
  const id = typeof o.id === "string" && o.id.trim() ? o.id : "";
  const group = typeof o.group === "string" && o.group.trim() ? o.group : null;
  const externalId = typeof o.externalId === "string" && o.externalId.trim() ? o.externalId : null;
  const related =
    typeof o.related === "number" && Number.isFinite(o.related) ? o.related : undefined;
  const rawAction = o.cleanAction;
  const cleanAction: UnmatchedCleanAction | undefined =
    typeof rawAction === "string" && UNMATCHED_CLEAN_ACTIONS.includes(rawAction as UnmatchedCleanAction)
      ? (rawAction as UnmatchedCleanAction)
      : reason === "hidden"
        ? "blocked"
        : kind === "category"
          ? "delete_empty_cat"
          : related != null && related > 0
            ? "review"
            : kind === "option" && reason === "duplicate"
              ? "delete_orphan"
              : "review";
  return {
    id:
      id ||
      `${channel}:${kind}:${externalId || ""}:${name}:${group || ""}`,
    kind: kind as UnmatchedLiveKind,
    channel: channel as DeliveryChannel,
    name: name || "(ไม่มีชื่อ)",
    group,
    price,
    externalId,
    ...(related != null ? { related } : {}),
    reason: reason as UnmatchedLiveReason,
    cleanAction,
    scannedAt: typeof o.scannedAt === "string" ? o.scannedAt : null,
  };
}

function parseUnmatchedList(raw: unknown): UnmatchedLiveEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: UnmatchedLiveEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const e = parseUnmatchedEntry(row);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export function normalizeChannelLiveStore(data: unknown): ChannelLiveStore {
  if (!data || typeof data !== "object") return emptyChannelLiveStore();
  const o = data as Record<string, unknown>;
  return {
    items: parseByKeyMap(o.items),
    options: parseByKeyMap(o.options),
    unmatched: parseUnmatchedList(o.unmatched),
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : undefined,
  };
}

export async function loadChannelLiveStore(): Promise<ChannelLiveStore> {
  const snap = await getDoc(doc(getMenuDb(), COL, DOC_ID));
  if (!snap.exists()) return emptyChannelLiveStore();
  return normalizeChannelLiveStore(snap.data());
}

/** บังคับอ่านจากเซิร์ฟเวอร์ — ใช้ตอนเปิด hub กัน persistent cache ค้าง */
export async function loadChannelLiveStoreFromServer(): Promise<ChannelLiveStore> {
  try {
    const snap = await getDocFromServer(doc(getMenuDb(), COL, DOC_ID));
    if (!snap.exists()) return emptyChannelLiveStore();
    return normalizeChannelLiveStore(snap.data());
  } catch {
    return loadChannelLiveStore();
  }
}

/** Realtime hub live prices — แถวอัปเดตจากสคริปต์ apply จะโผล่ทันที */
export function subscribeChannelLiveStore(
  onNext: (store: ChannelLiveStore) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getMenuDb(), COL, DOC_ID),
    (snap) => {
      onNext(snap.exists() ? normalizeChannelLiveStore(snap.data()) : emptyChannelLiveStore());
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveChannelLiveStore(store: ChannelLiveStore): Promise<ChannelLiveStore> {
  const next = normalizeChannelLiveStore({
    ...store,
    updatedAt: Date.now(),
  });
  next.updatedAt = Date.now();
  await setDoc(doc(getMenuDb(), COL, DOC_ID), next, { merge: false });
  return next;
}

function withoutApplyNote(
  obs: ChannelLiveObservation,
): ChannelLiveObservation {
  const next: ChannelLiveObservation = {
    name: obs.name || "",
    price: obs.price,
    scannedAt: obs.scannedAt ?? null,
    source: obs.source ?? "manual",
    externalId: obs.externalId ?? null,
  };
  if (obs.targetPrice != null) next.targetPrice = obs.targetPrice;
  if (obs.applyStatus) next.applyStatus = obs.applyStatus;
  if (obs.cooldownUntil) next.cooldownUntil = obs.cooldownUntil;
  return keepLiveOrderFields(obs, next);
}

function stripApplyNotesMap(map: ChannelLiveByItem): ChannelLiveByItem {
  const out: ChannelLiveByItem = {};
  for (const [id, chMap] of Object.entries(map)) {
    const row: Partial<Record<DeliveryChannel, ChannelLiveObservation>> = {};
    for (const ch of DELIVERY_CHANNELS) {
      const obs = chMap[ch];
      if (obs) row[ch] = withoutApplyNote(obs);
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

/** ลบข้อความ apply ในเซล — คอลัมน์ Note จะไม่ดึง applyNote มาโชว์ต่อ */
export async function stripChannelLiveApplyNotes(): Promise<ChannelLiveStore> {
  const current = await loadChannelLiveStoreFromServer();
  return saveChannelLiveStore({
    ...current,
    items: stripApplyNotesMap(current.items),
    options: stripApplyNotesMap(current.options),
  });
}

function writeObservation(
  map: ChannelLiveByItem,
  id: string,
  channel: DeliveryChannel,
  observation: ChannelLiveObservation | null,
): ChannelLiveByItem {
  const nextMap = { ...map };
  const row: Partial<Record<DeliveryChannel, ChannelLiveObservation>> = {
    ...(nextMap[id] || {}),
  };
  if (observation == null) {
    delete row[channel];
  } else {
    const next: ChannelLiveObservation = {
      name: observation.name || "",
      price:
        typeof observation.price === "number" && Number.isFinite(observation.price)
          ? observation.price
          : null,
      scannedAt: observation.scannedAt ?? new Date().toISOString(),
      source: observation.source ?? "manual",
      externalId: observation.externalId ?? null,
    };
    if (observation.targetPrice != null && Number.isFinite(observation.targetPrice)) {
      next.targetPrice = observation.targetPrice;
    }
    if (observation.applyStatus) next.applyStatus = observation.applyStatus;
    if (observation.applyNote) next.applyNote = observation.applyNote;
    if (observation.cooldownUntil) next.cooldownUntil = observation.cooldownUntil;
    if (observation.category) next.category = observation.category;
    if (observation.sortIndex != null && Number.isFinite(Number(observation.sortIndex))) {
      next.sortIndex = Number(observation.sortIndex);
    }
    if (observation.choiceIndex != null && Number.isFinite(Number(observation.choiceIndex))) {
      next.choiceIndex = Number(observation.choiceIndex);
    }
    if (observation.groupNames?.length) next.groupNames = observation.groupNames;
    row[channel] = keepLiveOrderFields(row[channel], next);
  }
  if (!Object.keys(row).length) delete nextMap[id];
  else nextMap[id] = row;
  return nextMap;
}

/** บันทึกค่าสแกนเมนู × ช่องทาง — ไม่แตะราคาต้นแบบ POS */
export async function setItemChannelLive(
  itemId: string,
  channel: DeliveryChannel,
  observation: ChannelLiveObservation | null,
): Promise<ChannelLiveStore> {
  const current = await loadChannelLiveStore();
  return saveChannelLiveStore({
    ...current,
    items: writeObservation(current.items, itemId, channel, observation),
  });
}

/** บันทึกค่าสแกนตัวเลือก × ช่องทาง — คีย์ groupId::choiceId */
export async function setOptionChannelLive(
  optionKey: string,
  channel: DeliveryChannel,
  observation: ChannelLiveObservation | null,
): Promise<ChannelLiveStore> {
  const current = await loadChannelLiveStore();
  return saveChannelLiveStore({
    ...current,
    options: writeObservation(current.options, optionKey, channel, observation),
  });
}

function clearMapChannels(map: ChannelLiveByItem, channels: DeliveryChannel[]): ChannelLiveByItem {
  const out: ChannelLiveByItem = {};
  for (const [id, row] of Object.entries(map)) {
    const nextRow: Partial<Record<DeliveryChannel, ChannelLiveObservation>> = { ...row };
    for (const ch of channels) delete nextRow[ch];
    if (Object.keys(nextRow).length) out[id] = nextRow;
  }
  return out;
}

/** เคลียร์ค่าสแกนทั้งช่องทาง (เมนู+ตัวเลือก) — ใช้ก่อนซิงค์/รอสแกนใหม่ */
export async function clearChannelLiveForChannels(
  channels: DeliveryChannel[],
): Promise<ChannelLiveStore> {
  const current = await loadChannelLiveStore();
  return saveChannelLiveStore({
    items: clearMapChannels(current.items, channels),
    options: clearMapChannels(current.options, channels),
    unmatched: (current.unmatched || []).filter((e) => !channels.includes(e.channel)),
  });
}
