import type { MenuItem, MenuOptionGroup } from "@/lib/types";

export type MenuItemOptionSummary = {
  groupCount: number;
  choiceCount: number;
  /** Short labels for list row, e.g. ความหวาน, ท็อปปิ้ง */
  groupLabels: string[];
  groups: Array<{
    id: string;
    name: string;
    required: boolean;
    selectionType: string;
    choiceNames: string[];
    choiceCount: number;
  }>;
  line: string;
};

/** Resolve linked option groups for browse/list — smart one-line + expand detail. */
export function summarizeMenuItemOptions(
  item: MenuItem,
  optionGroups: MenuOptionGroup[],
): MenuItemOptionSummary | null {
  const ids = item.optionGroupIds || [];
  if (!ids.length) return null;

  const byId = new Map(optionGroups.map((g) => [g.id, g]));
  const groups = ids
    .map((id) => byId.get(id))
    .filter((g): g is MenuOptionGroup => !!g && g.active !== false)
    .map((g) => {
      const activeChoices = (g.options || []).filter((o) => o.active !== false);
      return {
        id: g.id,
        name: g.name,
        required: g.required === true,
        selectionType: g.selectionType,
        choiceNames: activeChoices.map((o) => o.name),
        choiceCount: activeChoices.length,
      };
    });

  if (!groups.length) return null;

  const choiceCount = groups.reduce((n, g) => n + g.choiceCount, 0);
  const groupLabels = groups.map((g) => g.name);
  const short = groupLabels.slice(0, 3).join(", ");
  const more = groupLabels.length > 3 ? ` +${groupLabels.length - 3}` : "";
  const line = `${groups.length} กลุ่ม · ${choiceCount} ตัวเลือก · ${short}${more}`;

  return {
    groupCount: groups.length,
    choiceCount,
    groupLabels,
    groups,
    line,
  };
}

export function selectionTypeLabel(type: string): string {
  if (type === "multi") return "เลือกได้หลายอย่าง";
  if (type === "unlimited") return "เพิ่มได้ไม่จำกัด";
  return "เลือก 1 อย่าง";
}
