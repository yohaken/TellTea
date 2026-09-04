"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Info } from "lucide-react";
import {
  DELIVERY_CHANNELS,
  channelCellForItem,
  channelCellForOption,
  channelLabel,
  emptyHubTotals,
  formatRuleShort,
  formatRuleCellBadge,
  ruleModeLabelTh,
  nameStatusLabel,
  priceInputCh,
  resolveStoreBase,
  resolveOptionStoreBase,
  marginFromBase,
  formatMarginShort,
  applyChannelRule,
  netToShopFromSell,
  netToShopTitle,
  resolveNetRule,
  rowHasNameIssue,
  rowMatchesFilter,
  statusLabel,
  summarizeRowChannels,
  type ChannelLiveStore,
  type ChannelLiveObservation,
  type ChannelMatchStatus,
  type ChannelPriceCell,
  HUB_UI_PRICE_MODES,
  type ChannelPriceMode,
  type ChannelPriceRule,
  type ChannelRules,
  type DeliveryChannel,
  type HubStatusFilter,
  type LiveChannelItem,
  type MenuPriceHubSettings,
} from "@/lib/menu-channel-price";
import { isMenuStoreOnly } from "@/lib/menu-name-match";
import {
  clearChannelLiveForChannels,
  loadChannelLiveStoreFromServer,
  saveChannelLiveStore,
  setItemChannelLive,
  setOptionChannelLive,
  stripChannelLiveApplyNotes,
  subscribeChannelLiveStore,
} from "@/lib/menu-price-hub-live";
import { applyShopeeExportToLiveStore, parseShopeeExportFiles } from "@/lib/shopee-export";
import {
  loadMenuPriceHubSettings,
  saveChannelRule,
  saveChannelRules,
  saveMenuPriceHubSettings,
  setItemChannelOverride,
  setOptionChannelOverride,
  setManyChannelOverrides,
  subscribeMenuPriceHubSettings,
} from "@/lib/menu-price-hub-settings";
import { HUB_TABLE_NOTE_GUIDE } from "@/lib/menu-price-hub-guide";
import { clearMenuItemHubNotes, setMenuItemHubNotes, updateMenuItem } from "@/lib/pos-menu";
import { saveMenuOptionGroupFull, setMenuOptionChoiceHubNotes } from "@/lib/pos-menu-options";
import { menuTextIncludes, normalizeMenuSearchText } from "@/lib/pos-menu-text";
import type { MenuCategory, MenuItem, MenuOptionChoice, MenuOptionGroup } from "@/lib/types";

type PriceDraft = { store: string };
type LiveDraft = { name: string; price: string };

/** draft ว่างไม่ทับค่าสแกนใน hub — กันช่อง L เป็น ∅ ทั้งที่มีราคา */
function observationFromDraftOrStored(
  waiting: boolean,
  stored: ChannelLiveObservation | null | undefined,
  ld: LiveDraft | undefined,
): ChannelLiveObservation | null {
  if (waiting) return null;
  if (!ld) return stored ?? null;
  const draftPrice =
    ld.price.trim() === "" ? null : Math.max(0, Number(ld.price) || 0);
  const draftName = ld.name.trim();
  if (draftPrice == null && !draftName) return stored ?? null;
  return {
    name: ld.name,
    price: draftPrice,
    source: "manual",
    scannedAt: stored?.scannedAt ?? null,
    externalId: stored?.externalId ?? null,
  };
}

function liveDraftKey(itemId: string, channel: DeliveryChannel) {
  return `${itemId}::${channel}`;
}

type OptRow = {
  groupId: string;
  groupName: string;
  choice: MenuOptionChoice;
  channels: Record<DeliveryChannel, ChannelPriceCell>;
  worst: ChannelMatchStatus;
  storeOnly: boolean;
};

type OverrideDraft = {
  scope: "item" | "option";
  id: string;
  label: string;
  channel: DeliveryChannel;
  mode: ChannelPriceMode;
  value: string;
  /** เบสหน้าร้าน — ใช้พรีวิวเป้า/มาร์จิ้น */
  base: number;
};

type TargetEditState = {
  scope: "item" | "option";
  id: string;
  channel: DeliveryChannel;
  value: string;
  original: number;
};

function sameTargetEdit(a: TargetEditState | null, b: TargetEditState): boolean {
  return !!a && a.scope === b.scope && a.id === b.id && a.channel === b.channel;
}

function overrideEditorDefaults(
  existing: ChannelPriceRule | undefined,
  channelRule: ChannelPriceRule,
  currentTarget: number,
): { mode: ChannelPriceMode; value: string } {
  if (existing?.mode === "gp" || existing?.mode === "absolute") {
    return { mode: existing.mode, value: String(existing.value) };
  }
  if (existing) return { mode: "absolute", value: String(currentTarget) };
  if (channelRule.mode === "gp") return { mode: "gp", value: String(channelRule.value) };
  return { mode: "absolute", value: String(currentTarget) };
}

function HubPriceModeOptions({ current }: { current: ChannelPriceMode }) {
  return (
    <>
      {current === "percent" ? <option value="percent">% (เดิม)</option> : null}
      {current === "offset" ? <option value="offset">มาร์จ (เดิม)</option> : null}
      {HUB_UI_PRICE_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {mode === "gp" ? "GP%" : "คงที่"}
        </option>
      ))}
    </>
  );
}

function TargetPriceField({
  target,
  fromOverride,
  selected,
  title,
  ariaLabel,
  editing,
  editValue,
  onSelectClick,
  onDoubleClick,
  onChange,
  onCommit,
  onCancel,
}: {
  target: number;
  fromOverride: boolean;
  selected?: boolean;
  title: string;
  ariaLabel: string;
  editing: boolean;
  editValue: string;
  onSelectClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const skipBlurRef = useRef(false);
  if (editing) {
    return (
      <input
        type="text"
        inputMode="decimal"
        className="mph-input mph-target-edit"
        value={editValue}
        aria-label={ariaLabel}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          onCommit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            skipBlurRef.current = true;
            onCancel();
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`mph-pair-t${fromOverride ? " is-ov" : ""}${selected ? " is-sel" : ""}`}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={!!selected}
      onClick={(e) => {
        if (e.detail > 1) return;
        onSelectClick?.(e);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDoubleClick();
      }}
      onMouseDown={(e) => {
        if (e.detail > 1) e.preventDefault();
      }}
    >
      {target}
    </button>
  );
}

/** ป้ายเล็ก: ขายราคานี้แล้วเหลือถึงร้านกี่บาท (ทุกโหมดสูตร) */
function NetToShopBadge({
  sell,
  rule,
  store,
}: {
  sell: number;
  rule: ChannelPriceRule;
  store: number;
}) {
  const net = netToShopFromSell(sell, rule);
  const kind = net > store ? "plus" : net < store ? "minus" : "match";
  return (
    <span
      className={`mph-pair-margin is-${kind}`}
      title={netToShopTitle(sell, rule, store)}
      aria-hidden
    >
      {net}
    </span>
  );
}

/** ป้ายประเภทสูตร + สถานะคำนวณของเซล (แต่ละเซลมีกติกาของตัวเอง) */
function RuleKindBadge({
  rule,
  fromOverride,
  store,
  target,
  onClick,
  onClearOverride,
}: {
  rule: ChannelPriceRule;
  fromOverride?: boolean;
  store: number;
  target: number;
  onClick?: () => void;
  onClearOverride?: () => void;
}) {
  const expected = applyChannelRule(store, rule);
  const synced = expected === target;
  const net = netToShopFromSell(target, rule);
  let calc: "ok" | "round" | "miss" | "fixed";
  if (rule.mode === "absolute") calc = synced ? "fixed" : "miss";
  else if (!synced) calc = "miss";
  else if (net === store) calc = "ok";
  else if (Math.abs(net - store) <= 1) calc = "round";
  else calc = "miss";

  const mark = calc === "ok" || calc === "fixed" ? "✓" : calc === "round" ? "≈" : "!";
  const label = formatRuleCellBadge(rule, !!fromOverride);
  const calcText =
    calc === "ok"
      ? "คำนวณแล้ว · เหลือถึงร้าน = หน้าร้าน"
      : calc === "fixed"
        ? "คำนวณแล้ว · ราคาคงที่ที่ระบุ"
        : calc === "round"
          ? "คำนวณแล้ว · ปัดเศษ ±1 จากหน้าร้าน"
          : "เป้าไม่ตรงสูตรเซลนี้ — กดคำนวณใหม่หรือแก้ override";
  const title = fromOverride
    ? `ระบุเอง · ${ruleModeLabelTh(rule)} · ${formatRuleShort(rule)} · ${calcText} · คลิกแก้สูตร`
    : `สูตรคอลัมน์ · ${ruleModeLabelTh(rule)} · ${formatRuleShort(rule)} · ${calcText} · คลิกแก้สูตร · ดับเบิลคลิกตัวเลขเป้า = ราคาคงที่แถวนี้`;

  return (
    <span className="mph-rule-row">
      <button
        type="button"
        className={`mph-rule-kind${fromOverride ? " is-ov" : ""} is-${rule.mode} is-calc-${calc}`}
        title={title}
        onClick={onClick}
      >
        <span className="mph-rule-calc" aria-hidden>
          {mark}
        </span>
        {label}
      </button>
      {fromOverride && onClearOverride ? (
        <button
          type="button"
          className="mph-rule-gp"
          title="กลับสูตรคอลัมน์ (ล้างระบุราคา) — ไม่แตะหน้าร้าน"
          onClick={onClearOverride}
        >
          GP
        </button>
      ) : null}
    </span>
  );
}

type NameDetail = {
  scope: "item" | "option";
  id: string;
  posName: string;
  channel: DeliveryChannel;
  cell: ChannelPriceCell;
  scannedAt: string | null;
  nameDraft: string;
};

type NameConfirm = {
  itemId: string;
  from: string;
  to: string;
};

type ClearConfirm = {
  channels: DeliveryChannel[];
};

type CellSel = {
  scope: "item" | "option";
  id: string;
  channel: DeliveryChannel;
};

type RowSel = {
  scope: "item" | "option";
  id: string;
};

function cellSelKey(sel: CellSel): string {
  return `${sel.scope}\t${sel.id}\t${sel.channel}`;
}

function parseCellSelKey(key: string): CellSel | null {
  const parts = key.split("\t");
  if (parts.length !== 3) return null;
  const [scope, id, channel] = parts;
  if (scope !== "item" && scope !== "option") return null;
  if (!id) return null;
  if (channel !== "shopee" && channel !== "grab" && channel !== "lineman") return null;
  return { scope, id, channel };
}

function rowSelId(row: RowSel): string {
  return `${row.scope}\t${row.id}`;
}

type ColKey = "name" | "mode" | "note" | "cat" | "store" | DeliveryChannel;

const COL_ORDER: ColKey[] = [
  "name",
  "mode",
  "cat",
  "store",
  "shopee",
  "grab",
  "lineman",
  "note",
];

const DEFAULT_COL_W: Record<ColKey, number> = {
  name: 200,
  mode: 36,
  note: 120,
  cat: 110,
  store: 64,
  shopee: 100,
  grab: 100,
  lineman: 100,
};

const COLLAPSED_W = 22;
/** คอลัมน์ติ๊กแถว — แยกจากคอลัมน์ชื่อ เพื่อให้คลิกตรงทั้งความสูงแถว ไม่ทับหัวตาราง */
const SEL_COL_W = 28;
/** v7: ไม่มีคอลัมน์ต้นแบบส่ง — เป้าแพลตฟอร์มอิงหน้าร้าน */
const COL_STORAGE_KEY = "telltea_mph_col_widths_v7";
const SHOW_OPTS_KEY = "telltea_mph_show_options";
const HIDDEN_OPTS_KEY = "telltea_mph_hidden_opt_groups";
const CLEARED_LIVE_KEY = "telltea_mph_cleared_live";
/** ซ่อนคอลัมน์แพลตฟอร์มชั่วคราวในแท็บนี้ — ไม่ลบข้อมูลสแกน/Firestore */
const HIDDEN_CHANNELS_KEY = "telltea_mph_hidden_channels";
/** ซ่อนแถวเฉพาะหน้าร้านชั่วคราวในแท็บนี้ — ไม่เปลี่ยนโหมดเมนู */
const HIDE_STORE_ONLY_KEY = "telltea_mph_hide_store_only";
/** ซ่อนแถวตัวเลือกเฉพาะหน้าร้านชั่วคราวในแท็บนี้ */
const HIDE_STORE_ONLY_OPTS_KEY = "telltea_mph_hide_store_only_opts";
/** ซ่อนแถวเมนูชั่วคราว — เหลือเฉพาะกลุ่มตัวเลือก */
const HIDE_MENUS_KEY = "telltea_mph_hide_menus";

/** สีแถวฮับ — หมวดเมนูกับกลุ่มตัวเลือกใช้ชุดเดียวกัน แต่ผูกคนละคีย์ ไม่วนซ้ำจนกว่าจะเกินจำนวนนี้ */
type OptGroupTone = {
  fill: string;
  hover: string;
  head: string;
  ink: string;
  accent: string;
};

const OPT_GROUP_TONES: OptGroupTone[] = [
  { fill: "#dce8f6", hover: "#cddcf0", head: "#b4c9e4", ink: "#1f3d63", accent: "#3a6496" },
  { fill: "#f6ead4", hover: "#efe0c4", head: "#e6cc9a", ink: "#5c3d12", accent: "#a06e1e" },
  { fill: "#f6e0e4", hover: "#efd0d6", head: "#e5b8c2", ink: "#5c2432", accent: "#a34a5e" },
  { fill: "#d7efe8", hover: "#c5e6dc", head: "#a8d9cc", ink: "#1a4a40", accent: "#2d7a6a" },
  { fill: "#ebe3f6", hover: "#ddd2ef", head: "#cbbde4", ink: "#3d2a5c", accent: "#6b4c9a" },
  { fill: "#e6efd6", hover: "#d8e6c6", head: "#c5d6a4", ink: "#3a4a18", accent: "#6a7d32" },
  { fill: "#f6e2d6", hover: "#efd4c6", head: "#e8bda8", ink: "#5c2e18", accent: "#c05a32" },
  { fill: "#d6eef6", hover: "#c4e4ef", head: "#a8d4e4", ink: "#1a4558", accent: "#2a7a96" },
  { fill: "#f0e0ee", hover: "#e6d0e4", head: "#d4b0cc", ink: "#4a2448", accent: "#8a4a7a" },
  { fill: "#f3eccc", hover: "#ebe4ba", head: "#e0d48a", ink: "#4a4210", accent: "#9a8820" },
  { fill: "#d8f0e0", hover: "#c6e8d0", head: "#a8d8b8", ink: "#1a4a2c", accent: "#2e8a52" },
  { fill: "#f0ddd4", hover: "#e8d0c6", head: "#dcb0a0", ink: "#5c2818", accent: "#a04a32" },
  { fill: "#e0e2f6", hover: "#d0d4ef", head: "#b8bce4", ink: "#282c58", accent: "#4a529a" },
  { fill: "#eadfd4", hover: "#e0d2c4", head: "#d0b8a0", ink: "#4a3220", accent: "#7a5640" },
  { fill: "#f4dcec", hover: "#ecd0e4", head: "#e0b0d0", ink: "#5c2048", accent: "#a04080" },
  { fill: "#dde8dc", hover: "#d0dcd0", head: "#b8ccb4", ink: "#2a4028", accent: "#4a7048" },
  { fill: "#dce4ec", hover: "#d0dae4", head: "#b4c4d4", ink: "#243444", accent: "#4a6880" },
  { fill: "#f6e6d8", hover: "#efdac8", head: "#e8c8b0", ink: "#5c3820", accent: "#c07848" },
  { fill: "#d4e8d8", hover: "#c4dccc", head: "#a0c8a8", ink: "#1c4024", accent: "#3a7048" },
  { fill: "#f0e8c8", hover: "#e6dcb8", head: "#dcc888", ink: "#4a4010", accent: "#8a7820" },
  { fill: "#e4e0ec", hover: "#d8d4e4", head: "#c4bcd4", ink: "#2c2844", accent: "#5a5480" },
  { fill: "#f4e4e8", hover: "#ecd8dc", head: "#e0c0c8", ink: "#582830", accent: "#a05868" },
  { fill: "#d4ecec", hover: "#c4e4e4", head: "#a8d4d4", ink: "#1a4848", accent: "#2a7a7a" },
  { fill: "#f0e0d0", hover: "#e8d4c4", head: "#d8b898", ink: "#543018", accent: "#8a5a32" },
];

function optGroupToneVars(t: OptGroupTone): CSSProperties {
  return {
    ["--mph-g-fill" as string]: t.fill,
    ["--mph-g-hover" as string]: t.hover,
    ["--mph-g-head" as string]: t.head,
    ["--mph-g-ink" as string]: t.ink,
    ["--mph-g-accent" as string]: t.accent,
  } as CSSProperties;
}

function isChannelCol(key: ColKey): key is DeliveryChannel {
  return key === "shopee" || key === "grab" || key === "lineman";
}

function channelChipLetter(ch: DeliveryChannel): string {
  if (ch === "shopee") return "S";
  if (ch === "grab") return "G";
  return "L";
}

function optionGroupIdsUsedOnlyByStoreOnly(
  items: { optionGroupIds?: string[]; storeOnly?: boolean; name?: string }[],
): Set<string> {
  const used = new Map<string, { allStore: boolean }>();
  for (const item of items) {
    const store = isMenuStoreOnly(item);
    for (const gid of item.optionGroupIds || []) {
      const cur = used.get(gid) || { allStore: true };
      if (!store) cur.allStore = false;
      used.set(gid, cur);
    }
  }
  const out = new Set<string>();
  for (const [id, v] of used) {
    if (v.allStore) out.add(id);
  }
  return out;
}

function isOptionStoreOnlyRow(
  choiceName: string,
  groupName: string,
  groupId: string,
  storeOnlyGroupIds: Set<string>,
): boolean {
  return (
    isMenuStoreOnly({ name: choiceName }) ||
    isMenuStoreOnly({ name: groupName }) ||
    storeOnlyGroupIds.has(groupId)
  );
}

function optRowKey(groupId: string, choiceId: string) {
  return `${groupId}::${choiceId}`;
}

function parseOptRowKey(key: string): { groupId: string; choiceId: string } | null {
  const i = key.lastIndexOf("::");
  if (i <= 0 || i >= key.length - 2) return null;
  const groupId = key.slice(0, i);
  const choiceId = key.slice(i + 2);
  if (!groupId || !choiceId) return null;
  return { groupId, choiceId };
}

function storePriceMatches(price: number, needle: string): boolean {
  const q = needle.trim();
  if (!q) return true;
  const n = Math.round(Number(price) || 0);
  if (menuTextIncludes(String(n), q)) return true;
  const parsed = Number(q.replace(/,/g, ""));
  return Number.isFinite(parsed) && n === Math.round(parsed);
}

function itemHubNoteText(
  item: MenuItem,
  draft: Record<string, string>,
  live: ChannelLiveStore,
): string {
  if (draft[item.id] !== undefined) return draft[item.id]!;
  if (item.hubNote) return item.hubNote;
  return (
    live.items[item.id]?.shopee?.applyNote ||
    live.items[item.id]?.grab?.applyNote ||
    live.items[item.id]?.lineman?.applyNote ||
    ""
  );
}

/** หัวคอลัมน์ Note: พิมพ์/กด «ว่าง» = เฉพาะแถวที่ไม่มี note */
function isNoteEmptyFilterQuery(needle: string): boolean {
  const q = normalizeMenuSearchText(needle);
  return (
    q === "ว่าง" ||
    q === "-" ||
    q === "--" ||
    q === "(ว่าง)" ||
    q === "empty" ||
    q === "blank"
  );
}

function noteFilterMatches(note: string, needle: string): boolean {
  const q = needle.trim();
  if (!q) return true;
  if (isNoteEmptyFilterQuery(q)) return !String(note || "").trim();
  return menuTextIncludes(note, q);
}

function optionHubNoteText(
  groupId: string,
  choice: MenuOptionChoice,
  draft: Record<string, string>,
  live: ChannelLiveStore,
): string {
  const key = optRowKey(groupId, choice.id);
  if (draft[key] !== undefined) return draft[key]!;
  if (choice.hubNote) return choice.hubNote;
  return (
    live.options[key]?.shopee?.applyNote ||
    live.options[key]?.grab?.applyNote ||
    live.options[key]?.lineman?.applyNote ||
    ""
  );
}

function selectedOptionNoteKeysFromSel(cellSel: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const key of cellSel) {
    const sel = parseCellSelKey(key);
    if (sel?.scope === "option") ids.add(sel.id);
  }
  return [...ids];
}

