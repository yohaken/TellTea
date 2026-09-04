/**
 * Multi-channel menu price targets + live match status.
 * Base = ราคาหน้าร้าน (price / priceDelta); สูตรรายช่องทาง (GP% / คงที่) ต่อแพลตฟอร์ม
 * — percent/offset ยังอ่านได้จากเอกสารเก่า แต่ UI ตั้งค่าเหลือ GP% กับคงที่
 * — ไม่ใช้ราคาต้นแบบเดลิเวอรี่กลาง เพราะ GP แต่ละช่องทางไม่เท่ากัน
 */

import { bestMatchByName, isMenuStoreOnly, normName } from "@/lib/menu-name-match";
import type { MenuItem } from "@/lib/types";

export type DeliveryChannel = "shopee" | "grab" | "lineman";

export const DELIVERY_CHANNELS: DeliveryChannel[] = ["shopee", "grab", "lineman"];

export type ChannelPriceMode = "percent" | "offset" | "absolute" | "gp";

/** โหมดที่ตั้งในฮับได้ — เก็บ percent/offset ไว้ถอดสูตรเก่าเท่านั้น */
export const HUB_UI_PRICE_MODES: ChannelPriceMode[] = ["gp", "absolute"];

export type ChannelPriceRule = {
  mode: ChannelPriceMode;
  value: number;
};

export type ChannelRules = Record<DeliveryChannel, ChannelPriceRule>;

export type ItemChannelOverrides = Partial<Record<DeliveryChannel, ChannelPriceRule>>;

export type MenuPriceHubSettings = {
  channels: ChannelRules;
  /**
   * @deprecated เลิกใช้คอลัมน์ต้นแบบส่ง — เป้าแพลตฟอร์มอิงหน้าร้านตรง
   * คงไว้เพื่ออ่านเอกสารเก่าใน Firestore โดยไม่บังคับ
   */
  deliveryRule?: ChannelPriceRule;
  itemOverrides: Record<string, ItemChannelOverrides>;
  /** คีย์ = `${groupId}::${choiceId}` — override เป้าตัวเลือกแยกจากสูตรคอลัมน์ */
  optionOverrides: Record<string, ItemChannelOverrides>;
  /**
   * โน้ตรวมของตารางเทียบช่องทาง (ไม่ใช่ note รายเมนู)
   * ใช้เก็บสรุป/คิวงาน เช่น เมนูมีบนแพลตฟอร์มแต่ไม่มีใน POS — ให้คนหรือ AI อ่านแล้วสั่งงานต่อ
   */
  tableNote?: string;
  updatedAt?: number;
};

export type LiveChannelItem = {
  id: string;
  name: string;
  listPrice: number | null;
};

export type LiveChannelSnapshot = {
  scannedAt: string | null;
  count: number;
  items: LiveChannelItem[];
};

/**
 * ราคา/ชื่อที่สแกนหรือกรอกจากช่องทาง — แยกจากราคาหน้าร้าน POS
 * และแยกจากสูตรเป้า (settings.channels / itemOverrides)
 */
export type ChannelLiveObservation = {
  name: string;
  price: number | null;
  scannedAt?: string | null;
  source?: "scan" | "manual" | "apply";
  externalId?: string | null;
  /** เป้าจาก hub ตอน apply ล่าสุด */
  targetPrice?: number | null;
  /** สถานะ apply ล่าสุด เช่น reached_target, blocked_24h */
  applyStatus?: string | null;
  /** โน้ตสั้นจากสคริปต์ apply — แสดงใน tooltip เวลาอัปเดต */
  applyNote?: string | null;
  /** Shopee 24h cooldown จนถึง */
  cooldownUntil?: string | null;
};

export type ChannelLiveByItem = Record<
  string,
  Partial<Record<DeliveryChannel, ChannelLiveObservation>>
>;

export type ChannelLiveStore = {
  items: ChannelLiveByItem;
  /** คีย์ = `${groupId}::${choiceId}` — สแกนตัวเลือก แยกจากราคาต้นแบบ */
  options: ChannelLiveByItem;
  updatedAt?: number;
};

export type ChannelMatchStatus = "match" | "mismatch" | "no_live" | "unmatched" | "na";

/** เทียบชื่อ POS ↔ ช่องทาง (แยกจากสถานะราคา) */
export type ChannelNameStatus = "exact" | "near" | "missing" | "skip";

