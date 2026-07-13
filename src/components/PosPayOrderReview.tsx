"use client";

import type { PosCartLine } from "@/lib/pos-menu-cart";
import { formatPlainNumber } from "@/lib/utils";

function modLines(selections: PosCartLine["selections"]): string[] {
  const tallies = new Map<string, number>();
  for (const sel of selections) {
    for (const choice of sel.choices) {
      tallies.set(choice.name, (tallies.get(choice.name) ?? 0) + 1);
    }
  }
  return [...tallies.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
}

export function PosPayOrderReview({ lines, total }: { lines: PosCartLine[]; total: number }) {
  const count = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <section className="pos-pay-order-review" aria-label="สรุปออเดอร์">
      <div className="pos-pay-order-head">
        <span>{count} รายการ</span>
        <strong>฿{formatPlainNumber(total)}</strong>
      </div>
      <ul className="pos-pay-order-list">
        {lines.map((l) => {
          const mods = modLines(l.selections);
          const lineTotal = l.unitPrice * l.qty;
          return (
            <li key={l.cartKey} className="pos-pay-order-line">
              <div className="pos-pay-order-line-main">
                {l.qty > 1 ? <span className="pos-pay-order-qty">×{l.qty}</span> : null}
                <span className="pos-pay-order-name">{l.item.name}</span>
                <span className="pos-pay-order-price">{formatPlainNumber(lineTotal)}</span>
              </div>
              {mods.map((m) => (
                <p key={m} className="pos-pay-order-mod">
                  · {m}
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