function selectedMenuItemIdsFromSel(
  cellSel: Iterable<string>,
  storeOnlySel: Iterable<string>,
): string[] {
  const ids = new Set<string>([...storeOnlySel].filter(Boolean));
  for (const key of cellSel) {
    const sel = parseCellSelKey(key);
    if (sel?.scope === "item") ids.add(sel.id);
  }
  return [...ids];
}

function emptyLiveItems(): LiveChannelItem[] {
  return [];
}

function isColCollapsed(w: number) {
  return w <= COLLAPSED_W + 4;
}

/** ความกว้างพอดีข้อความ (ไม่ตัด) — ย่อแคบได้เฉพาะเมื่อผู้ใช้ลาก */
function measureColWidth(
  key: ColKey,
  sample: { item: MenuItem; channels: Record<DeliveryChannel, ChannelPriceCell> }[],
  catName: Map<string, string>,
): number {
  if (key === "mode") return 36;
  if (key === "note") {
    let maxChars = 4;
    for (const row of sample) {
      maxChars = Math.max(maxChars, (row.item.hubNote || "").length);
    }
    return Math.max(88, Math.min(220, Math.round(maxChars * 7 + 16)));
  }
  if (key === "name") {
    let maxChars = 4;
    for (const row of sample) {
      maxChars = Math.max(maxChars, (row.item.name || "").length);
    }
    return Math.max(96, Math.round(maxChars * 8.2 + 20));
  }
  if (key === "cat") {
    let maxChars = 3;
    for (const row of sample) {
      maxChars = Math.max(maxChars, (catName.get(row.item.categoryId) || "").length);
    }
    return Math.max(72, Math.round(maxChars * 8 + 16));
  }
  if (key === "store") {
    return 64;
  }
  return 108;
}
function formatScanAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** เวลาสั้นในเซลช่องทาง — วันนี้โชว์แค่เวลา · วันอื่นโชว์ ว/ด เวลา */
function formatLiveAt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (sameDay) return time;
    const day = d.toLocaleDateString("th-TH", { day: "numeric", month: "numeric" });
    return `${day} ${time}`;
  } catch {
    return "";
  }
}

function latestChannelScanAt(
  store: ChannelLiveStore,
  ch: DeliveryChannel,
): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const map of [store.items, store.options]) {
    for (const row of Object.values(map || {})) {
      const at = row?.[ch]?.scannedAt;
      if (!at) continue;
      const ms = Date.parse(at);
      if (!Number.isFinite(ms) || ms <= bestMs) continue;
      bestMs = ms;
      best = at;
    }
  }
  return best;
}

function LiveAtLine({
  iso,
  waiting,
  detail,
}: {
  iso: string | null | undefined;
  waiting?: boolean;
  detail?: string | null;
}) {
  if (waiting) {
    return (
      <div className="mph-live-at is-waiting" title="รอสแกนช่องนี้">
        รอสแกน
      </div>
    );
  }
  const short = formatLiveAt(iso);
  if (!short) {
    return (
      <div className="mph-live-at is-empty" title="ยังไม่มีเวลาอัปเดตจากสแกน/บันทึก">
        —
      </div>
    );
  }
  const base = `อัปเดตล่าสุด ${formatScanAt(iso || null)}`;
  const title = detail?.trim() ? `${base}\n${detail.trim()}` : base;
  return (
    <div className="mph-live-at" title={title}>
      <span className="mph-live-at-time">{short}</span>
      {detail?.trim() ? (
        <span className="mph-live-at-note">{detail.trim()}</span>
      ) : null}
    </div>
  );
}

function withPriceDraft(item: MenuItem, draft: PriceDraft | undefined): MenuItem {
  if (!draft) return item;
  return {
    ...item,
    price: Math.max(0, Number(draft.store) || 0),
  };
}

function shortPriceStatus(status: ChannelPriceCell["status"], waitingScan = false): string {
  if (waitingScan) return "⏳";
  if (status === "match") return "✓";
  if (status === "mismatch") return "✗";
  if (status === "no_live") return "∅";
  if (status === "na") return "✕";
  return "?";
}

function pairCompareMark(
  target: number,
  liveRaw: string,
  waiting: boolean,
): { mark: string; kind: "match" | "mismatch" | "empty" | "waiting" } {
  if (waiting) return { mark: "…", kind: "waiting" };
  const raw = liveRaw.trim();
  if (raw === "") return { mark: "·", kind: "empty" };
  const live = Math.max(0, Number(raw) || 0);
  if (live === target) return { mark: "=", kind: "match" };
  return { mark: "≠", kind: "mismatch" };
}

function liveStatusText(
  status: ChannelPriceCell["status"],
  waitingScan: boolean,
): string {
  if (waitingScan) return "รอสแกน";
  return statusLabel(status);
}

function shortNameStatus(status: ChannelPriceCell["nameStatus"]): string {
  if (status === "exact") return "ชื่อ✓";
  if (status === "near") return "ชื่อ~";
  if (status === "missing") return "ชื่อ∅";
  return "ข้าม";
}

function colTitle(key: ColKey): string {
  if (key === "name") return "เมนู";
  if (key === "mode") return "ช่อง";
  if (key === "note") return "note";
  if (key === "cat") return "หมวด";
  if (key === "store") return "หน้าร้าน";
  return channelLabel(key);
}