export type ChannelPriceCell = {
  target: number;
  live: number | null;
  liveName: string | null;
  liveId: string | null;
  score: number | null;
  status: ChannelMatchStatus;
  nameStatus: ChannelNameStatus;
  fromOverride: boolean;
  /** เฉพาะหน้าร้าน — ไม่มีเดลิเวอรี่/ช่องทาง */
  storeOnly?: boolean;
};

export const DEFAULT_CHANNEL_RULES: ChannelRules = {
  shopee: { mode: "gp", value: 22 },
  grab: { mode: "gp", value: 30 },
  lineman: { mode: "gp", value: 30 },
};

/** @deprecated ไม่ใช้แล้ว — คงไว้สำหรับเอกสารเก่า */
export const DEFAULT_DELIVERY_RULE: ChannelPriceRule = { mode: "offset", value: 0 };

export function defaultMenuPriceHubSettings(): MenuPriceHubSettings {
  return {
    channels: { ...DEFAULT_CHANNEL_RULES },
    itemOverrides: {},
    optionOverrides: {},
  };
}

/** ฐานราคาแพลตฟอร์ม = ราคาหน้าร้าน */
export function resolveStoreBase(item: Pick<MenuItem, "price">): number {
  return Math.max(0, Number(item.price) || 0);
}

/** ฐานส่วนเพิ่มตัวเลือก = ส่วนเพิ่มหน้าร้าน */
export function resolveOptionStoreBase(choice: { priceDelta?: number }): number {
  return Math.max(0, Number(choice.priceDelta) || 0);
}

export function applyChannelRule(base: number, rule: ChannelPriceRule): number {
  const value = Number(rule.value) || 0;
  let raw: number;
  if (rule.mode === "absolute") {
    raw = value;
  } else if (rule.mode === "percent") {
    raw = base * (1 + value / 100);
  } else if (rule.mode === "gp") {
    // จีพีแพลตฟอร์ม: ตั้งราคาขายให้หลังหัก GP เหลือเท่าเบสหน้าร้าน
    // sell * (1 - gp/100) = base → sell = base / (1 - gp/100)
    const gp = Math.min(99.9, Math.max(0, value));
    const keep = 1 - gp / 100;
    raw = keep > 0 ? base / keep : base;
  } else {
    raw = base + value;
  }
  return Math.max(0, Math.round(raw));
}

/** คืน GP% ถ้ารูปแบบเป็น gp ไม่เช่นนั้น null */
export function gpPercentOf(rule: ChannelPriceRule | null | undefined): number | null {
  if (!rule || rule.mode !== "gp") return null;
  return Math.min(99.9, Math.max(0, Number(rule.value) || 0));
}

/** หลังหักจีพีแพลตฟอร์ม เหลือถึงร้านกี่บาท */
export function netAfterPlatformGp(sell: number, gpPercent: number): number {
  const gp = Math.min(99.9, Math.max(0, Number(gpPercent) || 0));
  return Math.max(0, Math.round((Number(sell) || 0) * (1 - gp / 100)));
}

/**
 * ขายที่ราคานี้แล้ว “เหลือถึงร้าน” ตามสูตรคอลัมน์ (ทุกโหมด)
 * — gp: หลังหักจีพี
 * — %: ถอด % กลับเป็นฐานเทียบหน้าร้าน
 * — มาร์จ: ขาย − มาร์จ
 * — คงที่: ไม่ใช้คำนวณ net โดยตรง — ใช้ resolveNetRule + สูตรคอลัมน์แทน
 */
export function netToShopFromSell(sell: number, rule: ChannelPriceRule): number {
  const price = Math.max(0, Number(sell) || 0);
  const value = Number(rule.value) || 0;
  if (rule.mode === "gp") {
    return netAfterPlatformGp(price, value);
  }
  if (rule.mode === "percent") {
    const factor = 1 + value / 100;
    if (!Number.isFinite(factor) || factor === 0) return price;
    return Math.max(0, Math.round(price / factor));
  }
  if (rule.mode === "offset") {
    return Math.max(0, Math.round(price - value));
  }
  // absolute — ไม่มีสูตรถอด ถือว่าได้ตามราคาขาย (ควรส่ง column rule ผ่าน resolveNetRule แทน)
  return Math.max(0, Math.round(price));
}

