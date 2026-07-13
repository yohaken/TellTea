import type {
  MenuItem,
  MenuOptionChoice,
  MenuOptionGroup,
  PosSaleLine,
  PosSaleLineOption,
  PosSaleLineOptionChoice,
} from "./types";

export type PosCartSelection = {
  groupId: string;
  groupName: string;
  choices: PosSaleLineOptionChoice[];
};

/** groupId → optionId → จำนวนหน่วย (ท็อปปิ้งซ้ำได้เมื่อ unlimited/multi) */
export type PickedCounts = Record<string, Record<string, number>>;

export const MAX_OPTION_UNITS_PER_CHOICE = 20;

export type PosCartLine = {
  cartKey: string;
  item: MenuItem;
  qty: number;
  unitPrice: number;
  selections: PosCartSelection[];
};

export function optionGroupsForItem(
  item: MenuItem,
  allGroups: MenuOptionGroup[],
): MenuOptionGroup[] {
  const ids = item.optionGroupIds || [];
  const byId = new Map(allGroups.filter((g) => g.active).map((g) => [g.id, g]));
  const linked = ids
    .map((id) => byId.get(id))
    .filter((g): g is MenuOptionGroup => g != null);

  // ลำดับตามที่ผูกลากในเมนูรายการ — ถ้าไม่มี custom order ใน ids ใช้ sortOrder กลุ่ม
  const ordered =
    ids.length > 0
      ? linked
      : [...byId.values()].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
        );

  return ordered.map((group) => ({
    ...group,
    options: sortChoicesForDisplay(group),
  }));
}

/** ความหวาน — เรียง 0% → มากสุด; กลุ่มอื่น — เรียงราคาต่ำ → สูง */
export function parseSweetnessPercent(name: string): number | null {
  const trimmed = name.trim();
  const match = trimmed.match(/(\d+)\s*%/);
  if (match) return Number(match[1]);
  if (/^(ไม่หวาน|ศูนย์|0\s*%|zero)/i.test(trimmed)) return 0;
  return null;
}

export function isSweetnessGroup(group: MenuOptionGroup): boolean {
  if (/ความหวาน|ระดับความหวาน|หวาน|sweet/i.test(group.name)) return true;
  const active = group.options.filter((o) => o.active);
  if (active.length < 2) return false;
  const withPct = active.filter((o) => parseSweetnessPercent(o.name) != null);
  return withPct.length >= Math.ceil(active.length * 0.6);
}

function choiceDisplayPrice(choice: MenuOptionChoice): number {
  return Math.max(0, choice.priceDelta ?? 0);
}

export function sortChoicesForDisplay(group: MenuOptionGroup): MenuOptionChoice[] {
  const active = group.options.filter((o) => o.active);
  if (isSweetnessGroup(group)) {
    return [...active].sort((a, b) => {
      const pa = parseSweetnessPercent(a.name) ?? a.sortOrder;
      const pb = parseSweetnessPercent(b.name) ?? b.sortOrder;
      return pa - pb || a.sortOrder - b.sortOrder;
    });
  }
  return [...active].sort((a, b) => {
    const priceDiff = choiceDisplayPrice(a) - choiceDisplayPrice(b);
    if (priceDiff !== 0) return priceDiff;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th");
  });
}

export function itemNeedsOptions(item: MenuItem, allGroups: MenuOptionGroup[]): boolean {
  return optionGroupsForItem(item, allGroups).length > 0;
}

export function selectionKeyFromPickedCounts(counts: PickedCounts): string {
  const parts: string[] = [];
  for (const [groupId, gc] of Object.entries(counts)) {
    const segment = Object.entries(gc)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => `${id}×${n}`)
      .join(",");
    if (segment) parts.push(`${groupId}:${segment}`);
  }
  return parts.sort().join("|");
}

export function selectionKey(selections: PosCartSelection[]): string {
  return selectionKeyFromPickedCounts(selectionsToCounts(selections));
}

export function selectionsToCounts(selections: PosCartSelection[]): PickedCounts {
  const counts: PickedCounts = {};
  for (const sel of selections) {
    const bucket = counts[sel.groupId] || {};
    for (const c of sel.choices) {
      bucket[c.optionId] = (bucket[c.optionId] || 0) + 1;
    }
    if (Object.keys(bucket).length) counts[sel.groupId] = bucket;
  }
  return counts;
}

export function groupTotalUnits(group: MenuOptionGroup, counts: PickedCounts): number {
  const gc = counts[group.id];
  if (!gc) return 0;
  return Object.values(gc).reduce((n, v) => n + v, 0);
}

export function groupMaxUnits(group: MenuOptionGroup): number | null {
  const activeCount = group.options.filter((o) => o.active).length;
  if (group.selectionType === "single") return 1;
  if (group.selectionType === "unlimited") return null;
  return group.maxSelect ?? activeCount;
}

export function groupUsesQuantitySteppers(group: MenuOptionGroup): boolean {
  if (isSweetnessGroup(group)) return false;
  if (group.selectionType === "unlimited") return true;
  if (group.selectionType === "multi") {
    const max = groupMaxUnits(group);
    return max == null || max > 1;
  }
  return false;
}