export function PosMenuChannelPriceHub({
  items,
  categories,
  optionGroups = [],
  onSaved,
}: {
  items: MenuItem[];
  categories: MenuCategory[];
  optionGroups?: MenuOptionGroup[];
  onSaved?: () => void;
}) {
  const catName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const orderedCategories = useMemo(
    () =>
      [...categories]
        .filter((c) => c.active !== false)
        .sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "th"),
        ),
    [categories],
  );

  /** ลำดับหมวดคงที่ตาม POS — ใช้เรียงตารางทุกครั้ง ไม่สลับ A–ฮ */
  const catRank = useMemo(() => {
    const m = new Map<string, number>();
    orderedCategories.forEach((c, i) => m.set(c.id, i));
    let extra = orderedCategories.length;
    for (const item of items) {
      if (!item.categoryId || m.has(item.categoryId)) continue;
      m.set(item.categoryId, extra);
      extra += 1;
    }
    return m;
  }, [orderedCategories, items]);

  const catToneById = useMemo(() => {
    const m = new Map<string, OptGroupTone>();
    for (const [id, rank] of catRank) {
      m.set(id, OPT_GROUP_TONES[rank % OPT_GROUP_TONES.length]!);
    }
    return m;
  }, [catRank]);

  const activeItems = useMemo(
    () =>
      items
        .filter((i) => !(i.active === false && i.visibleOnPos === false))
        .slice()
        .sort(
          (a, b) =>
            (catRank.get(a.categoryId) ?? 1e9) - (catRank.get(b.categoryId) ?? 1e9) ||
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
            a.name.localeCompare(b.name, "th"),
        ),
    [items, catRank],
  );

  const [settings, setSettings] = useState<MenuPriceHubSettings | null>(null);
  const [channelLive, setChannelLive] = useState<ChannelLiveStore>({ items: {}, options: {} });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [colFilterName, setColFilterName] = useState("");
  const [colFilterCat, setColFilterCat] = useState("");
  const [colFilterStore, setColFilterStore] = useState("");
  const [colFilterNote, setColFilterNote] = useState("");
  const [statusFilter, setStatusFilter] = useState<HubStatusFilter>("all");
  const [draft, setDraft] = useState<Record<string, PriceDraft>>({});
  const [liveDraft, setLiveDraft] = useState<Record<string, LiveDraft>>({});
  const [ruleDraft, setRuleDraft] = useState<ChannelRules | null>(null);
  /** ข้อความสูตรหัวคอลัมน์ระหว่างพิมพ์ — ให้ลบ/คีย์ใหม่ได้ ไม่บังคับเป็น 0 */
  const [ruleValueText, setRuleValueText] = useState<Partial<Record<DeliveryChannel, string>>>(
    {},
  );
  const settingsRef = useRef<MenuPriceHubSettings | null>(null);
  const ruleValueTextRef = useRef(ruleValueText);
  settingsRef.current = settings;
  ruleValueTextRef.current = ruleValueText;

  const applyHubSettings = useCallback((next: MenuPriceHubSettings) => {
    settingsRef.current = next;
    setSettings(next);
    const typingKeys = Object.keys(ruleValueTextRef.current);
    if (!typingKeys.length) {
      setRuleDraft(next.channels);
      return;
    }
    setRuleDraft((prev) => {
      if (!prev) return next.channels;
      const merged = { ...next.channels };
      for (const k of typingKeys) {
        if (k === "shopee" || k === "grab" || k === "lineman") merged[k] = prev[k];
      }
      return merged;
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [overrideEdit, setOverrideEdit] = useState<OverrideDraft | null>(null);
  const [targetEdit, setTargetEdit] = useState<TargetEditState | null>(null);
  const [calcTick, setCalcTick] = useState(0);
  const [nameDetail, setNameDetail] = useState<NameDetail | null>(null);
  const [nameConfirm, setNameConfirm] = useState<NameConfirm | null>(null);
  const [clearConfirm, setClearConfirm] = useState<ClearConfirm | null>(null);
  const [noteClearConfirm, setNoteClearConfirm] = useState(false);
  const [showHubInfo, setShowHubInfo] = useState(false);
  const [showTableNote, setShowTableNote] = useState(false);
  const [tableNoteDraft, setTableNoteDraft] = useState("");
  const [showTableNoteInfo, setShowTableNoteInfo] = useState(false);
  const [clearedLive, setClearedLive] = useState<Set<DeliveryChannel>>(() => new Set());
  const [hiddenChannels, setHiddenChannels] = useState<Set<DeliveryChannel>>(
    () => new Set(),
  );
  const [hideStoreOnly, setHideStoreOnly] = useState(false);
  const [hideStoreOnlyOptions, setHideStoreOnlyOptions] = useState(false);
  const [hideMenus, setHideMenus] = useState(false);
  const [colW, setColW] = useState<Record<ColKey, number>>(() => ({ ...DEFAULT_COL_W }));
  const [sortKey, setSortKey] = useState<ColKey>("cat");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  /** ชื่อที่แก้แล้ว — ใช้เทียบสถานะทันทีก่อน snapshot มา */
  const [namePatch, setNamePatch] = useState<Record<string, string>>({});
  /** โหมดขาย — อัปเดตทันทีก่อน Firestore */
  const [storeOnlyPatch, setStoreOnlyPatch] = useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const shopeeFileRef = useRef<HTMLInputElement | null>(null);
  const nameConfirmPendingRef = useRef(false);
  const dragRef = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const colsFittedRef = useRef(false);
  const savedColsRef = useRef<Partial<Record<ColKey, number>> | null>(null);
  const [showOptions, setShowOptions] = useState(true);
  const [hiddenOptGroups, setHiddenOptGroups] = useState<Set<string>>(() => new Set());
  const [optDraft, setOptDraft] = useState<Record<string, PriceDraft>>({});
  const [cellSel, setCellSel] = useState<Set<string>>(() => new Set());
  const [storeOnlySel, setStoreOnlySel] = useState<Set<string>>(() => new Set());
  const [selPrice, setSelPrice] = useState("");
  const [selNote, setSelNote] = useState("");
  const lastCellSelRef = useRef<string | null>(null);
  const lastRowSelRef = useRef<string | null>(null);
  const lastRowShiftRef = useRef(false);

  const activeOptionGroups = useMemo(
    () =>
      optionGroups
        .filter((g) => g.active !== false)
        .slice()
        .sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "th"),
        ),
    [optionGroups],
  );
  const noteRowCount = useMemo(() => {
    let n = 0;
    for (const item of activeItems) {
      if (itemHubNoteText(item, noteDraft, channelLive).trim()) n += 1;
    }
    for (const g of activeOptionGroups) {
      for (const c of g.options) {
        if (c.active === false) continue;
        if (optionHubNoteText(g.id, c, noteDraft, channelLive).trim()) n += 1;
      }
    }
    return n;
  }, [activeItems, activeOptionGroups, noteDraft, channelLive]);
  const optGroupRank = useMemo(() => {
    const m = new Map<string, number>();
    activeOptionGroups.forEach((g, i) => m.set(g.id, i));
    return m;
  }, [activeOptionGroups]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<ColKey, number>>;
      setColW((prev) => {
        const next = { ...prev };
        for (const key of COL_ORDER) {
          const n = parsed[key];
          if (typeof n === "number" && n >= COLLAPSED_W) {
            // อย่าให้คอลัมน์ราคาแคบจนตัวเลขถูกบัง
            const floor =
              key === "store"
                ? 52
                : key === "shopee" || key === "grab" || key === "lineman"
                  ? 72
                  : COLLAPSED_W;
            next[key] = Math.max(n, key === "name" || key === "cat" ? n : floor);
            if (key === "store") next[key] = Math.max(n, 52);
            if (key === "shopee" || key === "grab" || key === "lineman") {
              next[key] = Math.max(n, 72);
            }
          }
        }
        return next;
      });
    } catch {
      /* ignore */
    }
    try {
      const showRaw = window.localStorage.getItem(SHOW_OPTS_KEY);
      if (showRaw === "0") setShowOptions(false);
      const hiddenRaw = window.localStorage.getItem(HIDDEN_OPTS_KEY);
      if (hiddenRaw) {
        const ids = JSON.parse(hiddenRaw) as string[];
        if (Array.isArray(ids)) setHiddenOptGroups(new Set(ids));
      }
      const clearedRaw = window.sessionStorage.getItem(CLEARED_LIVE_KEY);
      if (clearedRaw) {
        const ids = JSON.parse(clearedRaw) as DeliveryChannel[];
        if (Array.isArray(ids)) {
          setClearedLive(
            new Set(ids.filter((id): id is DeliveryChannel => DELIVERY_CHANNELS.includes(id))),
          );
        }
      }
      const hiddenChRaw = window.sessionStorage.getItem(HIDDEN_CHANNELS_KEY);
      if (hiddenChRaw) {
        const ids = JSON.parse(hiddenChRaw) as DeliveryChannel[];
        if (Array.isArray(ids)) {
          const next = new Set(
            ids.filter((id): id is DeliveryChannel => DELIVERY_CHANNELS.includes(id)),
          );
          if (next.size > 0 && next.size < DELIVERY_CHANNELS.length) {
            setHiddenChannels(next);
          }
        }
      }
      if (window.sessionStorage.getItem(HIDE_STORE_ONLY_KEY) === "1") {
        setHideStoreOnly(true);
      }
      if (window.sessionStorage.getItem(HIDE_STORE_ONLY_OPTS_KEY) === "1") {
        setHideStoreOnlyOptions(true);
      }
      if (window.sessionStorage.getItem(HIDE_MENUS_KEY) === "1") {
        setHideMenus(true);
        setShowOptions(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistClearedLive = useCallback((next: Set<DeliveryChannel>) => {
    setClearedLive(next);
    try {
      window.sessionStorage.setItem(CLEARED_LIVE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const persistHiddenChannels = useCallback((next: Set<DeliveryChannel>) => {
    setHiddenChannels(next);
    try {
      window.sessionStorage.setItem(HIDDEN_CHANNELS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const persistHideStoreOnly = useCallback((next: boolean) => {
    setHideStoreOnly(next);
    try {
      window.sessionStorage.setItem(HIDE_STORE_ONLY_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const persistHideStoreOnlyOptions = useCallback((next: boolean) => {
    setHideStoreOnlyOptions(next);
    try {
      window.sessionStorage.setItem(HIDE_STORE_ONLY_OPTS_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const persistShowOptions = useCallback((next: boolean) => {
    setShowOptions((prevShow) => {
      if (!next && hideMenus) return prevShow;
      try {
        window.localStorage.setItem(SHOW_OPTS_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [hideMenus]);

  const persistHideMenus = useCallback((next: boolean) => {
    if (next) {
      setShowOptions(true);
      try {
        window.localStorage.setItem(SHOW_OPTS_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    setHideMenus(next);
    try {
      window.sessionStorage.setItem(HIDE_MENUS_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const visibleChannels = useMemo(
    () => DELIVERY_CHANNELS.filter((ch) => !hiddenChannels.has(ch)),
    [hiddenChannels],
  );

  const visibleColOrder = useMemo(
    () => COL_ORDER.filter((key) => !isChannelCol(key) || !hiddenChannels.has(key)),
    [hiddenChannels],
  );

  function toggleHiddenChannel(ch: DeliveryChannel) {
    const next = new Set(hiddenChannels);
    if (next.has(ch)) {
      next.delete(ch);
    } else if (next.size >= DELIVERY_CHANNELS.length - 1) {
      return;
    } else {
      next.add(ch);
    }
    persistHiddenChannels(next);
  }

  const applyClearLive = useCallback(
    (channels: DeliveryChannel[]) => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          const nextStore = await clearChannelLiveForChannels(channels);
          setChannelLive(nextStore);
          const next = new Set(clearedLive);
          for (const ch of channels) next.add(ch);
          persistClearedLive(next);
          setClearConfirm(null);
          setLiveDraft((prev) => {
            const out = { ...prev };
            for (const key of Object.keys(out)) {
              const ch = key.split("::")[1] as DeliveryChannel | undefined;
              if (ch && channels.includes(ch)) delete out[key];
            }
            return out;
          });
          setOk(
            channels.length === 1
              ? `เคลียร์ ${channelLabel(channels[0]!)} แล้ว · รอสแกน`
              : `เคลียร์ ${channels.length} ช่องทางแล้ว · รอสแกน`,
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      })();
    },
    [clearedLive, persistClearedLive],
  );

  const restoreLive = useCallback(
    (channels: DeliveryChannel[]) => {
      const next = new Set(clearedLive);
      for (const ch of channels) next.delete(ch);
      persistClearedLive(next);
      setOk(
        channels.length === 1
          ? `คืนค่าสแกน ${channelLabel(channels[0]!)}`
          : "คืนค่าสแกนทุกช่องทาง",
      );
    },
    [clearedLive, persistClearedLive],
  );

  async function importShopeeExport(fileList: FileList | null) {
    const files = [...(fileList || [])];
    if (shopeeFileRef.current) shopeeFileRef.current.value = "";
    if (!files.length) return;
    if (files.some((f) => /\.zip$/i.test(f.name))) {
      setError("แตก ZIP แล้วเลือก เมนูหลัก.csv และ กลุ่มตัวเลือกเสริม.csv");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const parsed = await parseShopeeExportFiles(files);
      if (!parsed.items.length && !parsed.options.length) {
        setError("ไฟล์นี้ไม่ใช่ CSV ดาวน์โหลดเมนู Shopee");
        return;
      }
      const applied = applyShopeeExportToLiveStore({
        parsed,
        items: activeItems,
        optionGroups,
        current: channelLive,
      });
      const next = await saveChannelLiveStore(applied.next);
      setChannelLive(next);
      if (clearedLive.has("shopee")) {
        const cleared = new Set(clearedLive);
        cleared.delete("shopee");
        persistClearedLive(cleared);
      }
      setOk(
        `โหลด Shopee เมนู ${applied.matchedMenus} · ตัวเลือก ${applied.matchedOpts}` +
          (applied.unmatchedMenus || applied.unmatchedOpts
            ? ` · ไม่จับคู่ ${applied.unmatchedMenus + applied.unmatchedOpts}`
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไฟล์ Shopee ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const persistHiddenOptGroups = useCallback((next: Set<string>) => {
    setHiddenOptGroups(next);
    try {
      window.localStorage.setItem(HIDDEN_OPTS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleOptGroup = useCallback(
    (groupId: string) => {
      const next = new Set(hiddenOptGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      persistHiddenOptGroups(next);
    },
    [hiddenOptGroups, persistHiddenOptGroups],
  );

  const setAllOptGroupsVisible = useCallback(
    (visible: boolean) => {
      if (visible) persistHiddenOptGroups(new Set());
      else persistHiddenOptGroups(new Set(activeOptionGroups.map((g) => g.id)));
    },
    [activeOptionGroups, persistHiddenOptGroups],
  );
  const persistCols = useCallback((next: Record<ColKey, number>) => {
    try {
      window.localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubSettings = subscribeMenuPriceHubSettings(
      (s) => {
        if (cancelled) return;
        setSettingsError(null);
        applyHubSettings(s);
      },
      (err) => {
        if (cancelled) return;
        setSettingsError(err.message);
      },
    );

    void loadChannelLiveStoreFromServer()
      .then((live) => {
        if (!cancelled) setChannelLive(live);
      })
      .catch(() => {
        /* subscribe จะตามมา */
      });

    const unsubLive = subscribeChannelLiveStore(
      (live) => {
        if (cancelled) return;
        setChannelLive(live);
        // hub จากสคริปต์ apply ชนะ draft เก่า — ไม่งั้นช่องราคาจะค้างค่าที่พิมพ์ไว้
        setLiveDraft((prev) => {
          if (!Object.keys(prev).length) return prev;
          let changed = false;
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            const parts = key.split("::");
            if (parts.length < 2) continue;
            const ch = parts.pop() as DeliveryChannel;
            const rowId = parts.join("::");
            if (!DELIVERY_CHANNELS.includes(ch)) continue;
            const stored = live.items[rowId]?.[ch] ?? live.options[rowId]?.[ch];
            if (!stored || typeof stored.price !== "number") continue;
            const draft = next[key];
            if (!draft) continue;
            const draftPrice =
              draft.price.trim() === "" ? null : Math.max(0, Number(draft.price) || 0);
            if (draftPrice === stored.price && (draft.name || "") === (stored.name || "")) {
              delete next[key];
              changed = true;
              continue;
            }
            // ราคา hub ใหม่กว่า draft → ทิ้ง draft
            if (stored.source === "apply" || stored.source === "scan") {
              delete next[key];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setClearedLive((prev) => {
          if (!prev.size) return prev;
          const next = new Set(prev);
          for (const ch of DELIVERY_CHANNELS) {
            const hasItem = Object.values(live.items || {}).some((row) => !!row?.[ch]);
            const hasOpt = Object.values(live.options || {}).some((row) => !!row?.[ch]);
            if (hasItem || hasOpt) next.delete(ch);
          }
          if (next.size === prev.size) return prev;
          try {
            window.sessionStorage.setItem(CLEARED_LIVE_KEY, JSON.stringify([...next]));
          } catch {
            /* ignore */
          }
          return next;
        });
      },
      (err) => {
        if (cancelled) return;
        setSettingsError(err.message);
      },
    );

    return () => {
      cancelled = true;
      unsubSettings();
      unsubLive();
    };
  }, [applyHubSettings]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const w = Math.max(COLLAPSED_W, drag.startW + dx);
      setColW((prev) => ({ ...prev, [drag.key]: w }));
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      setColW((prev) => {
        persistCols(prev);
        return prev;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [persistCols]);

  const dirtyPriceCount = Object.keys(draft).length;
  const dirtyOptCount = Object.keys(optDraft).length;
  const dirtyTotal = dirtyPriceCount + dirtyOptCount;
  const rulesDirty =
    !!settings && !!ruleDraft && JSON.stringify(ruleDraft) !== JSON.stringify(settings.channels);

  const liveSettings = useMemo((): MenuPriceHubSettings | null => {
    if (!settings || !ruleDraft) return null;
    return { ...settings, channels: ruleDraft };
  }, [settings, ruleDraft, calcTick]);

  async function forceRecalculateTargets() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const [freshSettings, freshLive] = await Promise.all([
        loadMenuPriceHubSettings(),
        loadChannelLiveStoreFromServer(),
      ]);
      setSettings(freshSettings);
      setRuleDraft(freshSettings.channels);
      setChannelLive(freshLive);
      setLiveDraft({});
      setCalcTick((t) => t + 1);

      let itemOv = 0;
      let optOv = 0;
      for (const row of Object.values(freshSettings.itemOverrides || {})) {
        for (const ch of DELIVERY_CHANNELS) if (row?.[ch]) itemOv++;
      }
      for (const row of Object.values(freshSettings.optionOverrides || {})) {
        for (const ch of DELIVERY_CHANNELS) if (row?.[ch]) optOv++;
      }
      const menuCells = activeItems.filter((i) => !isMenuStoreOnly(i)).length * 3;
      setOk(
        `คำนวณใหม่แล้ว · เป้าตามกติกาแต่ละเซล · เมนู~${menuCells} เซล · ระบุเอง ${itemOv}+${optOv}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (!liveSettings) return [];
    return activeItems.map((item) => {
      const priced = withPriceDraft(item, draft[item.id]);
      const patched: MenuItem = {
        ...priced,
        name: namePatch[item.id] ?? item.name,
        storeOnly:
          storeOnlyPatch[item.id] !== undefined
            ? storeOnlyPatch[item.id]
            : item.storeOnly,
      };
      const channels = Object.fromEntries(
        DELIVERY_CHANNELS.map((ch) => {
          const waiting = clearedLive.has(ch);
          const stored = channelLive.items[item.id]?.[ch] ?? null;
          const draftKey = liveDraftKey(item.id, ch);
          const ld = liveDraft[draftKey];
          const observation = observationFromDraftOrStored(waiting, stored, ld);
          return [
            ch,
            channelCellForItem(
              patched,
              ch,
              liveSettings,
              emptyLiveItems(),
              observation,
            ),
          ];
        }),
      ) as Record<DeliveryChannel, ChannelPriceCell>;
      const worst = summarizeRowChannels(channels);
      return { item: patched, channels, worst, storeOnly: isMenuStoreOnly(patched) };
    });
  }, [
    activeItems,
    liveSettings,
    draft,
    namePatch,
    storeOnlyPatch,
    clearedLive,
    channelLive,
    liveDraft,
  ]);

  const storeOnlyGroupIds = useMemo(
    () =>
      optionGroupIdsUsedOnlyByStoreOnly(
        rows.map(({ item, storeOnly }) => ({ ...item, storeOnly })),
      ),
    [rows],
  );

  useEffect(() => {
    setNamePatch((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const live = activeItems.find((i) => i.id === id);
        if (live && live.name === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setStoreOnlyPatch((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const live = activeItems.find((i) => i.id === id);
        if (live && isMenuStoreOnly(live) === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setNoteDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const liveItem = activeItems.find((i) => i.id === id);
        if (liveItem) {
          const hub = liveItem.hubNote || "";
          if (next[id] === hub || (next[id]?.trim() === "" && hub)) {
            delete next[id];
            changed = true;
          }
          continue;
        }
        const parsed = parseOptRowKey(id);
        if (!parsed) continue;
        const group = activeOptionGroups.find((g) => g.id === parsed.groupId);
        const liveOpt = group?.options.find((c) => c.id === parsed.choiceId);
        if (!liveOpt) continue;
        const hub = liveOpt.hubNote || "";
        if (next[id] === hub || (next[id]?.trim() === "" && hub)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeItems, activeOptionGroups]);

  useEffect(() => {
    if (editingNameId && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingNameId]);

  useEffect(() => {
    if (isChannelCol(sortKey) && hiddenChannels.has(sortKey)) {
      setSortKey("cat");
      setSortDir("asc");
    }
  }, [hiddenChannels, sortKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (targetEdit || overrideEdit || nameConfirm || clearConfirm) return;
      if (!cellSel.size && !storeOnlySel.size) return;
      e.preventDefault();
      setCellSel(new Set());
      setStoreOnlySel(new Set());
      lastCellSelRef.current = null;
      lastRowSelRef.current = null;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cellSel.size, storeOnlySel.size, targetEdit, overrideEdit, nameConfirm, clearConfirm]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const nameQ = colFilterName.trim();
    const catQ = colFilterCat.trim();
    const storeQ = colFilterStore.trim();
    const noteQ = colFilterNote.trim();
    return rows.filter(({ item, channels, storeOnly }) => {
      if (hideStoreOnly && storeOnly) return false;
      const worst = summarizeRowChannels(channels, visibleChannels);
      if (!rowMatchesFilter(worst, channels, statusFilter, visibleChannels)) return false;
      if (nameQ && !menuTextIncludes(item.name, nameQ) && !menuTextIncludes(item.code || "", nameQ)) {
        return false;
      }
      if (catQ && !menuTextIncludes(catName.get(item.categoryId) || "", catQ)) {
        return false;
      }
      if (storeQ) {
        const storeVal =
          draft[item.id]?.store !== undefined
            ? Math.max(0, Number(draft[item.id]!.store) || 0)
            : (item.price ?? 0);
        if (!storePriceMatches(storeVal, storeQ)) return false;
      }
      if (noteQ && !noteFilterMatches(itemHubNoteText(item, noteDraft, channelLive), noteQ)) {
        return false;
      }
      if (!q) return true;
      if (
        menuTextIncludes(item.name, q) ||
        menuTextIncludes(item.code || "", q) ||
        menuTextIncludes(catName.get(item.categoryId) || "", q) ||
        menuTextIncludes(itemHubNoteText(item, noteDraft, channelLive), q)
      ) {
        return true;
      }
      return visibleChannels.some((ch) =>
        menuTextIncludes(channels[ch].liveName || "", q),
      );
    });
  }, [rows, statusFilter, query, colFilterName, colFilterCat, colFilterStore, colFilterNote, draft, noteDraft, channelLive, catName, visibleChannels, hideStoreOnly]);

  const displayed = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const catCmp =
        (catRank.get(a.item.categoryId) ?? 1e9) - (catRank.get(b.item.categoryId) ?? 1e9);
      if (catCmp !== 0) return catCmp;
      let cmp = 0;
      if (sortKey === "name" || sortKey === "cat") {
        cmp =
          (a.item.sortOrder ?? 0) - (b.item.sortOrder ?? 0) ||
          (a.item.name || "").localeCompare(b.item.name || "", "th");
      } else if (sortKey === "mode") {
        cmp = Number(a.storeOnly) - Number(b.storeOnly);
      } else if (sortKey === "note") {
        cmp = itemHubNoteText(a.item, noteDraft, channelLive).localeCompare(
          itemHubNoteText(b.item, noteDraft, channelLive),
          "th",
        );
      } else if (sortKey === "store") {
        cmp = (a.item.price ?? 0) - (b.item.price ?? 0);
      } else {
        cmp = a.channels[sortKey].target - b.channels[sortKey].target;
      }
      if (cmp === 0) {
        cmp =
          (a.item.sortOrder ?? 0) - (b.item.sortOrder ?? 0) ||
          (a.item.name || "").localeCompare(b.item.name || "", "th");
      }
      return sortKey === "cat" ? cmp : cmp * dir;
    });
    return list;
  }, [filtered, sortKey, sortDir, catRank, liveSettings, noteDraft, channelLive]);

  function toggleSort(key: ColKey) {
    if (key === "cat") {
      setSortKey("cat");
      setSortDir("asc");
      return;
    }
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortMark(key: ColKey) {
    if (key === "cat") return sortKey === "cat" ? " ≡" : "";
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const optionRowsAll = useMemo((): OptRow[] => {
    if (!showOptions || !liveSettings) return [];
    const out: OptRow[] = [];
    for (const g of activeOptionGroups) {
      if (hiddenOptGroups.has(g.id)) continue;
      for (const c of g.options) {
        if (c.active === false) continue;
        const key = optRowKey(g.id, c.id);
        const d = optDraft[key];
        const storeDelta = d ? Math.max(0, Number(d.store) || 0) : c.priceDelta ?? 0;
        const base = resolveOptionStoreBase({ priceDelta: storeDelta });
        const channels = Object.fromEntries(
          DELIVERY_CHANNELS.map((ch) => {
            const waiting = clearedLive.has(ch);
            const stored = channelLive.options[key]?.[ch] ?? null;
            const draftKey = liveDraftKey(key, ch);
            const ld = liveDraft[draftKey];
            const observation = observationFromDraftOrStored(waiting, stored, ld);
            return [
              ch,
              channelCellForOption(
                c.name || "",
                base,
                ch,
                liveSettings,
                emptyLiveItems(),
                observation,
                key,
              ),
            ];
          }),
        ) as Record<DeliveryChannel, ChannelPriceCell>;
        out.push({
          groupId: g.id,
          groupName: g.name,
          choice: c,
          channels,
          worst: summarizeRowChannels(channels),
          storeOnly: isOptionStoreOnlyRow(c.name || "", g.name, g.id, storeOnlyGroupIds),
        });
      }
    }
    return out;
  }, [
    showOptions,
    liveSettings,
    activeOptionGroups,
    hiddenOptGroups,
    optDraft,
    clearedLive,
    channelLive,
    liveDraft,
    storeOnlyGroupIds,
  ]);

  const optionRows = useMemo((): OptRow[] => {
    const q = query.trim();
    const nameQ = colFilterName.trim();
    const catQ = colFilterCat.trim();
    const storeQ = colFilterStore.trim();
    const noteQ = colFilterNote.trim();
    const filteredOpts = optionRowsAll.filter((r) => {
      if (hideStoreOnlyOptions && r.storeOnly) return false;
      const worst = summarizeRowChannels(r.channels, visibleChannels);
      if (!rowMatchesFilter(worst, r.channels, statusFilter, visibleChannels)) return false;
      if (nameQ && !menuTextIncludes(r.choice.name, nameQ)) return false;
      if (catQ && !menuTextIncludes(r.groupName, catQ)) return false;
      if (noteQ && !noteFilterMatches(optionHubNoteText(r.groupId, r.choice, noteDraft, channelLive), noteQ)) {
        return false;
      }
      if (storeQ) {
        const key = optRowKey(r.groupId, r.choice.id);
        const storeVal =
          optDraft[key]?.store !== undefined
            ? Math.max(0, Number(optDraft[key]!.store) || 0)
            : (r.choice.priceDelta ?? 0);
        if (!storePriceMatches(storeVal, storeQ)) return false;
      }
      if (!q) return true;
      if (
        menuTextIncludes(r.choice.name, q) ||
        menuTextIncludes(r.groupName, q) ||
        menuTextIncludes(optionHubNoteText(r.groupId, r.choice, noteDraft, channelLive), q)
      ) {
        return true;
      }
      return visibleChannels.some((ch) =>
        menuTextIncludes(r.channels[ch].liveName || "", q),
      );
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredOpts].sort((a, b) => {
      const groupCmp =
        (optGroupRank.get(a.groupId) ?? 1e9) - (optGroupRank.get(b.groupId) ?? 1e9);
      if (groupCmp !== 0) return groupCmp;
      let cmp = 0;
      if (sortKey === "name" || sortKey === "cat") {
        cmp =
          (a.choice.sortOrder ?? 0) - (b.choice.sortOrder ?? 0) ||
          (a.choice.name || "").localeCompare(b.choice.name || "", "th");
      } else if (sortKey === "store") {
        cmp = (a.choice.priceDelta ?? 0) - (b.choice.priceDelta ?? 0);
      } else if (sortKey === "note") {
        cmp = optionHubNoteText(a.groupId, a.choice, noteDraft, channelLive).localeCompare(
          optionHubNoteText(b.groupId, b.choice, noteDraft, channelLive),
          "th",
        );
      } else if (sortKey === "shopee" || sortKey === "grab" || sortKey === "lineman") {
        cmp = a.channels[sortKey].target - b.channels[sortKey].target;
      } else {
        cmp =
          (a.choice.sortOrder ?? 0) - (b.choice.sortOrder ?? 0) ||
          (a.choice.name || "").localeCompare(b.choice.name || "", "th");
      }
      if (cmp === 0) {
        cmp =
          (a.choice.sortOrder ?? 0) - (b.choice.sortOrder ?? 0) ||
          (a.choice.name || "").localeCompare(b.choice.name || "", "th");
      }
      return sortKey === "cat" ? cmp : cmp * dir;
    });
  }, [optionRowsAll, statusFilter, query, colFilterName, colFilterCat, colFilterStore, colFilterNote, optDraft, noteDraft, channelLive, sortKey, sortDir, liveSettings, visibleChannels, optGroupRank, hideStoreOnlyOptions]);

  const visibleOptGroupCount = activeOptionGroups.filter(
    (g) => !hiddenOptGroups.has(g.id),
  ).length;

  const storeOnlyCount = useMemo(
    () => rows.filter((r) => r.storeOnly).length,
    [rows],
  );

  const storeOnlyOptionCount = useMemo(() => {
    let n = 0;
    for (const g of activeOptionGroups) {
      if (hiddenOptGroups.has(g.id)) continue;
      for (const c of g.options) {
        if (c.active === false) continue;
        if (isOptionStoreOnlyRow(c.name || "", g.name, g.id, storeOnlyGroupIds)) n += 1;
      }
    }
    return n;
  }, [activeOptionGroups, hiddenOptGroups, storeOnlyGroupIds]);

  const visibleMenuCount = hideStoreOnly ? rows.length - storeOnlyCount : rows.length;

  const optGroupTone = useMemo(() => {
    const m = new Map<string, OptGroupTone>();
    activeOptionGroups.forEach((g, i) => m.set(g.id, OPT_GROUP_TONES[i % OPT_GROUP_TONES.length]));
    return m;
  }, [activeOptionGroups]);

  const optCountByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of optionRows) m.set(r.groupId, (m.get(r.groupId) || 0) + 1);
    return m;
  }, [optionRows]);

  const totals = useMemo(() => {
    const t = emptyHubTotals();
    for (const row of rows) {
      if (hideStoreOnly && row.storeOnly) continue;
      t[summarizeRowChannels(row.channels, visibleChannels)] += 1;
      if (rowHasNameIssue(row.channels, visibleChannels)) t.name_issue += 1;
    }
    for (const row of optionRowsAll) {
      if (hideStoreOnlyOptions && row.storeOnly) continue;
      t[summarizeRowChannels(row.channels, visibleChannels)] += 1;
      if (rowHasNameIssue(row.channels, visibleChannels)) t.name_issue += 1;
    }
    return t;
  }, [rows, optionRowsAll, visibleChannels, hideStoreOnly, hideStoreOnlyOptions]);

  const tableWidth = useMemo(
    () => SEL_COL_W + visibleColOrder.reduce((sum, key) => sum + colW[key], 0),
    [colW, visibleColOrder],
  );
  const tableColCount = visibleColOrder.length + 1;

  const displayedCellKeys = useMemo(() => {
    const keys: string[] = [];
    if (!hideMenus) {
      for (const row of displayed) {
        if (row.storeOnly) continue;
        for (const ch of visibleChannels) {
          keys.push(cellSelKey({ scope: "item", id: row.item.id, channel: ch }));
        }
      }
    }
    for (const r of optionRows) {
      const id = optRowKey(r.groupId, r.choice.id);
      for (const ch of visibleChannels) {
        keys.push(cellSelKey({ scope: "option", id, channel: ch }));
      }
    }
    return keys;
  }, [displayed, optionRows, visibleChannels, hideMenus]);

  const displayedRows = useMemo((): RowSel[] => {
    const out: RowSel[] = [];
    if (!hideMenus) {
      for (const row of displayed) {
        out.push({ scope: "item", id: row.item.id });
      }
    }
    for (const r of optionRows) {
      out.push({ scope: "option", id: optRowKey(r.groupId, r.choice.id) });
    }
    return out;
  }, [displayed, optionRows, hideMenus]);

  const displayedStoreOnlyIds = useMemo(
    () => new Set(hideMenus ? [] : displayed.filter((r) => r.storeOnly).map((r) => r.item.id)),
    [displayed, hideMenus],
  );

  const selectedMenuNoteIds = useMemo(
    () => (hideMenus ? [] : selectedMenuItemIdsFromSel(cellSel, storeOnlySel)),
    [cellSel, storeOnlySel, hideMenus],
  );

  const selectedOptionNoteKeys = useMemo(
    () => selectedOptionNoteKeysFromSel(cellSel),
    [cellSel],
  );

  const selectedNoteCount = selectedMenuNoteIds.length + selectedOptionNoteKeys.length;

  const displayedCellKeysByChannel = useMemo(() => {
    const m = new Map<DeliveryChannel, string[]>();
    for (const ch of visibleChannels) m.set(ch, []);
    for (const key of displayedCellKeys) {
      const parsed = parseCellSelKey(key);
      if (!parsed) continue;
      m.get(parsed.channel)?.push(key);
    }
    return m;
  }, [displayedCellKeys, visibleChannels]);

  const cellSelCountByChannel = useMemo(() => {
    const counts: Partial<Record<DeliveryChannel, number>> = {};
    for (const key of cellSel) {
      const parsed = parseCellSelKey(key);
      if (!parsed) continue;
      counts[parsed.channel] = (counts[parsed.channel] || 0) + 1;
    }
    return counts;
  }, [cellSel]);

  function getDraft(item: MenuItem): PriceDraft {
    return draft[item.id] || { store: String(item.price ?? 0) };
  }

  function setCell(item: MenuItem, field: "store", value: string) {
    const cur = getDraft(item);
    setDraft((prev) => ({ ...prev, [item.id]: { ...cur, [field]: value } }));
    setOk(null);
  }

  function beginEditName(item: MenuItem) {
    if (nameConfirm) return;
    setEditingNameId(item.id);
    setNameDraft(item.name || "");
  }

  function onNameDraftChange(_itemId: string, value: string) {
    setNameDraft(value);
  }

  function cancelNameEdit(itemId: string) {
    const original = activeItems.find((i) => i.id === itemId);
    setEditingNameId(null);
    setNameDraft(original?.name || "");
    setNamePatch((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  /** ออกจากช่องชื่อ → ถ้าเปลี่ยนต้องคอนเฟิร์มก่อนบันทึก */
  function requestNameConfirm(itemId: string) {
    if (nameConfirmPendingRef.current) return;
    const raw = nameDraft.trim();
    const original = activeItems.find((i) => i.id === itemId);
    setEditingNameId(null);
    if (!original) return;
    if (!raw || raw === original.name) {
      setNamePatch((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    // พรีวิวสถานะชื่อก่อนคอนเฟิร์ม
    setNamePatch((prev) => ({ ...prev, [itemId]: raw }));
    setNameConfirm({ itemId, from: original.name, to: raw });
  }

  function dismissNameConfirm(revert: boolean) {
    if (!nameConfirm) return;
    const { itemId } = nameConfirm;
    setNameConfirm(null);
    if (revert) {
      setNamePatch((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  }

  async function confirmNameSave() {
    if (!nameConfirm) return;
    const { itemId, to } = nameConfirm;
    nameConfirmPendingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await updateMenuItem(itemId, { name: to });
      setNameConfirm(null);
      setOk("บันทึกชื่อแล้ว");
      onSaved?.();
    } catch (err) {
      setNamePatch((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setError((err as Error).message);
    } finally {
      nameConfirmPendingRef.current = false;
      setBusy(false);
    }
  }

  function getNoteDraft(item: MenuItem): string {
    return itemHubNoteText(item, noteDraft, channelLive);
  }

  function getOptNoteDraft(r: OptRow): string {
    return optionHubNoteText(r.groupId, r.choice, noteDraft, channelLive);
  }

  function setNoteCell(itemId: string, value: string) {
    setNoteDraft((prev) => ({ ...prev, [itemId]: value }));
    setOk(null);
  }

  async function commitNote(itemId: string) {
    const original = activeItems.find((i) => i.id === itemId);
    if (!original) return;
    if (noteDraft[itemId] === undefined) return;
    const raw = noteDraft[itemId]!.trim();
    const prev = (original.hubNote || "").trim();
    if (raw === prev) {
      setNoteDraft((p) => {
        const next = { ...p };
        delete next[itemId];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateMenuItem(itemId, { hubNote: raw || null });
      setNoteDraft((p) => {
        const next = { ...p };
        delete next[itemId];
        return next;
      });
      setOk("บันทึก note แล้ว");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commitOptNote(groupId: string, choiceId: string) {
    const key = optRowKey(groupId, choiceId);
    if (noteDraft[key] === undefined) return;
    const group = activeOptionGroups.find((g) => g.id === groupId);
    const original = group?.options.find((c) => c.id === choiceId);
    if (!original) return;
    const raw = noteDraft[key]!.trim();
    const prev = (original.hubNote || "").trim();
    if (raw === prev) {
      setNoteDraft((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setMenuOptionChoiceHubNotes([{ groupId, choiceId }], raw);
      setNoteDraft((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      setOk("บันทึก note แล้ว");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applySelectedNotes() {
    const raw = selNote.trim();
    if (!raw) {
      setError("ใส่ note ที่จะใช้กับแถวที่เลือก");
      return;
    }
    const itemIds = selectedMenuNoteIds;
    const optKeys = selectedOptionNoteKeys;
    if (!itemIds.length && !optKeys.length) {
      setError("ติ๊กแถวเมนูหรือตัวเลือกก่อน แล้วใส่ note รวม");
      return;
    }
    const optTargets = optKeys
      .map(parseOptRowKey)
      .filter((x): x is { groupId: string; choiceId: string } => !!x);
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const nItems = itemIds.length ? await setMenuItemHubNotes(itemIds, raw) : 0;
      const nOpts = optTargets.length ? await setMenuOptionChoiceHubNotes(optTargets, raw) : 0;
      const n = nItems + nOpts;
      setNoteDraft((prev) => {
        const next = { ...prev };
        for (const id of itemIds) delete next[id];
        for (const key of optKeys) delete next[key];
        return next;
      });
      setOk(`ใส่ note ${n} แถว`);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearAllNotes() {
    const ids = activeItems
      .filter((item) => getNoteDraft(item).trim())
      .map((item) => item.id);
    const optTargets: { groupId: string; choiceId: string }[] = [];
    for (const g of activeOptionGroups) {
      for (const c of g.options) {
        if (c.active === false) continue;
        if (optionHubNoteText(g.id, c, noteDraft, channelLive).trim()) {
          optTargets.push({ groupId: g.id, choiceId: c.id });
        }
      }
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const nItems = await clearMenuItemHubNotes(ids);
      const nOpts = await setMenuOptionChoiceHubNotes(optTargets, "");
      await stripChannelLiveApplyNotes();
      setNoteDraft({});
      setNoteClearConfirm(false);
      const n = nItems + nOpts;
      setOk(n ? `เคลียร์ Note ${n} แถวแล้ว` : "ไม่มี Note ให้เคลียร์");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStoreOnly(item: MenuItem) {
    const current = isMenuStoreOnly({
      name: namePatch[item.id] ?? item.name,
      storeOnly:
        storeOnlyPatch[item.id] !== undefined ? storeOnlyPatch[item.id] : item.storeOnly,
    });
    const next = !current;
    setStoreOnlyPatch((prev) => ({ ...prev, [item.id]: next }));
    setBusy(true);
    setError(null);
    try {
      await updateMenuItem(item.id, {
        storeOnly: next,
        ...(next ? { deliveryPrice: null } : {}),
      });
      setOk(next ? "เฉพาะหน้าร้าน — ปิดแพลตฟอร์ม" : "เปิดเทียบแพลตฟอร์ม");
      onSaved?.();
    } catch (err) {
      setStoreOnlyPatch((prev) => {
        const out = { ...prev };
        delete out[item.id];
        return out;
      });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commitPrice(itemId: string) {
    const d = draft[itemId];
    if (!d) return;
    const original = activeItems.find((i) => i.id === itemId);
    if (!original) return;
    const store = Math.max(0, Number(d.store) || 0);
    const sameStore = store === (original.price ?? 0);
    if (sameStore) {
      setDraft((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateMenuItem(itemId, { price: store });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setOk("บันทึกราคาหน้าร้านแล้ว");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** ค่าแสดงในช่องสแกน — เก็บใน hub ไม่ใช่ราคาหน้าร้าน */
  function getLiveDraft(
    rowId: string,
    ch: DeliveryChannel,
    cell: ChannelPriceCell,
    scope: "item" | "option" = "item",
  ): LiveDraft {
    const key = liveDraftKey(rowId, ch);
    if (liveDraft[key]) return liveDraft[key]!;
    const stored =
      scope === "option"
        ? channelLive.options[rowId]?.[ch]
        : channelLive.items[rowId]?.[ch];
    return {
      name: stored?.name ?? cell.liveName ?? "",
      price:
        stored && typeof stored.price === "number"
          ? String(stored.price)
          : cell.live == null
            ? ""
            : String(cell.live),
    };
  }

  function setLiveCell(
    rowId: string,
    ch: DeliveryChannel,
    field: "name" | "price",
    value: string,
    cell: ChannelPriceCell,
    scope: "item" | "option" = "item",
  ) {
    const cur = getLiveDraft(rowId, ch, cell, scope);
    setLiveDraft((prev) => ({
      ...prev,
      [liveDraftKey(rowId, ch)]: { ...cur, [field]: value },
    }));
    setOk(null);
  }

  async function saveLiveNameFromDetail() {
    if (!nameDetail) return;
    const ch = nameDetail.channel;
    const rowId = nameDetail.id;
    const scope = nameDetail.scope;
    const name = nameDetail.nameDraft.trim();
    const stored =
      scope === "option"
        ? channelLive.options[rowId]?.[ch]
        : channelLive.items[rowId]?.[ch];
    const price =
      typeof stored?.price === "number" ? stored.price : nameDetail.cell.live;
    const persist =
      scope === "option" ? setOptionChannelLive : setItemChannelLive;
    setBusy(true);
    setError(null);
    try {
      if (!name && price == null) {
        const next = await persist(rowId, ch, null);
        setChannelLive(next);
      } else {
        const next = await persist(rowId, ch, {
          name,
          price: price ?? null,
          source: "manual",
          scannedAt: new Date().toISOString(),
          externalId: stored?.externalId ?? nameDetail.cell.liveId,
        });
        setChannelLive(next);
        if (clearedLive.has(ch)) {
          const cleared = new Set(clearedLive);
          cleared.delete(ch);
          persistClearedLive(cleared);
        }
      }
      setLiveDraft((prev) => {
        const out = { ...prev };
        delete out[liveDraftKey(rowId, ch)];
        return out;
      });
      setNameDetail(null);
      setOk("บันทึกชื่อแพลตฟอร์มแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commitLive(
    rowId: string,
    ch: DeliveryChannel,
    cell: ChannelPriceCell,
    scope: "item" | "option" = "item",
  ) {
    const key = liveDraftKey(rowId, ch);
    const d = liveDraft[key];
    if (!d) return;
    const name = d.name.trim();
    const priceRaw = d.price.trim();
    const price = priceRaw === "" ? null : Math.max(0, Number(priceRaw) || 0);
    const stored =
      scope === "option"
        ? channelLive.options[rowId]?.[ch]
        : channelLive.items[rowId]?.[ch];
    const sameName = name === (stored?.name ?? cell.liveName ?? "");
    const samePrice =
      (price == null && (stored?.price ?? cell.live) == null) ||
      (price != null && (stored?.price ?? cell.live) === price);
    if (sameName && samePrice && stored) {
      setLiveDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const persist =
      scope === "option" ? setOptionChannelLive : setItemChannelLive;
    if (!name && price == null) {
      setBusy(true);
      setError(null);
      try {
        const next = await persist(rowId, ch, null);
        setChannelLive(next);
        setLiveDraft((prev) => {
          const out = { ...prev };
          delete out[key];
          return out;
        });
        setOk("ล้างค่าสแกนช่องนี้แล้ว");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await persist(rowId, ch, {
        name,
        price,
        source: "manual",
        scannedAt: new Date().toISOString(),
        externalId: stored?.externalId ?? cell.liveId,
      });
      setChannelLive(next);
      // ถ้าเคยเคลียร์รอสแกน — กรอกใหม่ถือว่ามีข้อมูลแล้ว
      if (clearedLive.has(ch)) {
        const cleared = new Set(clearedLive);
        cleared.delete(ch);
        persistClearedLive(cleared);
      }
      setLiveDraft((prev) => {
        const out = { ...prev };
        delete out[key];
        return out;
      });
      setOk(`บันทึกค่าสแกน ${channelLabel(ch)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function getOptDraft(r: OptRow): PriceDraft {
    const key = optRowKey(r.groupId, r.choice.id);
    return optDraft[key] || { store: String(r.choice.priceDelta ?? 0) };
  }

  function setOptCell(r: OptRow, field: "store", value: string) {
    const key = optRowKey(r.groupId, r.choice.id);
    const cur = getOptDraft(r);
    setOptDraft((prev) => ({ ...prev, [key]: { ...cur, [field]: value } }));
    setOk(null);
  }

  async function commitOptPrice(r: OptRow) {
    const key = optRowKey(r.groupId, r.choice.id);
    const d = optDraft[key];
    if (!d) return;
    const group = activeOptionGroups.find((g) => g.id === r.groupId);
    if (!group) return;
    const store = Math.max(0, Number(d.store) || 0);
    const sameStore = store === (r.choice.priceDelta ?? 0);
    if (sameStore) {
      setOptDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const options = group.options.map((c) => {
        if (c.id !== r.choice.id) return c;
        return {
          ...c,
          priceDelta: store,
        };
      });
      await saveMenuOptionGroupFull(r.groupId, {
        name: group.name,
        required: group.required,
        selectionType: group.selectionType,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options,
      });
      setOptDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setOk("บันทึกราคาตัวเลือกแล้ว");
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function persistChannelRule(channel: DeliveryChannel, rule: ChannelPriceRule) {
    try {
      const next = await saveChannelRule(channel, rule);
      applyHubSettings(next);
      setOk("ซิงก์สูตรแล้ว");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function setRule(ch: DeliveryChannel, patch: Partial<ChannelPriceRule>) {
    setRuleDraft((prev) => (prev ? { ...prev, [ch]: { ...prev[ch], ...patch } } : prev));
    setOk(null);
  }

  function onRuleValueTyping(ch: DeliveryChannel, raw: string) {
    setRuleValueText((prev) => ({ ...prev, [ch]: raw }));
    if (raw.trim() === "" || raw === "-" || raw === "." || raw === "-.") return;
    const n = Number(raw);
    if (Number.isFinite(n)) setRule(ch, { value: n });
  }

  function commitRuleValue(ch: DeliveryChannel) {
    const prev = ruleDraft;
    if (!prev) return;
    const raw = ruleValueText[ch];
    const n =
      raw === undefined
        ? prev[ch].value
        : raw.trim() === "" || raw === "-" || raw === "." || raw === "-."
          ? 0
          : Number(raw);
    const channels = {
      ...prev,
      [ch]: { ...prev[ch], value: Number.isFinite(n) ? n : 0 },
    };
    setRuleDraft(channels);
    setRuleValueText((p) => {
      const next = { ...p };
      delete next[ch];
      return next;
    });
    if (JSON.stringify(channels[ch]) === JSON.stringify(settingsRef.current?.channels[ch])) return;
    void persistChannelRule(ch, channels[ch]);
  }

  function startResize(key: ColKey, e: React.MouseEvent) {
    // คลิกครั้งที่ 2 ของดับเบิลคลิก — อย่าเริ่มลาก (กันย่อขยายมั่ว)
    if (e.detail > 1) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: colW[key] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  /** ดับเบิลคลิกเส้นคอลัมน์ = autofit เฉพาะคอลัมน์นั้น (มาตรฐาน Excel) */
  function autofitCol(key: ColKey) {
    const sample = (displayed.length ? displayed : rows).slice(0, 120);
    let w = DEFAULT_COL_W[key];
    if (key === "name") {
      let maxChars = 6;
      for (const row of sample) {
        maxChars = Math.max(maxChars, (row.item.name || "").length);
      }
      w = Math.min(300, Math.max(100, Math.round(maxChars * 7.4 + 12)));
    } else if (key === "cat") {
      let maxChars = 4;
      for (const row of sample) {
        maxChars = Math.max(maxChars, (catName.get(row.item.categoryId) || "").length);
      }
      w = Math.min(160, Math.max(64, Math.round(maxChars * 7 + 10)));
    } else if (key === "store") {
      w = 56;
    } else {
      // ช่องทาง: เป้า + สถานะ
      w = 92;
    }
    setColW((prev) => {
      if (prev[key] === w) return prev;
      const next = { ...prev, [key]: w };
      persistCols(next);
      return next;
    });
  }

  function discardDraft() {
    if (!dirtyTotal) return;
    if (!window.confirm(`ทิ้งร่างราคา ${dirtyTotal} รายการ?`)) return;
    setDraft({});
    setOptDraft({});
    setOk(null);
    setError(null);
  }

  async function savePrices() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const ids = Object.keys(draft);
      const optKeys = Object.keys(optDraft);
      if (!ids.length && !optKeys.length) {
        setOk("ไม่มีรายการที่แก้");
        return;
      }
      await Promise.all(
        ids.map((id) => {
          const d = draft[id];
          if (!d) return Promise.resolve();
          return updateMenuItem(id, {
            price: Math.max(0, Number(d.store) || 0),
          });
        }),
      );
      const dirtyGroupIds = new Set(optKeys.map((k) => k.split("::")[0]!));
      for (const groupId of dirtyGroupIds) {
        const group = activeOptionGroups.find((g) => g.id === groupId);
        if (!group) continue;
        const options = group.options.map((c) => {
          const key = optRowKey(groupId, c.id);
          const d = optDraft[key];
          if (!d) return c;
          return {
            ...c,
            priceDelta: Math.max(0, Number(d.store) || 0),
          };
        });
        await saveMenuOptionGroupFull(groupId, {
          name: group.name,
          required: group.required,
          selectionType: group.selectionType,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options,
        });
      }
      setDraft({});
      setOptDraft({});
      setOk(`บันทึก ${ids.length + dirtyGroupIds.size}`);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    if (!settings || !ruleDraft) return;
    const channels = { ...ruleDraft };
    for (const ch of DELIVERY_CHANNELS) {
      const raw = ruleValueText[ch];
      if (raw === undefined) continue;
      const n =
        raw.trim() === "" || raw === "-" || raw === "." || raw === "-." ? 0 : Number(raw);
      channels[ch] = {
        ...channels[ch],
        value: Number.isFinite(n) ? n : 0,
      };
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const next = await saveChannelRules(channels);
      setRuleValueText({});
      ruleValueTextRef.current = {};
      applyHubSettings(next);
      setOk("ซิงก์สูตรแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openTableNote() {
    setTableNoteDraft(settings?.tableNote || HUB_TABLE_NOTE_GUIDE);
    setShowTableNote(true);
    setShowTableNoteInfo(false);
  }

  async function saveTableNote() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const raw = tableNoteDraft.trim();
      const current = await loadMenuPriceHubSettings();
      const next = await saveMenuPriceHubSettings({
        ...current,
        tableNote: raw || undefined,
      });
      applyHubSettings(next);
      setShowTableNote(false);
      setOk(raw ? "บันทึกโน้ตรวมแล้ว" : "ล้างโน้ตรวมแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const openOverride = useCallback(
    (item: MenuItem, channel: DeliveryChannel) => {
      if (!liveSettings) return;
      const priced = withPriceDraft(item, draft[item.id]);
      const base = resolveStoreBase(priced);
      const existing = liveSettings.itemOverrides[item.id]?.[channel];
      const channelRule = liveSettings.channels[channel];
      const currentTarget = existing
        ? applyChannelRule(base, existing)
        : applyChannelRule(base, channelRule);
      const defaults = overrideEditorDefaults(existing, channelRule, currentTarget);
      setOverrideEdit({
        scope: "item",
        id: item.id,
        label: item.name,
        channel,
        mode: defaults.mode,
        value: defaults.value,
        base,
      });
    },
    [liveSettings, draft],
  );

  const openOptionOverride = useCallback(
    (r: OptRow, channel: DeliveryChannel) => {
      if (!liveSettings) return;
      const key = optRowKey(r.groupId, r.choice.id);
      const existing = liveSettings.optionOverrides[key]?.[channel];
      const d = optDraft[key];
      const storeDelta = d ? Math.max(0, Number(d.store) || 0) : r.choice.priceDelta ?? 0;
      const base = resolveOptionStoreBase({ priceDelta: storeDelta });
      const channelRule = liveSettings.channels[channel];
      const currentTarget = existing
        ? applyChannelRule(base, existing)
        : applyChannelRule(base, channelRule);
      const defaults = overrideEditorDefaults(existing, channelRule, currentTarget);
      setOverrideEdit({
        scope: "option",
        id: key,
        label: `${r.groupName} · ${r.choice.name}`,
        channel,
        mode: defaults.mode,
        value: defaults.value,
        base,
      });
    },
    [liveSettings, optDraft],
  );

  function onTargetSelect(e: MouseEvent, sel: CellSel) {
    const key = cellSelKey(sel);
    if (e.shiftKey && lastCellSelRef.current) {
      const last = parseCellSelKey(lastCellSelRef.current);
      if (last && last.channel === sel.channel) {
        const colKeys = displayedCellKeysByChannel.get(sel.channel) || [];
        const a = colKeys.indexOf(lastCellSelRef.current);
        const b = colKeys.indexOf(key);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          setCellSel((prev) => {
            const next = new Set(prev);
            for (let i = from; i <= to; i += 1) {
              const k = colKeys[i];
              if (k) next.add(k);
            }
            return next;
          });
          lastCellSelRef.current = key;
          return;
        }
      }
    }
    setCellSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    lastCellSelRef.current = key;
  }

  function selectAllDisplayedCells() {
    setCellSel(new Set(displayedCellKeys));
    lastCellSelRef.current = displayedCellKeys[displayedCellKeys.length - 1] ?? null;
    setStoreOnlySel(new Set(displayedStoreOnlyIds));
  }

  function selectAllInChannel(channel: DeliveryChannel) {
    const colKeys = displayedCellKeysByChannel.get(channel) || [];
    const allOn = colKeys.length > 0 && colKeys.every((k) => cellSel.has(k));
    setCellSel((prev) => {
      const next = new Set(prev);
      if (allOn) {
        for (const k of colKeys) next.delete(k);
      } else {
        for (const k of colKeys) next.add(k);
      }
      return next;
    });
    lastCellSelRef.current = colKeys[colKeys.length - 1] ?? lastCellSelRef.current;
  }

  function cellKeysForRow(row: RowSel): string[] {
    if (row.scope === "item" && displayedStoreOnlyIds.has(row.id)) return [];
    return visibleChannels.map((ch) => cellSelKey({ ...row, channel: ch }));
  }

  function rowSelMark(row: RowSel): "off" | "on" | "some" {
    if (row.scope === "item" && displayedStoreOnlyIds.has(row.id)) {
      return storeOnlySel.has(row.id) ? "on" : "off";
    }
    const keys = cellKeysForRow(row);
    if (!keys.length) return "off";
    let n = 0;
    for (const k of keys) if (cellSel.has(k)) n += 1;
    if (n === 0) return "off";
    if (n === keys.length) return "on";
    return "some";
  }

  function toggleRowSel(e: { shiftKey: boolean }, row: RowSel) {
    const id = rowSelId(row);
    if (e.shiftKey && lastRowSelRef.current) {
      const ids = displayedRows.map(rowSelId);
      const a = ids.indexOf(lastRowSelRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        const cellKeys: string[] = [];
        const storeIds: string[] = [];
        for (let i = from; i <= to; i += 1) {
          const r = displayedRows[i];
          if (!r) continue;
          if (r.scope === "item" && displayedStoreOnlyIds.has(r.id)) storeIds.push(r.id);
          else cellKeys.push(...cellKeysForRow(r));
        }
        setCellSel((prev) => {
          const next = new Set(prev);
          for (const k of cellKeys) next.add(k);
          return next;
        });
        if (storeIds.length) {
          setStoreOnlySel((prev) => {
            const next = new Set(prev);
            for (const sid of storeIds) next.add(sid);
            return next;
          });
        }
        lastRowSelRef.current = id;
        lastCellSelRef.current = cellKeysForRow(row)[0] ?? lastCellSelRef.current;
        return;
      }
    }
    if (row.scope === "item" && displayedStoreOnlyIds.has(row.id)) {
      setStoreOnlySel((prev) => {
        const next = new Set(prev);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      lastRowSelRef.current = id;
      return;
    }
    const keys = cellKeysForRow(row);
    setCellSel((prev) => {
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allOn) {
        for (const k of keys) next.delete(k);
      } else {
        for (const k of keys) next.add(k);
      }
      return next;
    });
    lastRowSelRef.current = id;
    lastCellSelRef.current = keys[0] ?? lastCellSelRef.current;
  }

  function toggleAllDisplayedRows() {
    const allOn =
      displayedRows.length > 0 && displayedRows.every((r) => rowSelMark(r) === "on");
    if (allOn) clearCellSel();
    else selectAllDisplayedCells();
  }

  function renderRowCheck(row: RowSel, label: string) {
    const mark = rowSelMark(row);
    return (
      <label
        className="mph-row-sel-hit"
        title="เลือกแถวนี้เพื่อกำหนดเป้าทุกช่องทางที่แสดง หรือใส่ note รวม — Shift คลิก = ช่วงแถว"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          className="mph-row-sel"
          checked={mark === "on"}
          ref={(el) => {
            if (el) el.indeterminate = mark === "some";
          }}
          aria-label={`เลือก ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            lastRowShiftRef.current = e.shiftKey;
          }}
          onChange={() => {
            toggleRowSel({ shiftKey: lastRowShiftRef.current }, row);
            lastRowShiftRef.current = false;
          }}
        />
      </label>
    );
  }

  function renderSelHead() {
    return (
      <th
        className="mph-th mph-sel-col"
        style={{ width: SEL_COL_W, minWidth: SEL_COL_W, maxWidth: SEL_COL_W }}
        title="เลือกทุกแถวที่แสดงเพื่อกำหนดเป้าหรือใส่ note รวม — ไม่แตะราคาหน้าร้าน"
      >
        <label className="mph-row-sel-hit" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="mph-row-sel"
            checked={
              displayedRows.length > 0 && displayedRows.every((r) => rowSelMark(r) === "on")
            }
            ref={(el) => {
              if (!el) return;
              const n = displayedRows.filter((r) => rowSelMark(r) !== "off").length;
              el.indeterminate = n > 0 && n < displayedRows.length;
            }}
            aria-label="เลือกทุกแถวที่แสดง"
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleAllDisplayedRows()}
          />
        </label>
      </th>
    );
  }

  function renderSelCell(row: RowSel | null, label: string) {
    return (
      <td
        className="mph-td mph-sel-col"
        style={{ width: SEL_COL_W, minWidth: SEL_COL_W, maxWidth: SEL_COL_W }}
      >
        {row ? renderRowCheck(row, label) : null}
      </td>
    );
  }

  function clearCellSel() {
    setCellSel(new Set());
    setStoreOnlySel(new Set());
    lastCellSelRef.current = null;
    lastRowSelRef.current = null;
  }

  const clearCellOverride = useCallback(
    async (scope: "item" | "option", id: string, channel: DeliveryChannel) => {
      setBusy(true);
      setError(null);
      try {
        const next =
          scope === "option"
            ? await setOptionChannelOverride(id, channel, null)
            : await setItemChannelOverride(id, channel, null);
        setSettings(next);
        setRuleDraft(next.channels);
        setOk("กลับสูตรคอลัมน์");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function applySelectedTargets() {
    const raw = selPrice.trim();
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed)) {
      setError("ใส่ราคาเป้าที่จะใช้กับเซลล์ที่เลือก");
      return;
    }
    const writes = [...cellSel]
      .map(parseCellSelKey)
      .filter((x): x is CellSel => !!x)
      .map((sel) => ({
        scope: sel.scope,
        id: sel.id,
        channel: sel.channel,
        rule: { mode: "absolute" as const, value: Math.max(0, Math.round(parsed)) },
      }));
    if (!writes.length) {
      setError("ยังไม่ได้เลือกเซลล์เป้า");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const next = await setManyChannelOverrides(writes);
      setSettings(next);
      setRuleDraft(next.channels);
      setOk(`ระบุราคา ${writes.length} เซลล์ → ${Math.max(0, Math.round(parsed))}฿`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyOverride(clear = false) {
    if (!overrideEdit) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const rawVal = overrideEdit.value.trim();
      const parsed =
        rawVal === "" || rawVal === "-" || rawVal === "." || rawVal === "-."
          ? 0
          : Number(rawVal);
      const rule: ChannelPriceRule | null = clear
        ? null
        : {
            mode: overrideEdit.mode,
            value: Number.isFinite(parsed) ? parsed : 0,
          };
      const next =
        overrideEdit.scope === "option"
          ? await setOptionChannelOverride(overrideEdit.id, overrideEdit.channel, rule)
          : await setItemChannelOverride(overrideEdit.id, overrideEdit.channel, rule);
      setSettings(next);
      setRuleDraft(next.channels);
      setOverrideEdit(null);
      setOk(clear ? "ล้าง override" : "ตั้ง override");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function beginTargetEdit(
    scope: "item" | "option",
    id: string,
    channel: DeliveryChannel,
    current: number,
  ) {
    if (busy) return;
    setOverrideEdit(null);
    setTargetEdit({
      scope,
      id,
      channel,
      value: String(current),
      original: current,
    });
  }

  async function commitTargetEdit(from: TargetEditState) {
    const raw = from.value.trim();
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
      setTargetEdit((prev) => (sameTargetEdit(prev, from) ? null : prev));
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setTargetEdit((prev) => (sameTargetEdit(prev, from) ? null : prev));
      return;
    }
    const price = Math.round(parsed);
    if (price === from.original) {
      setTargetEdit((prev) => (sameTargetEdit(prev, from) ? null : prev));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const rule: ChannelPriceRule = { mode: "absolute", value: price };
      const next =
        from.scope === "option"
          ? await setOptionChannelOverride(from.id, from.channel, rule)
          : await setItemChannelOverride(from.id, from.channel, rule);
      setSettings(next);
      setRuleDraft(next.channels);
      setTargetEdit((prev) => (sameTargetEdit(prev, from) ? null : prev));
      setOk(`ตั้งเป้าคงที่ ${price}`);
    } catch (err) {
      setError((err as Error).message);
      setTargetEdit((prev) => (sameTargetEdit(prev, from) ? null : prev));
    } finally {
      setBusy(false);
    }
  }

  function renderColHead(key: ColKey) {
    const collapsed = isColCollapsed(colW[key]);
    const isChannel = key === "shopee" || key === "grab" || key === "lineman";
    const active = sortKey === key;
    const waiting = isChannel && clearedLive.has(key);
    const filterable = key === "name" || key === "cat" || key === "store" || key === "note";
    const filterValue =
      key === "name"
        ? colFilterName
        : key === "cat"
          ? colFilterCat
          : key === "store"
            ? colFilterStore
            : key === "note"
              ? colFilterNote
              : "";
    const filtering = filterable && filterValue.trim() !== "";
    const sortTitle = filterable
      ? key === "note"
        ? "คลิกชื่อคอลัมน์ = เรียง note · พิมพ์กรอง · กดหรือพิมพ์ «ว่าง» = เฉพาะแถวไม่มี note"
        : `คลิกชื่อคอลัมน์ = เรียง${colTitle(key)} · พิมพ์ด้านล่าง = กรองทันที`
      : `คลิกเรียง${colTitle(key)} · คลิกซ้ำสลับ ↑↓ · ลากขอบ = ความกว้าง · ดับเบิลคลิกเส้น = พอดี`;
    return (
      <th
        key={key}
        className={`mph-th${key === "name" ? " is-sticky" : ""}${key === "cat" ? " is-cat" : ""}${isChannel ? " is-ch" : ""}${active ? " is-sorted" : ""}${waiting ? " is-waiting" : ""}${filterable ? " has-filter" : ""}${filtering ? " is-filtering" : ""}`}
        style={{ width: colW[key], minWidth: colW[key], maxWidth: colW[key] }}
        title={sortTitle}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {collapsed ? (
          <button
            type="button"
            className="mph-th-sort mph-th-collapsed"
            onClick={() => toggleSort(key)}
          >
            {colTitle(key).slice(0, 1)}
            {sortMark(key)}
          </button>
        ) : isChannel && ruleDraft ? (
          <div className="mph-th-ch">
            <div className="mph-th-ch-top">
              {(() => {
                const colKeys = displayedCellKeysByChannel.get(key) || [];
                const n = colKeys.filter((k) => cellSel.has(k)).length;
                const allOn = colKeys.length > 0 && n === colKeys.length;
                const some = n > 0 && n < colKeys.length;
                return (
                  <input
                    type="checkbox"
                    className="mph-th-sel"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = some;
                    }}
                    disabled={!colKeys.length}
                    aria-label={`เลือกเป้า ${channelLabel(key)} ทุกแถวที่แสดง`}
                    title={`เลือกเป้า ${channelLabel(key)} ที่แสดงอยู่ — ไม่รวมหน้าร้าน ไม่รวมโหมด ร`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      selectAllInChannel(key);
                    }}
                  />
                );
              })()}
              <button
                type="button"
                className={`mph-th-sort${active ? " is-on" : ""}`}
                onClick={() => toggleSort(key)}
              >
                {channelLabel(key)}
                {sortMark(key)}
              </button>
              <button
                type="button"
                className="mph-th-info"
                aria-label={`อธิบายคอลัมน์ ${channelLabel(key)}`}
                title="แตะดูว่าช่องนี้หมายความว่าอะไร"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHubInfo(true);
                }}
              >
                <Info size={10} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <span className="mph-th-rule">
              <select
                value={ruleDraft[key].mode}
                aria-label={`โหมด ${channelLabel(key)}`}
                title="GP% = ตั้งขายให้หลังหักจีพีเหลือเท่าหน้าร้าน · คงที่ = ราคาเดียวกันทุกแถว · ดับเบิลคลิกช่องเป้าเพื่อใส่ราคาคงที่แถวนั้น (บันทึกทันที)"
                onChange={(e) => {
                  const mode = e.target.value as ChannelPriceMode;
                  setRuleValueText((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                  setRuleDraft((prev) => {
                    if (!prev) return prev;
                    const rule = { ...prev[key], mode };
                    void persistChannelRule(key, rule);
                    return { ...prev, [key]: rule };
                  });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <HubPriceModeOptions current={ruleDraft[key].mode} />
              </select>
              <input
                type="text"
                inputMode="decimal"
                value={
                  ruleValueText[key] !== undefined
                    ? ruleValueText[key]!
                    : String(ruleDraft[key].value)
                }
                style={{
                  width: `${priceInputCh(ruleValueText[key] ?? ruleDraft[key].value) + 1}ch`,
                }}
                aria-label={`ค่า ${channelLabel(key)}`}
                title={
                  ruleDraft[key].mode === "gp"
                    ? "จีพีแพลตฟอร์ม % — เป้า = หน้าร้าน ÷ (1 − GP/100)"
                    : ruleDraft[key].mode === "absolute"
                      ? "ราคาคงที่ทุกแถว (บาท) — แถวที่ต่างให้ดับเบิลคลิกช่องเป้า"
                      : undefined
                }
                onChange={(e) => onRuleValueTyping(key, e.target.value)}
                onBlur={() => commitRuleValue(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onClick={(e) => e.stopPropagation()}
              />
              {waiting ? (
                <button
                  type="button"
                  className="mph-th-clear is-restore"
                  title={`คืนค่าสแกน ${channelLabel(key)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreLive([key]);
                  }}
                >
                  คืน
                </button>
              ) : (
                <button
                  type="button"
                  className="mph-th-clear"
                  title={`เคลียร์ราคาจริง ${channelLabel(key)} · รอสแกนก่อนซิงค์`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setClearConfirm({ channels: [key] });
                  }}
                >
                  ล้าง
                </button>
              )}
            </span>
            <LiveAtLine
              waiting={waiting}
              iso={waiting ? null : latestChannelScanAt(channelLive, key)}
            />
          </div>
        ) : filterable ? (
          <div className="mph-th-filter-wrap">
            <div className="mph-th-filter-top">
              <button
                type="button"
                className={`mph-th-sort${active ? " is-on" : ""}`}
                onClick={() => toggleSort(key)}
              >
                {colTitle(key)}
                {sortMark(key)}
              </button>
              {key === "note" ? (
                <button
                  type="button"
                  className={`mph-th-empty${isNoteEmptyFilterQuery(colFilterNote) ? " is-on" : ""}`}
                  aria-pressed={isNoteEmptyFilterQuery(colFilterNote)}
                  aria-label="กรอง Note ว่าง"
                  title="แสดงเฉพาะแถวที่ Note ว่าง — กดอีกครั้งเพื่อยกเลิก"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColFilterNote((prev) => (isNoteEmptyFilterQuery(prev) ? "" : "ว่าง"));
                  }}
                >
                  ว่าง
                </button>
              ) : null}
            </div>
            <input
              type="search"
              inputMode={key === "store" ? "numeric" : "search"}
              className="mph-th-filter-input"
              value={filterValue}
              placeholder={key === "store" ? "฿" : key === "note" ? "กรอง / ว่าง" : "กรอง"}
              aria-label={`กรอง${colTitle(key)}`}
              title={
                key === "note"
                  ? "พิมพ์กรอง Note · กดหรือพิมพ์ «ว่าง» = เฉพาะแถวไม่มี note"
                  : `พิมพ์กรองคอลัมน์${colTitle(key)} ทันที`
              }
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (key === "name") setColFilterName(e.target.value);
                else if (key === "cat") setColFilterCat(e.target.value);
                else if (key === "store") setColFilterStore(e.target.value);
                else if (key === "note") setColFilterNote(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (key === "name") setColFilterName("");
                  else if (key === "cat") setColFilterCat("");
                  else if (key === "store") setColFilterStore("");
                  else if (key === "note") setColFilterNote("");
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className={`mph-th-sort${active ? " is-on" : ""}`}
            onClick={() => toggleSort(key)}
          >
            {colTitle(key)}
            {sortMark(key)}
          </button>
        )}
        <span
          className="mph-col-resizer"
          onMouseDown={(e) => startResize(key, e)}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = null;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            autofitCol(key);
          }}
        />
      </th>
    );
  }

  if (!settings || !ruleDraft || !liveSettings) {
    return (
      <div className="mph">
        <p className="muted">กำลังโหลด...</p>
        {settingsError ? <p className="error-text">{settingsError}</p> : null}
      </div>
    );
  }

  return (
    <div className="mph">
      <div className="mph-chrome">
        <div className="mph-filters" aria-label="สรุปสถานะ">
          {(
            [
              ["all", `ทั้งหมด ${visibleMenuCount}`],
              ["mismatch", `ไม่ตรง ${totals.mismatch}`],
              ["name_issue", `ชื่อ ${totals.name_issue}`],
              ["no_live", `${clearedLive.size ? "รอสแกน" : "ไม่มีจริง"} ${totals.no_live}`],
              ["unmatched", `ไม่จับคู่ ${totals.unmatched}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`mph-chip${statusFilter === id ? " is-on" : ""}`}
              onClick={() => setStatusFilter(id)}
            >
              {label}
            </button>
          ))}
          <span className="mph-chip-note">ตรง {totals.match}</span>
          <span className="mph-col-toggles" role="group" aria-label="แสดงคอลัมน์แพลตฟอร์มชั่วคราว">
            <span className="mph-chip-note" title="ซ่อนคอลัมน์ระหว่างทำงาน — ไม่ลบราคาจริงหรือข้อมูลสแกน">
              คอลัมน์
            </span>
            {DELIVERY_CHANNELS.map((ch) => {
              const on = !hiddenChannels.has(ch);
              const lastOn = on && visibleChannels.length === 1;
              return (
                <button
                  key={ch}
                  type="button"
                  className={`mph-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  disabled={lastOn}
                  title={
                    lastOn
                      ? `ต้องเหลืออย่างน้อย 1 ช่องทาง`
                      : on
                        ? `ซ่อนคอลัมน์ ${channelLabel(ch)} ชั่วคราว — ไม่ลบข้อมูล`
                        : `แสดงคอลัมน์ ${channelLabel(ch)}`
                  }
                  onClick={() => toggleHiddenChannel(ch)}
                >
                  {channelChipLetter(ch)}
                </button>
              );
            })}
            <button
              type="button"
              className={`mph-chip${hiddenChannels.size === 0 ? " is-on" : ""}`}
              disabled={hiddenChannels.size === 0}
              title="แสดงคอลัมน์ Shopee · Grab · LINE MAN ทั้งหมด"
              onClick={() => persistHiddenChannels(new Set())}
            >
              ทั้งสาม
            </button>
          </span>
          <span className="mph-row-toggles" role="group" aria-label="แสดงแถวชั่วคราว">
            <span
              className="mph-chip-note"
              title="ซ่อนแถวเฉพาะหน้าร้านระหว่างทำงาน — ไม่เปลี่ยนโหมดเมนู ไม่ลบข้อมูล"
            >
              แถว
            </span>
            <button
              type="button"
              className={`mph-chip${hideStoreOnly ? "" : " is-on"}`}
              aria-pressed={!hideStoreOnly}
              title={
                hideStoreOnly
                  ? "แสดงแถวเฉพาะหน้าร้านอีกครั้ง"
                  : "ซ่อนแถวเฉพาะหน้าร้านชั่วคราว — ไม่เปลี่ยนโหมด ร"
              }
              onClick={() => persistHideStoreOnly(!hideStoreOnly)}
            >
              ร {storeOnlyCount}
            </button>
            <button
              type="button"
              className={`mph-chip${hideStoreOnlyOptions ? "" : " is-on"}`}
              aria-pressed={!hideStoreOnlyOptions}
              title={
                hideStoreOnlyOptions
                  ? "แสดงแถวตัวเลือกเฉพาะหน้าร้านอีกครั้ง"
                  : "ซ่อนแถวตัวเลือกเฉพาะหน้าร้านชั่วคราว — ชื่อมี «เฉพาะหน้าร้าน» หรือกลุ่มที่ผูกแค่เมนูโหมด ร"
              }
              onClick={() => persistHideStoreOnlyOptions(!hideStoreOnlyOptions)}
            >
              ตัวเลือก ร {storeOnlyOptionCount}
            </button>
            <button
              type="button"
              className={`mph-chip${hideMenus ? " is-on" : ""}`}
              aria-pressed={hideMenus}
              title={
                hideMenus
                  ? "แสดงแถวเมนูอีกครั้ง"
                  : "ซ่อนแถวเมนูชั่วคราว — เหลือเฉพาะกลุ่มตัวเลือก"
              }
              onClick={() => persistHideMenus(!hideMenus)}
            >
              เฉพาะตัวเลือก
            </button>
          </span>
          <button
            type="button"
            className="mph-chip mph-chip-recalc"
            title="บังคับคำนวณเป้าใหม่ทุกเซล ตามสูตรคอลัมน์ หรือกติกาที่ระบุแยกเซล · แสดง ✓/≈/!"
            disabled={busy}
            onClick={() => void forceRecalculateTargets()}
          >
            คำนวณใหม่
          </button>
          <button
            type="button"
            className={`mph-chip${showOptions ? " is-on" : ""}`}
            aria-pressed={showOptions}
            disabled={hideMenus && showOptions}
            title={
              hideMenus
                ? "กำลังดูเฉพาะตัวเลือก — ปิด «เฉพาะตัวเลือก» ก่อนถ้าจะซ่อนแถวนี้"
                : showOptions
                  ? "ซ่อนแถวตัวเลือกชั่วคราว"
                  : "แสดงแถวตัวเลือก"
            }
            onClick={() => persistShowOptions(!showOptions)}
          >
            ตัวเลือก {activeOptionGroups.length}
          </button>
          <button
            type="button"
            className={`mph-chip${cellSel.size || storeOnlySel.size ? " is-on" : ""}`}
            title="เลือกเป้าแพลตฟอร์มทุกเซลล์ที่แสดง (เมนู+ตัวเลือก) และแถวเฉพาะหน้าร้านสำหรับใส่ note"
            disabled={!displayedCellKeys.length && !displayedStoreOnlyIds.size}
            onClick={selectAllDisplayedCells}
          >
            เลือกทั้งหมด{displayedCellKeys.length ? ` ${displayedCellKeys.length}` : ""}
          </button>
          <button
            type="button"
            className="mph-chip"
            title="โหลดราคาจริง Shopee จากไฟล์ดาวน์โหลดเมนู (เมนูหลัก.csv + กลุ่มตัวเลือกเสริม.csv)"
            disabled={busy}
            onClick={() => shopeeFileRef.current?.click()}
          >
            โหลดไฟล์ S
          </button>
          <input
            ref={shopeeFileRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) => void importShopeeExport(e.target.files)}
          />
          <button
            type="button"
            className={`mph-chip${clearedLive.size === DELIVERY_CHANNELS.length ? " is-on" : ""}`}
            title="เคลียร์ราคาจริงทุกช่องทางก่อนซิงค์ — สถานะเป็นรอสแกน"
            onClick={() => setClearConfirm({ channels: [...DELIVERY_CHANNELS] })}
          >
            เคลียร์ก่อนซิงค์
          </button>
          {clearedLive.size ? (
            <button
              type="button"
              className="mph-chip"
              title="คืนค่าสแกนที่เคลียร์ไว้"
              onClick={() => restoreLive([...DELIVERY_CHANNELS])}
            >
              คืนค่าสแกน
            </button>
          ) : null}
          <button
            type="button"
            className={`mph-chip${noteRowCount ? " is-on" : ""}`}
            title={
              noteRowCount
                ? `ลบข้อความคอลัมน์ Note ทุกแถว (${noteRowCount}) — ไม่ลบโน้ตรวม`
                : "ไม่มี Note ในคอลัมน์"
            }
            disabled={busy || !noteRowCount}
            onClick={() => setNoteClearConfirm(true)}
          >
            เคลียร์ Note{noteRowCount ? ` ${noteRowCount}` : ""}
          </button>
          <span className="mph-table-note-wrap">
            <button
              type="button"
              className={`mph-chip${settings?.tableNote ? " is-on" : ""}`}
              title={
                settings?.tableNote
                  ? `โน้ตรวม · ${settings.tableNote.slice(0, 80)}${settings.tableNote.length > 80 ? "…" : ""}`
                  : "โน้ตรวมของตาราง — กดเปิดใส่/อ่าน"
              }
              onClick={openTableNote}
            >
              โน้ตรวม{settings?.tableNote ? " ·" : ""}
            </button>
            <button
              type="button"
              className="mph-th-info"
              aria-label="อธิบายโน้ตรวมสำหรับ AI และผู้ใช้"
              title="อินโฟโน้ตรวม — AI อ่านแล้วรู้ว่าเก็บสรุป/คิวงานของตารางนี้"
              onClick={(e) => {
                e.stopPropagation();
                setShowTableNoteInfo(true);
              }}
            >
              <Info size={11} strokeWidth={2.25} aria-hidden />
            </button>
          </span>
        </div>
        <input
          type="search"
          className="mph-search"
          placeholder={showOptions ? "ค้นหาเมนูหรือตัวเลือก" : "ค้นหา"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="ค้นหาเมนู"
        />
        {dirtyTotal ? (
          <button type="button" className="mph-btn" disabled={busy} onClick={discardDraft}>
            ทิ้ง
          </button>
        ) : null}
        <button
          type="button"
          className="mph-btn mph-btn-primary"
          disabled={busy || !dirtyTotal}
          onClick={() => void savePrices()}
        >
          {busy ? "..." : dirtyTotal ? `บันทึก ${dirtyTotal}` : "บันทึก"}
        </button>
        <button
          type="button"
          className="mph-btn"
          disabled={busy || !rulesDirty}
          onClick={() => void saveRules()}
        >
          {rulesDirty ? "ซิงก์สูตร*" : "สูตร"}
        </button>
        <span className="mph-scan muted" title="เวลาอัปเดตล่าสุดแยกตามช่องทางที่แสดง (จาก hub)">
          {visibleChannels.map((ch, i) => (
            <span key={ch}>
              {i ? " · " : ""}
              {channelChipLetter(ch)}{" "}
              {clearedLive.has(ch) ? (
                <em className="mph-waiting-label">รอสแกน</em>
              ) : (
                formatLiveAt(latestChannelScanAt(channelLive, ch)) || "—"
              )}
            </span>
          ))}
        </span>
      </div>

      {showOptions && activeOptionGroups.length ? (
        <div className="mph-opt-groups" role="group" aria-label="กลุ่มตัวเลือกที่แสดง">
          <span className="mph-opt-groups-label">กลุ่มตัวเลือก</span>
          <button
            type="button"
            className={`mph-chip mph-chip-sm${visibleOptGroupCount === activeOptionGroups.length ? " is-on" : ""}`}
            onClick={() => setAllOptGroupsVisible(true)}
          >
            ทุกกลุ่ม
          </button>
          <button
            type="button"
            className="mph-chip mph-chip-sm"
            onClick={() => setAllOptGroupsVisible(false)}
          >
            ซ่อนทั้งหมด
          </button>
          {activeOptionGroups.map((g, i) => {
            const on = !hiddenOptGroups.has(g.id);
            const tone = OPT_GROUP_TONES[i % OPT_GROUP_TONES.length]!;
            return (
              <button
                key={g.id}
                type="button"
                className={`mph-chip mph-chip-sm mph-opt-chip-tone${on ? " is-on" : ""}`}
                style={optGroupToneVars(tone)}
                title={on ? `ซ่อน ${g.name}` : `แสดง ${g.name}`}
                onClick={() => toggleOptGroup(g.id)}
              >
                {g.name}
                <span className="mph-chip-count">{g.options.filter((c) => c.active !== false).length}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mph-sel-bar" aria-label="กำหนดเป้าเซลล์ที่เลือก">
        <span className="mph-sel-count">
          เลือก {displayedRows.filter((r) => rowSelMark(r) !== "off").length} แถว · {cellSel.size}{" "}
          เซลล์
          {visibleChannels.map((ch) =>
            cellSelCountByChannel[ch] ? ` · ${channelChipLetter(ch)} ${cellSelCountByChannel[ch]}` : "",
          ).join("")}
        </span>
        <button
          type="button"
          className="mph-chip mph-chip-sm"
          disabled={!cellSel.size && !storeOnlySel.size}
          onClick={clearCellSel}
        >
          ยกเลิกเลือก
        </button>
        <label className="mph-sel-price-label">
          กำหนดราคา
          <input
            type="text"
            inputMode="decimal"
            className="mph-sel-price"
            value={selPrice}
            placeholder="฿"
            disabled={!cellSel.size || busy}
            aria-label="ราคาเป้าของเซลล์ที่เลือก"
            title="ตั้งเป้าคงที่เฉพาะเซลล์ที่เลือก — ป้ายระบุราคา · ไม่แตะหน้าร้าน ไม่เขียนราคาจริง"
            onChange={(e) => setSelPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void applySelectedTargets();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="mph-btn mph-btn-primary"
          disabled={!cellSel.size || busy || selPrice.trim() === ""}
          title="เขียนเป้าเฉพาะเซลล์ที่เลือก เป็นระบุราคา — สูตรคอลัมน์ของช่องอื่นไม่เปลี่ยน"
          onClick={() => void applySelectedTargets()}
        >
          {busy ? "..." : `ใช้กับ ${cellSel.size} เซลล์`}
        </button>
        <label className="mph-sel-price-label">
          ใส่ note
          <input
            type="text"
            className="mph-sel-note"
            value={selNote}
            placeholder="note รวม…"
            disabled={!selectedNoteCount || busy}
            aria-label="note ของแถวที่เลือก"
            title="ใส่ข้อความเดียวกันทุกแถวเมนูและตัวเลือกที่ติ๊ก · บันทึกทันที"
            onChange={(e) => setSelNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void applySelectedNotes();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="mph-btn mph-btn-primary"
          disabled={!selectedNoteCount || busy || selNote.trim() === ""}
          title="เขียน note เดียวกันลงแถวเมนูและตัวเลือกที่ติ๊ก"
          onClick={() => void applySelectedNotes()}
        >
          {busy ? "..." : `ใส่ note ${selectedNoteCount} แถว`}
        </button>
      </div>

      {error ? <p className="error-text mph-flash">{error}</p> : null}
      {ok ? <p className="ok-text mph-flash">{ok}</p> : null}

      <div className="mph-scroll">
        <table
          className="mph-table"
          style={{ width: tableWidth, ["--mph-sel-w" as string]: `${SEL_COL_W}px` }}
        >
          <colgroup>
            <col style={{ width: SEL_COL_W }} />
            {visibleColOrder.map((key) => (
              <col key={key} style={{ width: colW[key] }} />
            ))}
          </colgroup>
          <thead className="mph-thead">
            <tr>
              {renderSelHead()}
              {visibleColOrder.map((key) => renderColHead(key))}
            </tr>
          </thead>
          <tbody>
            {(hideMenus ? [] : displayed).map(({ item, channels, storeOnly }) => {
              const d = getDraft(item);
              const catTone = item.categoryId ? catToneById.get(item.categoryId) : undefined;
              const collapsed = {
                name: isColCollapsed(colW.name),
                mode: isColCollapsed(colW.mode),
                cat: isColCollapsed(colW.cat),
                store: isColCollapsed(colW.store),
              };
              const rowRef = { scope: "item" as const, id: item.id };
              const rowMark = rowSelMark(rowRef);
              return (
                <tr
                  key={item.id}
                  className={`mph-menu-row${storeOnly ? " mph-row-store-only" : ""}${
                    rowMark === "on" ? " is-row-sel" : rowMark === "some" ? " is-row-sel-some" : ""
                  }`}
                  style={catTone ? optGroupToneVars(catTone) : undefined}
                >
                  {renderSelCell(rowRef, item.name)}
                  <td
                    className="mph-td is-sticky"
                    style={{ width: colW.name, minWidth: colW.name, maxWidth: colW.name }}
                  >
                    <span className="mph-name-cell">
                      {collapsed.name ? (
                        "…"
                      ) : editingNameId === item.id ? (
                      <input
                        ref={nameInputRef}
                        className="mph-name-input"
                        value={nameDraft}
                        aria-label={`ชื่อเมนู ${item.name}`}
                        onChange={(e) => onNameDraftChange(item.id, e.target.value)}
                        onBlur={() => requestNameConfirm(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelNameEdit(item.id);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="mph-name-btn"
                        title="คลิกแก้ชื่อ — ระบบเช็คตรง/ไม่ตรงทันที"
                        onClick={() => beginEditName(item)}
                      >
                        {item.name || "—"}
                      </button>
                    )}
                    </span>
                  </td>
                  <td
                    className="mph-td is-mode"
                    style={{ width: colW.mode, minWidth: colW.mode, maxWidth: colW.mode }}
                  >
                    {collapsed.mode ? null : (
                      <button
                        type="button"
                        className={`mph-mode-btn${storeOnly ? " is-store" : " is-delivery"}`}
                        disabled={busy}
                        title={
                          storeOnly
                            ? "เฉพาะหน้าร้าน — ไม่เทียบแพลตฟอร์ม (คลิกเปิด)"
                            : "เทียบแพลตฟอร์มจากราคาหน้าร้าน — คลิกเป็นเฉพาะหน้าร้าน"
                        }
                        aria-label={
                          storeOnly
                            ? `${item.name} เฉพาะหน้าร้าน`
                            : `${item.name} เทียบแพลตฟอร์ม`
                        }
                        aria-pressed={storeOnly}
                        onClick={() => void toggleStoreOnly(item)}
                      >
                        {storeOnly ? "ร" : "ด"}
                      </button>
                    )}
                  </td>
                  <td
                    className="mph-td is-cat"
                    style={{ width: colW.cat, minWidth: colW.cat, maxWidth: colW.cat }}
                    title={catName.get(item.categoryId) || ""}
                  >
                    {collapsed.cat ? "" : catName.get(item.categoryId) || "—"}
                  </td>
                  <td
                    className="mph-td is-num"
                    style={{ width: colW.store, minWidth: colW.store, maxWidth: colW.store }}
                  >
                    {collapsed.store ? null : (
                      <input
                        type="number"
                        className="mph-input"
                        value={d.store}
                        onChange={(e) => setCell(item, "store", e.target.value)}
                        onBlur={() => void commitPrice(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        aria-label={`หน้าร้าน ${item.name}`}
                      />
                    )}
                  </td>
                  {visibleChannels.map((ch) => {
                    const cell = channels[ch];
                    const columnRule = ruleDraft[ch];
                    const rule =
                      liveSettings.itemOverrides[item.id]?.[ch] ?? columnRule;
                    const netRule = resolveNetRule(rule, columnRule);
                    const narrow = isColCollapsed(colW[ch]);
                    const waiting = clearedLive.has(ch);
                    const ld = getLiveDraft(item.id, ch, cell);
                    const hasHubLive = !!channelLive.items[item.id]?.[ch];
                    const pair = pairCompareMark(cell.target, ld.price, waiting);
                    const storeBase = Math.max(0, Number(d.store) || 0);
                    const sel = { scope: "item" as const, id: item.id, channel: ch };
                    const selOn = cellSel.has(cellSelKey(sel));
                    if (storeOnly) {
                      return (
                        <td
                          key={ch}
                          className="mph-td is-num is-ch is-platform-blocked"
                          style={{ width: colW[ch], minWidth: colW[ch], maxWidth: colW[ch] }}
                          title="เฉพาะหน้าร้าน — ไม่เทียบแพลตฟอร์ม"
                        >
                          {narrow ? (
                            <span className="mph-blocked">✕</span>
                          ) : (
                            <span className="mph-platform-blocked" aria-hidden>
                              ✕
                            </span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={ch}
                        className={`mph-td is-num is-ch is-st-${waiting ? "no_live" : cell.status}${
                          !waiting &&
                          (cell.nameStatus === "near" || cell.nameStatus === "missing")
                            ? " is-name-warn"
                            : ""
                        }${waiting ? " is-waiting-scan" : ""}${selOn ? " is-cell-sel" : ""}`}
                        style={{ width: colW[ch], minWidth: colW[ch], maxWidth: colW[ch] }}
                        title={
                          hasHubLive
                            ? "ค่าสแกนจาก hub (ไม่ใช่ราคาหน้าร้าน)"
                            : "กรอก/สแกนใส่ชื่อ+ราคาจริงที่นี่ — ไม่ชนราคาหน้าร้าน"
                        }
                      >
                        {narrow ? (
                          <span className={`mph-mini is-${waiting ? "no_live" : cell.status}`}>
                            {shortPriceStatus(cell.status, waiting)}
                          </span>
                        ) : (
                          <div className="mph-cell mph-cell-compact">
                            <div className="mph-pair" data-kind={pair.kind}>
                              <span className="mph-pair-t-wrap">
                                <NetToShopBadge sell={cell.target} rule={netRule} store={storeBase} />
                                <TargetPriceField
                                  target={cell.target}
                                  fromOverride={cell.fromOverride}
                                  selected={selOn}
                                  ariaLabel={`เป้า ${channelLabel(ch)} ${item.name}`}
                                  title={
                                    cell.fromOverride
                                      ? `เป้า ${cell.target} · ระบุเอง (${formatRuleShort(rule)}) · คลิกเลือก · ดับเบิลคลิกแก้ราคาคงที่ · ${netToShopTitle(cell.target, netRule, storeBase)}`
                                      : `เป้า ${cell.target} · สูตรคอลัมน์ (${formatRuleShort(rule)}) · คลิกเลือก · Shift คลิกช่วงในคอลัมน์ · ดับเบิลคลิกใส่ราคาคงที่แถวนี้ · ${netToShopTitle(cell.target, netRule, storeBase)}`
                                  }
                                  editing={
                                    targetEdit?.scope === "item" &&
                                    targetEdit.id === item.id &&
                                    targetEdit.channel === ch
                                  }
                                  editValue={targetEdit?.value ?? ""}
                                  onSelectClick={(e) => onTargetSelect(e, sel)}
                                  onDoubleClick={() =>
                                    beginTargetEdit("item", item.id, ch, cell.target)
                                  }
                                  onChange={(value) =>
                                    setTargetEdit((prev) => (prev ? { ...prev, value } : prev))
                                  }
                                  onCommit={(value) =>
                                    void commitTargetEdit({
                                      scope: "item",
                                      id: item.id,
                                      channel: ch,
                                      value,
                                      original: cell.target,
                                    })
                                  }
                                  onCancel={() => setTargetEdit(null)}
                                />
                              </span>
                              <span
                                className={`mph-pair-eq is-${pair.kind}`}
                                title={liveStatusText(cell.status, waiting)}
                              >
                                {pair.mark}
                              </span>
                              <span className="mph-pair-live-wrap">
                                {(() => {
                                  const liveNum =
                                    ld.price.trim() === ""
                                      ? null
                                      : Math.max(0, Number(ld.price) || 0);
                                  if (!netRule || liveNum == null || waiting) return null;
                                  return (
                                    <NetToShopBadge sell={liveNum} rule={netRule} store={storeBase} />
                                  );
                                })()}
                                <input
                                  type="number"
                                  className="mph-input mph-live-price"
                                  value={ld.price}
                                  placeholder={waiting ? "…" : ""}
                                  title={
                                    netRule && ld.price.trim() !== ""
                                      ? netToShopTitle(Number(ld.price) || 0, netRule, storeBase)
                                      : "จริง (สแกน/กรอก) — ป้ายบน = เหลือถึงร้านหลังหัก GP/สูตรคอลัมน์"
                                  }
                                  aria-label={`ราคาจริง ${channelLabel(ch)} ${item.name}`}
                                  onChange={(e) =>
                                    setLiveCell(item.id, ch, "price", e.target.value, cell)
                                  }
                                  onBlur={() => void commitLive(item.id, ch, cell)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              </span>
                              <button
                                type="button"
                                className={`mph-name is-${cell.nameStatus}`}
                                title={
                                  ld.name || cell.liveName
                                    ? `ชื่อ: ${ld.name || cell.liveName} · แตะแก้`
                                    : "แตะใส่ชื่อบนแพลตฟอร์ม"
                                }
                                onClick={() => {
                                  setNameDetail({
                                    scope: "item",
                                    id: item.id,
                                    posName: item.name,
                                    channel: ch,
                                    cell,
                                    scannedAt:
                                      channelLive.items[item.id]?.[ch]?.scannedAt ?? null,
                                    nameDraft: ld.name || cell.liveName || "",
                                  });
                                }}
                              >
                                {waiting
                                  ? "…"
                                  : shortNameStatus(cell.nameStatus).replace("ชื่อ", "")}
                              </button>
                            </div>
                            <RuleKindBadge
                              rule={rule}
                              fromOverride={cell.fromOverride}
                              store={storeBase}
                              target={cell.target}
                              onClick={() => openOverride(item, ch)}
                              onClearOverride={
                                cell.fromOverride
                                  ? () => void clearCellOverride("item", item.id, ch)
                                  : undefined
                              }
                            />
                            <LiveAtLine
                              waiting={waiting}
                              iso={
                                channelLive.items[item.id]?.[ch]?.scannedAt ?? null
                              }
                              detail={channelLive.items[item.id]?.[ch]?.applyNote}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="mph-td is-note"
                    style={{ width: colW.note, minWidth: colW.note, maxWidth: colW.note }}
                  >
                    {isColCollapsed(colW.note) ? null : (
                      <input
                        type="text"
                        className="mph-note-input"
                        value={getNoteDraft(item)}
                        placeholder="note / สั่ง AI…"
                        title="โน้ตแถวนี้ — บันทึกทันทีเมื่อออกช่อง (ใช้ได้แม้โหมด ร)"
                        aria-label={`note ${item.name}`}
                        onChange={(e) => setNoteCell(item.id, e.target.value)}
                        onBlur={() => void commitNote(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {!hideMenus && !displayed.length && !optionRows.length ? (
              <tr>
                <td className="mph-td muted" colSpan={tableColCount}>
                  ไม่พบเมนู
                </td>
              </tr>
            ) : null}
            {showOptions && optionRows.length ? (
              <tr className="mph-opt-section">
                <td className="mph-td mph-opt-section-label" colSpan={tableColCount}>
                  ตัวเลือก · ส่วนเพิ่มราคา ({optionRows.length} รายการ · {visibleOptGroupCount}{" "}
                  กลุ่ม)
                </td>
              </tr>
            ) : null}
            {optionRows.map((r, i) => {
              const d = getOptDraft(r);
              const key = optRowKey(r.groupId, r.choice.id);
              const tone = optGroupTone.get(r.groupId) ?? OPT_GROUP_TONES[0]!;
              const toneStyle = optGroupToneVars(tone);
              const showHead = i === 0 || optionRows[i - 1]!.groupId !== r.groupId;
              const collapsed = {
                name: colW.name <= COLLAPSED_W + 4,
                cat: colW.cat <= COLLAPSED_W + 4,
                store: colW.store <= COLLAPSED_W + 4,
              };
              const rowRef = { scope: "option" as const, id: key };
              const rowMark = rowSelMark(rowRef);
              return (
                <Fragment key={key}>
                  {showHead ? (
                    <tr className="mph-opt-group-head" style={toneStyle}>
                      <td
                        className="mph-td mph-opt-group-label"
                        colSpan={tableColCount}
                      >
                        {r.groupName}
                        <span className="mph-chip-count">
                          {optCountByGroup.get(r.groupId) || 0}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  <tr
                    className={`mph-opt-row${r.storeOnly ? " mph-row-store-only" : ""}${rowMark === "on" ? " is-row-sel" : rowMark === "some" ? " is-row-sel-some" : ""}`}
                    style={toneStyle}
                  >
                  {renderSelCell(rowRef, r.choice.name)}
                  <td
                    className="mph-td is-sticky"
                    style={{ width: colW.name, minWidth: colW.name, maxWidth: colW.name }}
                  >
                    <span className="mph-name-cell">
                      {collapsed.name ? "…" : r.choice.name || "—"}
                    </span>
                  </td>
                  <td
                    className="mph-td is-mode"
                    style={{ width: colW.mode, minWidth: colW.mode, maxWidth: colW.mode }}
                  />
                  <td
                    className="mph-td is-cat"
                    style={{ width: colW.cat, minWidth: colW.cat, maxWidth: colW.cat }}
                    title={r.groupName}
                  >
                    {collapsed.cat ? "" : r.groupName}
                  </td>
                  <td
                    className="mph-td is-num"
                    style={{ width: colW.store, minWidth: colW.store, maxWidth: colW.store }}
                  >
                    {collapsed.store ? null : (
                      <input
                        type="number"
                        className="mph-input"
                        value={d.store}
                        onChange={(e) => setOptCell(r, "store", e.target.value)}
                        onBlur={() => void commitOptPrice(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        aria-label={`หน้าร้าน ${r.choice.name}`}
                      />
                    )}
                  </td>
                  {visibleChannels.map((ch) => {
                    const cell = r.channels[ch];
                    const columnRule = ruleDraft?.[ch];
                    const rule =
                      liveSettings?.optionOverrides[key]?.[ch] ?? columnRule;
                    const netRule = rule && columnRule ? resolveNetRule(rule, columnRule) : rule;
                    const storeBase = Math.max(0, Number(d.store) || 0);
                    const narrow = isColCollapsed(colW[ch]);
                    const waiting = clearedLive.has(ch);
                    const ld = getLiveDraft(key, ch, cell, "option");
                    const hasHubLive = !!channelLive.options[key]?.[ch];
                    const pair = pairCompareMark(cell.target, ld.price, waiting);
                    const sel = { scope: "option" as const, id: key, channel: ch };
                    const selOn = cellSel.has(cellSelKey(sel));
                    return (
                      <td
                        key={ch}
                        className={`mph-td is-num is-ch is-st-${waiting ? "no_live" : cell.status}${
                          !waiting &&
                          (cell.nameStatus === "near" || cell.nameStatus === "missing")
                            ? " is-name-warn"
                            : ""
                        }${waiting ? " is-waiting-scan" : ""}${selOn ? " is-cell-sel" : ""}`}
                        style={{ width: colW[ch], minWidth: colW[ch], maxWidth: colW[ch] }}
                        title={
                          hasHubLive
                            ? "ค่าสแกนตัวเลือกจาก hub"
                            : "กรอก/สแกนชื่อ+ราคาจริงตัวเลือก — ไม่ชนราคาหน้าร้าน"
                        }
                      >
                        {narrow ? (
                          <span className={`mph-mini is-${waiting ? "no_live" : cell.status}`}>
                            {shortPriceStatus(cell.status, waiting)}
                          </span>
                        ) : (
                          <div className="mph-cell mph-cell-compact">
                            <div className="mph-pair" data-kind={pair.kind}>
                              <span className="mph-pair-t-wrap">
                                {netRule ? (
                                  <NetToShopBadge
                                    sell={cell.target}
                                    rule={netRule}
                                    store={storeBase}
                                  />
                                ) : null}
                                <TargetPriceField
                                  target={cell.target}
                                  fromOverride={cell.fromOverride}
                                  selected={selOn}
                                  ariaLabel={`เป้า ${channelLabel(ch)} ${r.choice.name}`}
                                  title={
                                    rule && netRule
                                      ? `เป้า ${cell.target} · ${formatRuleShort(rule)} · คลิกเลือก · Shift คลิกช่วงในคอลัมน์ · ดับเบิลคลิกใส่ราคาคงที่แถวนี้ · ${netToShopTitle(cell.target, netRule, storeBase)}`
                                      : `เป้า ${cell.target} · คลิกเลือก · ดับเบิลคลิกตั้งราคาคงที่`
                                  }
                                  editing={
                                    targetEdit?.scope === "option" &&
                                    targetEdit.id === key &&
                                    targetEdit.channel === ch
                                  }
                                  editValue={targetEdit?.value ?? ""}
                                  onSelectClick={(e) => onTargetSelect(e, sel)}
                                  onDoubleClick={() =>
                                    beginTargetEdit("option", key, ch, cell.target)
                                  }
                                  onChange={(value) =>
                                    setTargetEdit((prev) => (prev ? { ...prev, value } : prev))
                                  }
                                  onCommit={(value) =>
                                    void commitTargetEdit({
                                      scope: "option",
                                      id: key,
                                      channel: ch,
                                      value,
                                      original: cell.target,
                                    })
                                  }
                                  onCancel={() => setTargetEdit(null)}
                                />
                              </span>
                              <span
                                className={`mph-pair-eq is-${pair.kind}`}
                                title={liveStatusText(cell.status, waiting)}
                              >
                                {pair.mark}
                              </span>
                              <span className="mph-pair-live-wrap">
                                {(() => {
                                  const liveNum =
                                    ld.price.trim() === ""
                                      ? null
                                      : Math.max(0, Number(ld.price) || 0);
                                  if (!netRule || liveNum == null || waiting) return null;
                                  return (
                                    <NetToShopBadge
                                      sell={liveNum}
                                      rule={netRule}
                                      store={storeBase}
                                    />
                                  );
                                })()}
                                <input
                                  type="number"
                                  className="mph-input mph-live-price"
                                  value={ld.price}
                                  placeholder={waiting ? "…" : ""}
                                  title={
                                    netRule && ld.price.trim() !== ""
                                      ? netToShopTitle(Number(ld.price) || 0, netRule, storeBase)
                                      : "จริง (สแกน/กรอก) — ป้ายบน = เหลือถึงร้านหลังหัก GP/สูตรคอลัมน์"
                                  }
                                  aria-label={`ราคาจริง ${channelLabel(ch)} ${r.choice.name}`}
                                  onChange={(e) =>
                                    setLiveCell(
                                      key,
                                      ch,
                                      "price",
                                      e.target.value,
                                      cell,
                                      "option",
                                    )
                                  }
                                  onBlur={() => void commitLive(key, ch, cell, "option")}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              </span>
                              <button
                                type="button"
                                className={`mph-name is-${cell.nameStatus}`}
                                title={
                                  ld.name || cell.liveName
                                    ? `ชื่อ: ${ld.name || cell.liveName} · แตะแก้`
                                    : "แตะใส่ชื่อบนแพลตฟอร์ม"
                                }
                                onClick={() => {
                                  setNameDetail({
                                    scope: "option",
                                    id: key,
                                    posName: r.choice.name,
                                    channel: ch,
                                    cell,
                                    scannedAt:
                                      channelLive.options[key]?.[ch]?.scannedAt ?? null,
                                    nameDraft: ld.name || cell.liveName || "",
                                  });
                                }}
                              >
                                {waiting
                                  ? "…"
                                  : shortNameStatus(cell.nameStatus).replace("ชื่อ", "")}
                              </button>
                            </div>
                            {rule ? (
                              <RuleKindBadge
                                rule={rule}
                                fromOverride={cell.fromOverride}
                                store={storeBase}
                                target={cell.target}
                                onClick={() => openOptionOverride(r, ch)}
                                onClearOverride={
                                  cell.fromOverride
                                    ? () => void clearCellOverride("option", key, ch)
                                    : undefined
                                }
                              />
                            ) : null}
                            <LiveAtLine
                              waiting={waiting}
                              iso={channelLive.options[key]?.[ch]?.scannedAt ?? null}
                              detail={channelLive.options[key]?.[ch]?.applyNote}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="mph-td is-note"
                    style={{ width: colW.note, minWidth: colW.note, maxWidth: colW.note }}
                  >
                    {isColCollapsed(colW.note) ? null : (
                      <input
                        type="text"
                        className="mph-note-input"
                        value={getOptNoteDraft(r)}
                        placeholder="note / สั่ง AI…"
                        title="โน้ตแถวตัวเลือก — บันทึกทันทีเมื่อออกช่อง"
                        aria-label={`note ${r.choice.name}`}
                        onChange={(e) =>
                          setNoteCell(optRowKey(r.groupId, r.choice.id), e.target.value)
                        }
                        onBlur={() => void commitOptNote(r.groupId, r.choice.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    )}
                  </td>
                </tr>
                </Fragment>
              );
            })}
            {showOptions && !optionRows.length && activeOptionGroups.length ? (
              <tr>
                <td className="mph-td muted" colSpan={tableColCount}>
                  ไม่มีตัวเลือกที่แสดง — กดชื่อกลุ่มด้านบนเพื่อเปิด
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mph-foot muted">
        {displayed.length}/{rows.length} เมนู
        {hideMenus ? " · ซ่อนเมนู — เฉพาะตัวเลือก" : ""}
        {hideStoreOnly ? ` · ซ่อนเฉพาะหน้าร้าน ${storeOnlyCount}` : ""}
        {hideStoreOnlyOptions ? ` · ซ่อนตัวเลือกเฉพาะหน้าร้าน ${storeOnlyOptionCount}` : ""}
        {showOptions ? ` · ${optionRows.length} ตัวเลือก` : " · ซ่อนตัวเลือก"} · เรียงหมวดตามลำดับ POS เสมอ
        {sortKey !== "cat" ? ` · ในหมวดเรียง${colTitle(sortKey)}${sortMark(sortKey)}` : ""} ·
        พิมพ์หัวคอลัมน์เมนู/หมวด/หน้าร้าน/Note = กรองทันที · Note กด «ว่าง» = เฉพาะแถวไม่มี note · คลิกชื่อคอลัมน์ = เรียง ·
        ติ๊กแถว = เลือกเป้าทุกช่องทาง หรือใส่ note รวม · คลิกเป้า = เลือกเซลล์ · Shift คลิก = ช่วง ·
        ดับเบิลคลิกเป้า = แก้แถวเดียว · คลิกชื่อเมนู = แก้ (ยืนยันก่อนบันทึก)
      </p>

      {nameConfirm ? (
        <div className="mph-mask" role="dialog" aria-modal="true" aria-labelledby="mph-name-confirm-title">
          <div className="mph-dialog">
            <h3 id="mph-name-confirm-title">ยืนยันเปลี่ยนชื่อ</h3>
            <dl className="mph-dl">
              <div>
                <dt>จาก</dt>
                <dd>{nameConfirm.from}</dd>
              </div>
              <div>
                <dt>เป็น</dt>
                <dd>{nameConfirm.to}</dd>
              </div>
            </dl>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => dismissNameConfirm(true)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                disabled={busy}
                onClick={() => void confirmNameSave()}
              >
                {busy ? "..." : "บันทึกชื่อ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showHubInfo ? (
        <div
          className="mph-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mph-hub-info-title"
          onClick={() => setShowHubInfo(false)}
        >
          <div
            className="mph-dialog mph-dialog-info"
            onClick={(e) => e.stopPropagation()}
            data-mph-legend="channel-price-hub"
          >
            <h3 id="mph-hub-info-title">อ่านตารางเทียบช่องทาง</h3>
            <dl className="mph-dl mph-info-dl">
              <div>
                <dt>หน้าร้าน</dt>
                <dd>
                  ราคา POS ที่ขายตรง — เป็นฐานของเป้าทุกแพลตฟอร์ม (ไม่มีคอลัมน์ต้นแบบเดลิเวอรี่กลาง
                  เพราะ GP แต่ละช่องทางไม่เท่ากัน)
                </dd>
              </div>
              <div>
                <dt>note</dt>
                <dd>
                  โน้ตต่อแถวเมนูและตัวเลือก บันทึกทันที — สั่งงาน AI ได้ แสดงแม้โหมด ร · เก็บที่{" "}
                  <code>menuItems.hubNote</code> และ <code>menuOptionGroups.options[].hubNote</code> ·
                  ติ๊กหลายแถวแล้วกด «ใส่ note» ที่แถบเลือก = เขียนข้อความเดียวกัน · หัวคอลัมน์ Note
                  พิมพ์กรองได้ · กด «ว่าง» = เฉพาะแถวไม่มี note · ปุ่ม «เฉพาะตัวเลือก» ซ่อนแถวเมนู ·
                  ปุ่ม «ร» / «ตัวเลือก ร» ซ่อนแถวเฉพาะหน้าร้านชั่วคราว ·
                  ปุ่ม «เคลียร์ Note» ล้างทั้งคอลัมน์ (ไม่ลบโน้ตรวม)
                </dd>
              </div>
              <div>
                <dt>ช่อง (ร/ด)</dt>
                <dd>
                  ร = เฉพาะหน้าร้าน → ✕ แพลตฟอร์ม · ด = เปิดเทียบแพลตฟอร์มจากราคาหน้าร้าน
                </dd>
              </div>
              <div>
                <dt>ป้ายเหลือถึงร้าน</dt>
                <dd>
                  ตัวเลขเล็กบนเป้าและบนราคาจริง = ขายราคานั้นแล้วเหลือถึงร้านกี่บาท ตามสูตรคอลัมน์ ·
                  GP% หักจีพี · คงที่ = ได้ตามราคาขาย · ดับเบิลคลิกช่องเป้าเพื่อใส่ราคาคงที่แถวนั้น (บันทึกทันที) ·
                  เขียว = ≥ หน้าร้าน · แดง = น้อยกว่า
                </dd>
              </div>
              <div>
                <dt>จริง</dt>
                <dd>
                  ราคาที่สแกน/กรอกจากแพลตฟอร์ม เก็บที่{" "}
                  <code>menuPriceHub/channelLive</code> — ว่างคู่กับเป้าจนกว่าจะมีค่า
                </dd>
              </div>
              <div>
                <dt>เวลาอัปเดต (ใต้ S/G/L)</dt>
                <dd>
                  ไม่มีคอลัมน์ lastUpdate รวม — เวลาอยู่ใต้แต่ละช่องทาง · หัวคอลัมน์ = ล่าสุดของช่องนั้น ·
                  ในเซล = เวลาของแถวนั้นหลังสแกน/บันทึก · วันนี้โชว์แค่ HH:mm
                </dd>
              </div>
              <div>
                <dt>= / ≠</dt>
                <dd>
                  เป้ากับจริงเท่ากัน = ตรง (match) · ไม่เท่า = ไม่ตรง · ช่องจริงว่าง =
                  ยังไม่เทียบ
                </dd>
              </div>
              <div>
                <dt>เคลียร์ / รอสแกน</dt>
                <dd>ล้างค่าจริงก่อนซิงค์ → สถานะรอสแกน → สแกนใส่กลับมาเทียบใหม่</dd>
              </div>
              <div>
                <dt>โน้ตรวม</dt>
                <dd>
                  โน้ตของทั้งตาราง (ไม่ใช่ note รายแถว) — AI/คนสรุปช่องว่าง เช่น เมนูมีบนแพลตฟอร์มแต่ไม่มีในระบบ
                  แล้วผู้ใช้หรือ AI อ่าน/สั่งงานต่อ · เก็บที่{" "}
                  <code>menuPriceHub/settings.tableNote</code>
                </dd>
              </div>
            </dl>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                onClick={() => setShowHubInfo(false)}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTableNoteInfo ? (
        <div
          className="mph-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mph-table-note-info-title"
          onClick={() => setShowTableNoteInfo(false)}
        >
          <div
            className="mph-dialog mph-dialog-info"
            onClick={(e) => e.stopPropagation()}
            data-mph-legend="table-note"
          >
            <h3 id="mph-table-note-info-title">โน้ตรวมตาราง · สำหรับ AI / ผู้ใช้</h3>
            <dl className="mph-dl mph-info-dl">
              <div>
                <dt>คืออะไร</dt>
                <dd>
                  โน้ตรวมของตารางเทียบราคาช่องทางทั้งก้อน — ไม่ใช่ note รายเมนูในคอลัมน์ท้ายแถว
                </dd>
              </div>
              <div>
                <dt>AI ใช้อย่างไร</dt>
                <dd>
                  อ่านโน้ตรวมนี้ก่อนลงมือ — มีวงจรสแกน→เทียบ→อัปเดตแพลตฟอร์ม→เขียนกลับตาราง
                  และกติกา Shopee/Grab/LINE MAN · สรุปช่องว่าง/คิวงานต่อท้ายได้
                </dd>
              </div>
              <div>
                <dt>ผู้ใช้ / AI รอบถัดไป</dt>
                <dd>
                  เปิดปุ่ม «โน้ตรวม» อ่านข้อความ แล้วสั่งงานต่อ (ซิงค์ ลบ เพิ่ม แก้ชื่อ) โดยอ้างอิงโน้ตนี้
                </dd>
              </div>
              <div>
                <dt>ที่เก็บ</dt>
                <dd>
                  <code>menuPriceHub/settings.tableNote</code>
                </dd>
              </div>
            </dl>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                onClick={() => setShowTableNoteInfo(false)}
              >
                ปิด
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                onClick={() => {
                  setShowTableNoteInfo(false);
                  openTableNote();
                }}
              >
                เปิดโน้ตรวม
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTableNote ? (
        <div
          className="mph-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mph-table-note-title"
        >
          <div className="mph-dialog mph-dialog-table-note">
            <h3 id="mph-table-note-title">โน้ตรวมตาราง</h3>
            <p className="muted mph-table-note-lead">
              คู่มือ+คิวงานของตารางนี้ · AI รอบถัดไปอ่านแล้วทำงานต่อกับ S/G/L ได้ · ไม่ใช่ note
              รายเมนู
            </p>
            <label className="mph-table-note-label">
              ข้อความ
              <textarea
                className="mph-table-note-area"
                rows={16}
                autoFocus
                value={tableNoteDraft}
                placeholder={HUB_TABLE_NOTE_GUIDE.slice(0, 120)}
                onChange={(e) => setTableNoteDraft(e.target.value)}
              />
            </label>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => setTableNoteDraft(HUB_TABLE_NOTE_GUIDE)}
              >
                ใส่ไกด์ไลน์ AI
              </button>
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => setShowTableNote(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                disabled={busy}
                onClick={() => void saveTableNote()}
              >
                {busy ? "..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clearConfirm ? (
        <div
          className="mph-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mph-clear-confirm-title"
        >
          <div className="mph-dialog">
            <h3 id="mph-clear-confirm-title">เคลียร์ก่อนซิงค์?</h3>
            <p className="muted">
              จะล้างราคา/ชื่อจริงของเมนูและตัวเลือกใน{" "}
              {clearConfirm.channels.map((ch) => channelLabel(ch)).join(" · ")} แล้วตั้งสถานะเป็น
              «รอสแกน» — ใช้เมื่อจะซิงค์/สแกนใหม่เพื่อเทียบ
            </p>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                onClick={() => setClearConfirm(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                onClick={() => applyClearLive(clearConfirm.channels)}
              >
                เคลียร์ · รอสแกน
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noteClearConfirm ? (
        <div
          className="mph-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mph-note-clear-title"
        >
          <div className="mph-dialog">
            <h3 id="mph-note-clear-title">เคลียร์คอลัมน์ Note ทั้งหมด?</h3>
            <p className="muted">
              จะลบข้อความในคอลัมน์ Note ทุกแถว ({noteRowCount} รายการ) รวมโน้ตที่สคริปต์ apply
              เขียนไว้ — ไม่ลบโน้ตรวม ไม่แตะราคา/สูตร/POS
            </p>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => setNoteClearConfirm(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                disabled={busy}
                onClick={() => void clearAllNotes()}
              >
                {busy ? "..." : "เคลียร์ Note"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {overrideEdit ? (
        <div className="mph-mask" role="dialog" aria-modal="true">
          <div className="mph-dialog">
            <h3>
              เป้า {channelLabel(overrideEdit.channel)}
              {overrideEdit.scope === "option" ? " · ตัวเลือก" : ""}
            </h3>
            <p className="muted">{overrideEdit.label}</p>
            <p className="muted mph-mini-hint">
              เบสหน้าร้าน {overrideEdit.base}฿ → เป้า{" "}
              {applyChannelRule(overrideEdit.base, {
                mode: overrideEdit.mode,
                value: Number(overrideEdit.value) || 0,
              })}
              ฿
              {overrideEdit.mode === "gp" ? (
                <> · หลังหัก GP เหลือ ≈ {overrideEdit.base}฿</>
              ) : overrideEdit.mode === "absolute" ? (
                <> · ราคาคงที่</>
              ) : (
                <>
                  {" "}
                  · มาร์จ{" "}
                  {formatMarginShort(
                    marginFromBase(
                      applyChannelRule(overrideEdit.base, {
                        mode: overrideEdit.mode,
                        value: Number(overrideEdit.value) || 0,
                      }),
                      overrideEdit.base,
                    ),
                  )}
                  ฿
                </>
              )}
            </p>
            <label>
              โหมดใส่ราคา
              <select
                value={overrideEdit.mode}
                onChange={(e) =>
                  setOverrideEdit((prev) =>
                    prev ? { ...prev, mode: e.target.value as ChannelPriceMode } : prev,
                  )
                }
              >
                <HubPriceModeOptions current={overrideEdit.mode} />
              </select>
            </label>
            <label>
              {overrideEdit.mode === "gp" ? "จีพีแพลตฟอร์ม (%)" : "ราคาเป้า"}
              <input
                type="text"
                inputMode="decimal"
                value={overrideEdit.value}
                onChange={(e) =>
                  setOverrideEdit((prev) =>
                    prev ? { ...prev, value: e.target.value } : prev,
                  )
                }
              />
            </label>
            <div className="mph-dialog-actions">
              <button type="button" className="mph-btn" onClick={() => setOverrideEdit(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => void applyOverride(true)}
              >
                ล้าง
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                disabled={busy}
                onClick={() => void applyOverride(false)}
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nameDetail ? (
        <div className="mph-mask" role="dialog" aria-modal="true" aria-labelledby="mph-live-name-title">
          <div className="mph-dialog">
            <h3 id="mph-live-name-title">
              ชื่อบน {channelLabel(nameDetail.channel)}
              {nameDetail.scope === "option" ? " · ตัวเลือก" : ""}
            </h3>
            <p className="muted">POS: {nameDetail.posName}</p>
            <label>
              ชื่อแพลตฟอร์ม
              <input
                type="text"
                autoFocus
                value={nameDetail.nameDraft}
                placeholder="ใส่ชื่อตามที่แสดงบนแอป"
                onChange={(e) =>
                  setNameDetail((prev) =>
                    prev ? { ...prev, nameDraft: e.target.value } : prev,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveLiveNameFromDetail();
                  }
                }}
              />
            </label>
            <p className="muted mph-mini-hint">
              สถานะตอนนี้: {nameStatusLabel(nameDetail.cell.nameStatus)}
              {nameDetail.cell.live != null ? ` · ราคาจริง ${nameDetail.cell.live}` : ""}
            </p>
            <div className="mph-dialog-actions">
              <button
                type="button"
                className="mph-btn"
                disabled={busy}
                onClick={() => setNameDetail(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="mph-btn mph-btn-primary"
                disabled={busy}
                onClick={() => void saveLiveNameFromDetail()}
              >
                {busy ? "..." : "บันทึกชื่อ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