/**
 * สูตรสำหรับป้าย “เหลือถึงร้าน”
 * — เป้าคงที่ (absolute): ใช้สูตรคอลัมน์ (เช่น GP 22%) หักจริง
 * — อื่นๆ: ใช้กติกาเซลนั้น (รวม override GP/%/มาร์จ)
 */
export function resolveNetRule(
  cellRule: ChannelPriceRule,
  columnRule: ChannelPriceRule,
): ChannelPriceRule {
  if (cellRule.mode === "absolute") return columnRule;
  return cellRule;
}

export function netToShopTitle(sell: number, rule: ChannelPriceRule, store: number): string {
  const net = netToShopFromSell(sell, rule);
  if (rule.mode === "gp") {
    return `ขาย ${sell}฿ · หัก GP ${rule.value}% → เหลือถึงร้าน ${net}฿ (หน้าร้าน ${store}฿)`;
  }
  if (rule.mode === "percent") {
    return `ขาย ${sell}฿ · ถอด ${formatRuleShort(rule)} → เหลือถึงร้าน ${net}฿ (หน้าร้าน ${store}฿)`;
  }
  if (rule.mode === "offset") {
    return `ขาย ${sell}฿ · หักมาร์จ ${rule.value}฿ → เหลือถึงร้าน ${net}฿ (หน้าร้าน ${store}฿)`;
  }
  return `ขาย ${sell}฿ → เหลือถึงร้าน ${net}฿ (หน้าร้าน ${store}฿)`;
}

export function resolveChannelTarget(
  item: Pick<MenuItem, "id" | "price">,
  channel: DeliveryChannel,
  settings: MenuPriceHubSettings,
): { target: number; fromOverride: boolean } {
  const base = resolveStoreBase(item);
  const override = settings.itemOverrides[item.id]?.[channel];
  if (override) {
    return { target: applyChannelRule(base, override), fromOverride: true };
  }
  const rule = settings.channels[channel] ?? DEFAULT_CHANNEL_RULES[channel];
  return { target: applyChannelRule(base, rule), fromOverride: false };
}

export function resolveOptionChannelTarget(
  base: number,
  channel: DeliveryChannel,
  settings: MenuPriceHubSettings,
  optionKey?: string,
): { target: number; fromOverride: boolean } {
  const override = optionKey
    ? settings.optionOverrides[optionKey]?.[channel]
    : undefined;
  if (override) {
    return { target: applyChannelRule(base, override), fromOverride: true };
  }
  const rule = settings.channels[channel] ?? DEFAULT_CHANNEL_RULES[channel];
  return { target: applyChannelRule(base, rule), fromOverride: false };
}

/** เซลล์แพลตฟอร์มของตัวเลือก — แพทเทิร์นเดียวกับเมนู (ชื่อ+ราคา) */
export function channelCellForOption(
  posName: string,
  base: number,
  channel: DeliveryChannel,
  settings: MenuPriceHubSettings,
  liveItems: LiveChannelItem[] = [],
  observation?: ChannelLiveObservation | null,
  optionKey?: string,
): ChannelPriceCell {
  const { target, fromOverride } = resolveOptionChannelTarget(
    base,
    channel,
    settings,
    optionKey,
  );

  if (observation) {
    const liveName = (observation.name || "").trim() || null;
    const live =
      typeof observation.price === "number" && Number.isFinite(observation.price)
        ? observation.price
        : null;
    let nameStatus: ChannelNameStatus = "missing";
    let score: number | null = null;
    if (liveName) {
      if (normName(posName) === normName(liveName)) {
        nameStatus = "exact";
        score = 1;
      } else {
        nameStatus = "near";
        score = 0.7;
      }
    }
    if (live == null) {
      return {
        target,
        live: null,
        liveName,
        liveId: observation.externalId ?? null,
        score,
        status: liveName ? "no_live" : "unmatched",
        nameStatus: liveName ? nameStatus : "missing",
        fromOverride,
      };
    }
    return {
      target,
      live,
      liveName,
      liveId: observation.externalId ?? null,
      score,
      status: live === target ? "match" : "mismatch",
      nameStatus: liveName ? nameStatus : "missing",
      fromOverride,
    };
  }

  const matched = matchLiveForPos(posName, liveItems);
  const nameStatus = nameStatusForMatch(posName, matched, false);
  if (!matched) {
    return {
      target,
      live: null,
      liveName: null,
      liveId: null,
      score: null,
      status: "unmatched",
      nameStatus,
      fromOverride,
    };
  }
  const live = matched.item.listPrice;
  if (live == null || Number.isNaN(live)) {
    return {
      target,
      live: null,
      liveName: matched.item.name,
      liveId: matched.item.id,
      score: matched.score,
      status: "no_live",
      nameStatus,
      fromOverride,
    };
  }
  return {
    target,
    live,
    liveName: matched.item.name,
    liveId: matched.item.id,
    score: matched.score,
    status: live === target ? "match" : "mismatch",
    nameStatus,
    fromOverride,
  };
}