export function selectionKeyFromCounts(groups: MenuOptionGroup[], counts: PickedCounts): string {
  const parts: string[] = [];
  for (const group of groups) {
    const gc = counts[group.id];
    if (!gc) continue;
    const segment = Object.entries(gc)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => `${id}×${n}`)
      .join(",");
    if (segment) parts.push(`${group.id}:${segment}`);
  }
  return parts.sort().join("|");
}

export function buildCartKeyFromCounts(itemId: string, groups: MenuOptionGroup[], counts: PickedCounts): string {
  const sk = selectionKeyFromCounts(groups, counts);
  return sk ? `${itemId}::${sk}` : itemId;
}

export function buildCartKey(itemId: string, selections: PosCartSelection[]): string {
  const sk = selectionKey(selections);
  return sk ? `${itemId}::${sk}` : itemId;
}

export function choicePriceDelta(choice: PosSaleLineOptionChoice): number {
  return Math.round(choice.priceDelta * 100) / 100;
}

export function computeUnitPrice(basePrice: number, selections: PosCartSelection[]): number {
  let extra = 0;
  for (const sel of selections) {
    for (const c of sel.choices) extra += choicePriceDelta(c);
  }
  return Math.round((basePrice + extra) * 100) / 100;
}

export function buildLineDisplayName(itemName: string, selections: PosCartSelection[]): string {
  const parts: string[] = [];
  for (const sel of selections) {
    for (const c of sel.choices) {
      if (c.name && c.name !== "ไม่รับ") parts.push(c.name);
    }
  }
  if (!parts.length) return itemName;
  return `${itemName} (${parts.join(", ")})`;
}

export function validateSelections(
  groups: MenuOptionGroup[],
  picked: Record<string, string[]>,
): string | null {
  const counts: PickedCounts = {};
  for (const [gid, ids] of Object.entries(picked)) {
    counts[gid] = {};
    for (const id of ids) counts[gid]![id] = (counts[gid]![id] || 0) + 1;
  }
  return validatePickedCounts(groups, counts);
}

export function validatePickedCounts(groups: MenuOptionGroup[], counts: PickedCounts): string | null {
  for (const group of groups) {
    const gc = counts[group.id] || {};
    const activeOptions = group.options.filter((o) => o.active);
    const validIds = new Set(activeOptions.map((o) => o.id));
    const total = groupTotalUnits(group, counts);

    const chosenEntries = Object.entries(gc).filter(([id, n]) => n > 0 && validIds.has(id));
    const chosenOptionCount = chosenEntries.length;

    if (group.required && total === 0) {
      return `เลือก "${group.name}" ก่อน`;
    }
    if (total === 0) continue;

    if (group.selectionType === "single" || isSweetnessGroup(group)) {
      if (total > 1 || chosenOptionCount > 1) return `"${group.name}" เลือกได้ 1 อย่าง`;
      continue;
    }

    const max = groupMaxUnits(group);
    const min = group.minSelect ?? (group.required ? 1 : 0);
    if (max != null && total > max) {
      return `"${group.name}" เลือกได้ไม่เกิน ${max} หน่วย`;
    }
    if (group.selectionType === "multi" && total < min) {
      return `"${group.name}" เลือกอย่างน้อย ${min} หน่วย`;
    }

    for (const [, n] of chosenEntries) {
      if (n > MAX_OPTION_UNITS_PER_CHOICE) {
        return `"${group.name}" เลือกต่อรายการได้ไม่เกิน ${MAX_OPTION_UNITS_PER_CHOICE}`;
      }
    }
  }
  return null;
}

export function selectionsFromPicked(
  groups: MenuOptionGroup[],
  picked: Record<string, string[]>,
): PosCartSelection[] {
  const counts: PickedCounts = {};
  for (const [gid, ids] of Object.entries(picked)) {
    counts[gid] = {};
    for (const id of ids) counts[gid]![id] = (counts[gid]![id] || 0) + 1;
  }
  return selectionsFromCounts(groups, counts);
}

export function selectionsFromCounts(
  groups: MenuOptionGroup[],
  counts: PickedCounts,
): PosCartSelection[] {
  const out: PosCartSelection[] = [];
  for (const group of groups) {
    const gc = counts[group.id];
    if (!gc) continue;
    const choices: PosSaleLineOptionChoice[] = [];
    for (const [id, n] of Object.entries(gc)) {
      if (n <= 0) continue;
      const opt = group.options.find((o) => o.id === id && o.active);
      if (!opt) continue;
      for (let i = 0; i < n; i += 1) {
        choices.push({ optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta });
      }
    }
    if (choices.length) out.push({ groupId: group.id, groupName: group.name, choices });
  }
  return out;
}

export function cartLineToSaleLine(line: PosCartLine): PosSaleLine {
  const options: PosSaleLineOption[] | undefined = line.selections.length
    ? line.selections.map((s) => ({
        groupId: s.groupId,
        groupName: s.groupName,
        choices: s.choices,
      }))
    : undefined;
  return {
    menuItemId: line.item.id,
    name: buildLineDisplayName(line.item.name, line.selections),
    price: line.unitPrice,
    qty: line.qty,
    options,
  };
}
