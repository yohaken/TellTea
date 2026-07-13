import type {
  MenuItem,
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
  return ids.map((id) => byId.get(id)).filter((g): g is MenuOptionGroup => g != null);
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