export function matchLiveForPos(
  posName: string,
  liveItems: LiveChannelItem[],
): { item: LiveChannelItem; score: number } | null {
  const hit = bestMatchByName(posName, liveItems, { minScore: 0.5 });
  if (!hit) return null;
  return { item: hit, score: hit.score };
}

function nameStatusForMatch(
  posName: string,
  matched: { item: LiveChannelItem; score: number } | null,
  storeOnly: boolean,
): ChannelNameStatus {
  if (storeOnly) return "skip";
  if (!matched) return "missing";
  if (matched.score >= 1 || normName(posName) === normName(matched.item.name)) return "exact";
  return "near";
}

export function channelCellForItem(
  item: MenuItem,
  channel: DeliveryChannel,
  settings: MenuPriceHubSettings,
  liveItems: LiveChannelItem[],
  /** ค่าที่บันทึกใน hub (สแกน/แก้มือ) — มีแล้วใช้ก่อน fuzzy จาก snapshot */
  observation?: ChannelLiveObservation | null,
): ChannelPriceCell {
  const { target, fromOverride } = resolveChannelTarget(item, channel, settings);
  const storeOnly = isMenuStoreOnly(item);

  if (storeOnly) {
    return {
      target,
      live: null,
      liveName: null,
      liveId: null,
      score: null,
      status: "na",
      nameStatus: "skip",
      fromOverride: false,
      storeOnly: true,
    };
  }

  if (observation) {
    const liveName = (observation.name || "").trim() || null;
    const live =
      typeof observation.price === "number" && Number.isFinite(observation.price)
        ? observation.price
        : null;
    let nameStatus: ChannelNameStatus = "missing";
    let score: number | null = null;
    if (liveName) {
      if (normName(item.name) === normName(liveName)) {
        nameStatus = "exact";
        score = 1;
      } else {
        nameStatus = "near";
        score = 0.7;
      }
    }
    if (live == null) {
      return {
        target,
        live: null,
        liveName,
        liveId: observation.externalId ?? null,
        score,
        status: liveName ? "no_live" : "unmatched",
        nameStatus: liveName ? nameStatus : "missing",
        fromOverride,
      };
    }
    return {
      target,
      live,
      liveName,
      liveId: observation.externalId ?? null,
      score,
      status: live === target ? "match" : "mismatch",
      nameStatus: liveName ? nameStatus : "missing",
      fromOverride,
    };
  }

  const matched = matchLiveForPos(item.name, liveItems);
  const nameStatus = nameStatusForMatch(item.name, matched, false);

  if (!matched) {
    return {
      target,
      live: null,
      liveName: null,
      liveId: null,
      score: null,
      status: "unmatched",
      nameStatus,
      fromOverride,
    };
  }

  const live = matched.item.listPrice;
  if (live == null || Number.isNaN(live)) {
    return {
      target,
      live: null,
      liveName: matched.item.name,
      liveId: matched.item.id,
      score: matched.score,
      status: "no_live",
      nameStatus,
      fromOverride,
    };
  }

  return {
    target,
    live,
    liveName: matched.item.name,
    liveId: matched.item.id,
    score: matched.score,
    status: live === target ? "match" : "mismatch",
    nameStatus,
    fromOverride,
  };
}

export type HubStatusFilter =
  | "all"
  | "mismatch"
  | "no_live"
  | "unmatched"
  | "name_issue"
  | "na";

