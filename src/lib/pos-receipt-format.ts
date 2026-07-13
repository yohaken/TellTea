import type { PosLocalReceiptLine } from "./pos-local-receipts";
import type { PosSaleLine } from "./types";

export type ReceiptModifierTally = { label: string; count: number };

/** แถบดำ / เน้น qty — เฉพาะมากกว่า 1 */
export function receiptQtyEmphasized(qty: number): boolean {
  return qty > 1;
}

function tallyFromOptionGroups(
  options: { groupName: string; choices: { name: string }[] }[],
  compact: boolean,
): ReceiptModifierTally[] {
  const tallies = new Map<string, number>();
  for (const group of options) {
    for (const choice of group.choices) {
      const label = compact ? choice.name : `${group.groupName}: ${choice.name}`;
      tallies.set(label, (tallies.get(label) ?? 0) + 1);
    }
  }
  return [...tallies.entries()].map(([label, count]) => ({ label, count }));
}

export function tallySaleLineModifiers(line: PosSaleLine, compact = false): ReceiptModifierTally[] {
  if (!line.options?.length) return [];
  return tallyFromOptionGroups(line.options, compact);
}

export function tallyLocalLineModifiers(line: PosLocalReceiptLine): ReceiptModifierTally[] {
  const tallies = new Map<string, number>();
  for (const o of line.options) {
    for (const name of o.choiceNames) {
      const label = o.groupName ? `${o.groupName}: ${name}` : name;
      tallies.set(label, (tallies.get(label) ?? 0) + 1);
    }
  }
  return [...tallies.entries()].map(([label, count]) => ({ label, count }));
}

/** ข้อความตัวเลือกย่อย — ×n เน้นเมื่อ count > 1 */
export function formatReceiptModifierText(label: string, count: number): string {
  return count > 1 ? `${label} ×${count}` : label;
}
