/**
 * Parse Shopee Partner "ดาวน์โหลดเมนู" CSV (เมนูหลัก / กลุ่มตัวเลือกเสริม).
 * Hub file-load path — ZIP แตกเป็น CSV ก่อน หรือเลือกทั้งสองไฟล์พร้อมกัน.
 */
import { isMenuStoreOnly, namesEqual, normName } from "@/lib/menu-name-match";
import {
  classifyUnmatchedItemReason,
  classifyUnmatchedOptionReason,
  optionNameGroupKey,
  replaceUnmatchedForChannel,
  unmatchedLiveId,
  type ChannelLiveStore,
  type UnmatchedLiveEntry,
} from "@/lib/menu-channel-price";
import type { MenuItem, MenuOptionGroup } from "@/lib/types";

export type ShopeeExportMenu = {
  name: string;
  listPrice: number;
  dishId: string | null;
  category: string;
};

export type ShopeeExportOption = {
  group: string;
  name: string;
  price: number;
  optionId: string | null;
  groupId: string | null;
};

export type ShopeeExportParsed = {
  items: ShopeeExportMenu[];
  options: ShopeeExportOption[];
};

export function cleanShopeeId(s: string): string {
  const raw = String(s ?? "").trim();
  const m = raw.match(/(\d{6,})/);
  return m ? m[1] : raw.replace(/[="'\s]/g, "");
}

function toBaht(raw: string): number | null {
  const n = Number(String(raw ?? "").replace(/[,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** RFC4180-ish CSV (handles quoted commas / doubled quotes). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function headerIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim() === name);
}

export function parseShopeeCsvText(text: string): ShopeeExportParsed {
  const rows = parseCsvRows(text);
  if (!rows.length) return { items: [], options: [] };
  const header = rows[0].map((h) => h.trim());
  const items: ShopeeExportMenu[] = [];
  const options: ShopeeExportOption[] = [];

  const menuName = headerIndex(header, "ชื่อเมนูอาหาร");
  const optName = headerIndex(header, "ชื่อตัวเลือกเสริม");

  if (menuName >= 0) {
    const priceIdx = headerIndex(header, "ราคา (฿)");
    const idIdx = headerIndex(header, "รหัสเมนูอาหาร");
    const catIdx = headerIndex(header, "ชื่อหมวดหมู่");
    for (const r of rows.slice(1)) {
      const name = normName(r[menuName] || "");
      if (!name) continue;
      const listPrice = toBaht(r[priceIdx] || "");
      if (listPrice == null) continue;
      items.push({
        name,
        listPrice,
        dishId: cleanShopeeId(r[idIdx] || "") || null,
        category: String(r[catIdx] || "").trim(),
      });
    }
  }

  if (optName >= 0) {
    const priceIdx = headerIndex(header, "ราคาเพิ่มเติมของตัวเลือก (฿)");
    const groupIdx = headerIndex(header, "ชื่อกลุ่มตัวเลือกเสริม");
    const oidIdx = headerIndex(header, "รหัสตัวเลือกเสริม");
    const gidIdx = headerIndex(header, "รหัสกลุ่มตัวเลือกเสริม");
    for (const r of rows.slice(1)) {
      const name = normName(r[optName] || "");
      if (!name) continue;
      const price = toBaht(r[priceIdx] || "");
      if (price == null) continue;
      options.push({
        group: String(r[groupIdx] || "").trim(),
        name,
        price,
        optionId: cleanShopeeId(r[oidIdx] || "") || null,
        groupId: cleanShopeeId(r[gidIdx] || "") || null,
      });
    }
  }

  return { items, options };
}

export async function parseShopeeExportFiles(files: File[]): Promise<ShopeeExportParsed> {
  const out: ShopeeExportParsed = { items: [], options: [] };
  for (const file of files) {
    const text = await file.text();
    const parsed = parseShopeeCsvText(text);
    out.items.push(...parsed.items);
    out.options.push(...parsed.options);
  }
  const seenMenu = new Set<string>();
  out.items = out.items.filter((it) => {
    const k = it.dishId || it.name;
    if (seenMenu.has(k)) return false;
    seenMenu.add(k);
    return true;
  });
  const seenOpt = new Set<string>();
  out.options = out.options.filter((o) => {
    const k = o.optionId || `${o.group}\t${o.name}`;
    if (seenOpt.has(k)) return false;
    seenOpt.add(k);
    return true;
  });
  return out;
}

export function applyShopeeExportToLiveStore(input: {
  parsed: ShopeeExportParsed;
  items: MenuItem[];
  optionGroups: MenuOptionGroup[];
  current: ChannelLiveStore;
  scannedAt?: string;
}): { next: ChannelLiveStore; matchedMenus: number; unmatchedMenus: number; matchedOpts: number; unmatchedOpts: number } {
  const scannedAt = input.scannedAt || new Date().toISOString();
  const deliveryPos = input.items.filter((p) => p.active !== false && !isMenuStoreOnly(p));
  const items = { ...(input.current.items || {}) };
  const options = { ...(input.current.options || {}) };
  const unmatchedFresh: UnmatchedLiveEntry[] = [];
  const unmatchedSeen = new Set<string>();

  function nextUnmatchedId(
    kind: UnmatchedLiveEntry["kind"],
    externalId: string | null,
    name: string,
    group: string | null,
  ): string {
    let id = unmatchedLiveId("shopee", kind, externalId, name, group);
    if (unmatchedSeen.has(id)) {
      let n = 2;
      while (unmatchedSeen.has(`${id}#${n}`)) n += 1;
      id = `${id}#${n}`;
    }
    unmatchedSeen.add(id);
    return id;
  }

  const posByExt = new Map<string, MenuItem>();
  for (const p of deliveryPos) {
    const ext = items[p.id]?.shopee?.externalId;
    if (ext) posByExt.set(String(ext), p);
  }

  let matchedMenus = 0;
  let unmatchedMenus = 0;
  const usedPos = new Set<string>();
  for (const it of input.parsed.items) {
    const byName = deliveryPos.find((p) => !usedPos.has(p.id) && namesEqual(p.name, it.name)) || null;
    const byId = it.dishId && posByExt.get(it.dishId) && !usedPos.has(posByExt.get(it.dishId)!.id)
      ? posByExt.get(it.dishId)!
      : null;
    const hit = byName || byId;
    if (!hit) {
      unmatchedMenus += 1;
      unmatchedFresh.push({
        id: nextUnmatchedId("item", it.dishId, it.name, it.category || null),
        kind: "item",
        channel: "shopee",
        name: it.name || "(ไม่มีชื่อ)",
        group: it.category || null,
        price: it.listPrice ?? null,
        externalId: it.dishId || null,
        reason: classifyUnmatchedItemReason(it.name || ""),
        cleanAction: classifyUnmatchedItemReason(it.name || "") === "hidden" ? "blocked" : "review",
        scannedAt,
      });
      continue;
    }
    usedPos.add(hit.id);
    matchedMenus += 1;
    items[hit.id] = {
      ...(items[hit.id] || {}),
      shopee: {
        name: it.name,
        price: it.listPrice,
        scannedAt,
        source: "scan",
        externalId: it.dishId,
      },
    };
  }

  type Choice = { key: string; groupId: string; groupName: string; choiceId: string; name: string };
  const posChoices: Choice[] = [];
  for (const g of input.optionGroups) {
    if (g.active === false) continue;
    for (const c of g.options || []) {
      if (c.active === false) continue;
      posChoices.push({
        key: `${g.id}::${c.id}`,
        groupId: g.id,
        groupName: g.name || "",
        choiceId: c.id,
        name: c.name || "",
      });
    }
  }
  const optByExt = new Map<string, Choice>();
  for (const c of posChoices) {
    const ext = options[c.key]?.shopee?.externalId;
    if (ext) optByExt.set(String(ext), c);
  }

  let matchedOpts = 0;
  let unmatchedOpts = 0;
  const usedOpt = new Set<string>();
  const leftoverOpts: typeof input.parsed.options = [];
  for (const o of input.parsed.options) {
    const byId = o.optionId ? optByExt.get(o.optionId) : null;
    let best: Choice | null = null;
    if (!byId) {
      const exact = posChoices.filter(
        (c) => !usedOpt.has(c.key) && namesEqual(o.name, c.name) && namesEqual(o.group, c.groupName),
      );
      best = exact[0] || null;
    }
    const hit = (byId && !usedOpt.has(byId.key) ? byId : null) || (best && !usedOpt.has(best.key) ? best : null);
    if (!hit) {
      unmatchedOpts += 1;
      leftoverOpts.push(o);
      continue;
    }
    usedOpt.add(hit.key);
    matchedOpts += 1;
    options[hit.key] = {
      ...(options[hit.key] || {}),
      shopee: {
        name: o.name,
        price: o.price,
        scannedAt,
        source: "scan",
        externalId: o.optionId,
      },
    };
  }

  const matchedNameGroups = new Set<string>();
  for (const c of posChoices) {
    if (!usedOpt.has(c.key)) continue;
    matchedNameGroups.add(optionNameGroupKey(c.groupName, c.name));
  }
  for (const o of leftoverOpts) {
    unmatchedFresh.push({
      id: nextUnmatchedId("option", o.optionId, o.name, o.group || null),
      kind: "option",
      channel: "shopee",
      name: o.name || "(ไม่มีชื่อ)",
      group: o.group || null,
      price: typeof o.price === "number" ? o.price : null,
      externalId: o.optionId,
      reason: classifyUnmatchedOptionReason({
        liveGroup: o.group || "",
        liveName: o.name || "",
        matchedNameGroups,
        posHasSameGroup: posChoices.some((c) => namesEqual(c.groupName, o.group || "")),
      }),
      cleanAction: "review",
      scannedAt,
    });
  }

  return {
    next: {
      items,
      options,
      unmatched: replaceUnmatchedForChannel(input.current.unmatched, "shopee", unmatchedFresh),
      updatedAt: Date.now(),
    },
    matchedMenus,
    unmatchedMenus,
    matchedOpts,
    unmatchedOpts,
  };
}
