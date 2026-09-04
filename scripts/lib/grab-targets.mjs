/**
 * Grab price targets = Shopee baseline prices (ยกราคา Shopee มาใส่ Grab).
 */
import { readFileSync, existsSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normName } from "./grab-csv.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SHOPEE_BASELINE = join(__dir, "../data/menu-price-baseline/shopee-baseline-2026-07-15.csv");

export function loadShopeeTargetsForGrab(baselinePath = SHOPEE_BASELINE) {
  if (!existsSync(baselinePath)) throw new Error(`Missing Shopee baseline: ${baselinePath}`);
  const rows = parse(readFileSync(baselinePath), { columns: true, skip_empty_lines: true });
  const byName = new Map();
  for (const r of rows) {
    const target = Number(r.shopeePrice);
    if (!Number.isFinite(target)) continue;
    const entry = {
      target,
      shopeeName: r.shopeeName,
      shopeeCode: r.shopeeCode || "",
      mainName: r.mainName || "",
      source: "shopee-baseline-2026-07-15",
    };
    for (const key of [r.shopeeName, r.mainName]) {
      const n = normName(key);
      if (n) byName.set(n, entry);
    }
  }
  return byName;
}

export function matchGrabTarget(grabName, byName) {
  return byName.get(normName(grabName)) || null;
}
