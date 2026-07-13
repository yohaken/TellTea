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
  return ids
    .map((id) => byId.get(id))
    .filter((g): g is MenuOptionGroup => g != null)
    .map((group) => ({
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

export function selectionKey(selections: PosCartSelection[]): string {
  if (!selections.length) return "";
  return selections
    .map((s) => `${s.groupId}:${s.choices.map((c) => c.optionId).sort().join(",")}`)
    .sort()
    .join("|");
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
  for (const group of groups) {
    const ids = picked[group.id] || [];
    const activeOptions = group.options.filter((o) => o.active);
    const validIds = new Set(activeOptions.map((o) => o.id));
    const chosen = ids.filter((id) => validIds.has(id));

    if (group.required && chosen.length === 0) {
      return `เลือก "${group.name}" ก่อน`;
    }
    if (!chosen.length) continue;

    if (group.selectionType === "single" && chosen.length > 1) {
      return `"${group.name}" เลือกได้ 1 อย่าง`;
    }
    if (group.selectionType === "multi") {
      const min = group.minSelect ?? 1;
      const max = group.maxSelect ?? activeOptions.length;
      if (chosen.length < min) return `"${group.name}" เลือกอย่างน้อย ${min}`;
      if (chosen.length > max) return `"${group.name}" เลือกได้ไม่เกิน ${max}`;
    }
  }
  return null;
}

export function selectionsFromPicked(
  groups: MenuOptionGroup[],
  picked: Record<string, string[]>,
): PosCartSelection[] {
  const out: PosCartSelection[] = [];
  for (const group of groups) {
    const ids = picked[group.id] || [];
    if (!ids.length) continue;
    const choices: PosSaleLineOptionChoice[] = [];
    for (const id of ids) {
      const opt = group.options.find((o) => o.id === id && o.active);
      if (opt) choices.push({ optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta });
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
