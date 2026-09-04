/**
 * Parse Shopee Partner "ดาวน์โหลดเมนู" CSV (เมนูหลัก / กลุ่มตัวเลือกเสริม).
 * Hub file-load path — ZIP แตกเป็น CSV ก่อน หรือเลือกทั้งสองไฟล์พร้อมกัน.
 */
import { bestMatchByName, isMenuStoreOnly, normName } from "@/lib/menu-name-match";
import type { ChannelLiveStore } from "@/lib/menu-channel-price";
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

function scoreOpt(a: string, b: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return 0;
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

  const posByExt = new Map<string, MenuItem>();
  for (const p of deliveryPos) {
    const ext = items[p.id]?.shopee?.externalId;
    if (ext) posByExt.set(String(ext), p);
  }

  let matchedMenus = 0;
  let unmatchedMenus = 0;
  const usedPos = new Set<string>();
  for (const it of input.parsed.items) {
    const byName = deliveryPos.find((p) => !usedPos.has(p.id) && normName(p.name) === normName(it.name)) || null;
    const byId = it.dishId && posByExt.get(it.dishId) && !usedPos.has(posByExt.get(it.dishId)!.id)
      ? posByExt.get(it.dishId)!
      : null;
    const fuzzy =
      !byName && !byId
        ? bestMatchByName(it.name, deliveryPos.filter((p) => !usedPos.has(p.id)), { minScore: 0.85 })
        : null;
    const hit = byName || byId || (fuzzy && !usedPos.has(fuzzy.id) ? fuzzy : null);
    if (!hit) {
      unmatchedMenus += 1;
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
  for (const o of input.parsed.options) {
    const byId = o.optionId ? optByExt.get(o.optionId) : null;
    let best: (Choice & { score: number }) | null = null;
    if (!byId) {
      for (const c of posChoices) {
        const nameScore = scoreOpt(o.name, c.name);
        if (nameScore < 0.85) continue;
        const groupScore = scoreOpt(o.group, c.groupName);
        const score = nameScore * 0.7 + groupScore * 0.3;
        if (!best || score > best.score) best = { ...c, score };
      }
    }
    const hit = (byId && !usedOpt.has(byId.key) ? byId : null) || (best && !usedOpt.has(best.key) ? best : null);
    if (!hit) {
      unmatchedOpts += 1;
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

  return {
    next: { items, options, updatedAt: Date.now() },
    matchedMenus,
    unmatchedMenus,
    matchedOpts,
    unmatchedOpts,
  };
}
