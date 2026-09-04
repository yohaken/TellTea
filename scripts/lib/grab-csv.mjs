/**
 * Parse Grab Merchant bulk-menu CSV (ItemID / Price / OptionGroups).
 */
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export function normName(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse OptionGroup cell: name##min-max##opt1:price#opt2:price */
export function parseOptionGroup(cell) {
  const raw = String(cell ?? "").trim();
  if (!raw || !raw.includes("##")) return null;
  const parts = raw.split("##");
  if (parts.length < 3) return null;
  const groupName = parts[0].trim();
  const range = parts[1].trim();
  const opts = [];
  for (const piece of parts.slice(2).join("##").split("#")) {
    const t = piece.trim();
    if (!t) continue;
    const m = t.match(/^(.+):(-?\d+(?:\.\d+)?)$/);
    if (m) opts.push({ name: m[1].trim(), price: Number(m[2]) });
    else opts.push({ name: t, price: null });
  }
  return { groupName, range, options: opts };
}

export function loadGrabExportCsv(path) {
  const rows = parse(readFileSync(path), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });

  const items = [];
  const optionIndex = new Map(); // key group|opt → { group, name, prices: Set }

  for (const r of rows) {
    const itemId = String(r["*ItemID"] || r.ItemID || "").trim();
    if (!itemId.startsWith("THITE")) continue;
    const name = normName(r["*ItemName"] || r.ItemName);
    const price = Number(String(r["*Price"] || r.Price || "").replace(/[^\d.-]/g, ""));
    const category = String(r["*CategoryName"] || r.CategoryName || "").trim();
    const status = String(r["*AvailableStatus"] || r.AvailableStatus || "").trim();
    const optionGroups = [];
    for (let i = 1; i <= 8; i++) {
      const cell = r[`OptionGroup${i}`];
      const g = parseOptionGroup(cell);
      if (!g) continue;
      optionGroups.push(g);
      for (const o of g.options) {
        const key = `${g.groupName}\t${o.name}`;
        if (!optionIndex.has(key)) {
          optionIndex.set(key, { group: g.groupName, name: o.name, prices: new Set() });
        }
        if (Number.isFinite(o.price)) optionIndex.get(key).prices.add(o.price);
      }
    }
    items.push({
      itemId,
      name,
      listPrice: Number.isFinite(price) ? price : null,
      category,
      status,
      storeId: String(r.StoreID || "").trim() || null,
      optionGroups,
    });
  }

  const options = [...optionIndex.values()].map((o) => ({
    group: o.group,
    name: o.name,
    prices: [...o.prices].sort((a, b) => a - b),
    price: o.prices.size === 1 ? [...o.prices][0] : null,
  }));

  return { items, options };
}

export function toLiveScan(parsed, { source } = {}) {
  return {
    scannedAt: new Date().toISOString(),
    method: source || "grab-csv-export",
    count: parsed.items.length,
    items: parsed.items.map((it) => ({
      name: it.name,
      listPrice: it.listPrice,
      itemId: it.itemId,
      category: it.category,
      status: it.status,
      optionGroupCount: it.optionGroups.length,
    })),
    options: parsed.options,
  };
}