export function summarizeRowChannels(
  channels: Record<DeliveryChannel, ChannelPriceCell>,
  only: readonly DeliveryChannel[] = DELIVERY_CHANNELS,
): ChannelMatchStatus {
  const list = only.length ? only : DELIVERY_CHANNELS;
  // เฉพาะหน้าร้าน (na) ไม่ดึง worst เป็นปัญหา
  const order: ChannelMatchStatus[] = ["mismatch", "unmatched", "no_live", "match"];
  for (const s of order) {
    if (list.some((c) => channels[c].status === s)) return s;
  }
  if (list.every((c) => channels[c].status === "na" || channels[c].storeOnly)) {
    return "na";
  }
  return "match";
}

export function rowHasNameIssue(
  channels: Record<DeliveryChannel, ChannelPriceCell>,
  only: readonly DeliveryChannel[] = DELIVERY_CHANNELS,
): boolean {
  const list = only.length ? only : DELIVERY_CHANNELS;
  return list.some(
    (c) => channels[c].nameStatus === "near" || channels[c].nameStatus === "missing",
  );
}

export function rowMatchesFilter(
  worst: ChannelMatchStatus,
  channels: Record<DeliveryChannel, ChannelPriceCell>,
  filter: HubStatusFilter,
  only?: readonly DeliveryChannel[],
): boolean {
  if (filter === "all") return true;
  if (filter === "name_issue") return rowHasNameIssue(channels, only);
  return worst === filter;
}

export type HubTotals = {
  match: number;
  mismatch: number;
  no_live: number;
  unmatched: number;
  name_issue: number;
  na: number;
};

export function emptyHubTotals(): HubTotals {
  return { match: 0, mismatch: 0, no_live: 0, unmatched: 0, name_issue: 0, na: 0 };
}

export function channelLabel(channel: DeliveryChannel): string {
  if (channel === "shopee") return "Shopee";
  if (channel === "grab") return "Grab";
  return "LINE MAN";
}

export function statusLabel(status: ChannelMatchStatus): string {
  if (status === "match") return "ตรง";
  if (status === "mismatch") return "ไม่ตรง";
  if (status === "no_live") return "ไม่มีจริง";
  if (status === "na") return "เฉพาะหน้าร้าน";
  return "ไม่จับคู่";
}

export function nameStatusLabel(status: ChannelNameStatus): string {
  if (status === "exact") return "ตรง";
  if (status === "near") return "ใกล้";
  if (status === "missing") return "ไม่มี";
  return "ข้าม";
}

export function formatRuleShort(rule: ChannelPriceRule): string {
  if (rule.mode === "absolute") return `คงที่ ฿${rule.value}`;
  if (rule.mode === "percent") return `${rule.value > 0 ? "+" : ""}${rule.value}%`;
  if (rule.mode === "gp") return `GP ${rule.value}%`;
  return `มาร์จ ${rule.value > 0 ? "+" : ""}${rule.value}฿`;
}

/** ป้ายสั้นในเซลตาราง — บอกประเภทสูตร */
export function formatRuleCellBadge(rule: ChannelPriceRule, fromOverride = false): string {
  if (fromOverride && rule.mode === "absolute") return "ระบุราคา";
  const core =
    rule.mode === "absolute"
      ? `คงที่${rule.value}`
      : rule.mode === "percent"
        ? `${rule.value > 0 ? "+" : ""}${rule.value}%`
        : rule.mode === "gp"
          ? `GP${rule.value}`
          : `ม${rule.value > 0 ? "+" : ""}${rule.value}`;
  return fromOverride ? `ระบุ·${core}` : core;
}

export function ruleModeLabelTh(rule: ChannelPriceRule): string {
  if (rule.mode === "absolute") return "ราคาคงที่";
  if (rule.mode === "percent") return "เปอร์เซ็นต์จากหน้าร้าน";
  if (rule.mode === "gp") return "จีพีแพลตฟอร์ม";
  return "มาร์จิ้นคงที่";
}

/** มาร์จิ้นเทียบเบสหน้าร้าน = ราคาขาย − เบส (บาท) */
export function marginFromBase(sell: number, base: number): number {
  return Math.round(Number(sell) || 0) - Math.round(Number(base) || 0);
}

export function formatMarginShort(delta: number): string {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : String(delta);
}

/** Input width in ch — enough padding so digits never clip */
export function priceInputCh(value: string | number): number {
  const s = String(value ?? "").replace(/[^\d.-]/g, "");
  return Math.max(3, Math.min(6, (s.length || 1) + 1));
}
