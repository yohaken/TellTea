/**
 * Parse Wongnai menu export CSVs → POS catalog shape.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EXPORT_DIR = join(__dir, "../data/wongnai-export");

/** Category-level option groups (not in per-menu link export). */
const CATEGORY_GROUP_DEFAULTS = {
  "** ไอศครีม **": ["รสชาติ ไอศครีม"],
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      if (c === "\r") i += 1;
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export function normalizeName(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugKey(name) {
  const n = normalizeName(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "");
  return n || "group";
}

function findCsvFile(dir, part) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".csv") && f.includes(part));
  if (!files.length) throw new Error(`ไม่พบ CSV ที่มี "${part}" ใน ${dir}`);
  return join(dir, files[0]);
}

function mapSelection(requiredRaw, maxRaw) {
  const required = normalizeName(requiredRaw).toLowerCase() === "yes";
  const max = Number.parseInt(String(maxRaw || "1"), 10);
  if (max === 1) return { selectionType: "single", required };
  if (max === 0) return { selectionType: "unlimited", required };
  return {
    selectionType: "multi",
    required,
    minSelect: required ? 1 : 0,
    maxSelect: max,
  };
}

function parseOptionGroups(rows) {
  const optionGroups = {};
  const nameToKey = {};
  for (const row of rows.slice(1)) {
    if (!row[0]?.trim()) continue;
    const name = normalizeName(row[0]);
    const key = slugKey(name);
    const sel = mapSelection(row[1], row[2]);
    const options = [];
    for (let i = 3; i < row.length; i += 2) {
      const optName = normalizeName(row[i]);
      if (!optName) continue;
      const price = Number.parseFloat(row[i + 1] || "0");
      options.push({
        name: optName,
        priceDelta: Number.isFinite(price) ? price : 0,
      });
    }
    optionGroups[key] = {
      name,
      ...sel,
      options,
    };
    nameToKey[name] = key;
  }
  return { optionGroups, nameToKey };
}

function parseCategories(rows) {
  return rows.slice(1).filter((r) => r[0]?.trim()).map((r, i) => ({
    key: `cat_${i + 1}`,
    name: normalizeName(r[0]),
    sortOrder: (i + 1) * 1000,
    defaultGroupNames: r[1]?.trim() ? [normalizeName(r[1])] : [],
  }));
}

function parseMenuItems(rows) {
  return rows.slice(1).filter((r) => r[2]?.trim()).map((row, i) => ({
    key: `item_${i + 1}`,
    categoryName: normalizeName(row[1]),
    name: normalizeName(row[2]),
    nameEn: normalizeName(row[3]) || undefined,
    description: normalizeName(row[5]) || undefined,
    price: Number.parseFloat(row[6] || "0") || 0,
    recommended: normalizeName(row[9]).toLowerCase() === "yes",
    sortOrder: (i + 1) * 100,
    optionGroupNames: [],
  }));
}

function parseMenuLinks(rows) {
  const byMenu = new Map();
  for (const row of rows.slice(1)) {
    const menu = normalizeName(row[1]);
    const group = normalizeName(row[2]);
    if (!menu || !group) continue;
    if (!byMenu.has(menu)) byMenu.set(menu, new Set());
    byMenu.get(menu).add(group);
  }
  return byMenu;
}

function resolveGroupKey(name, nameToKey, optionGroups) {
  const n = normalizeName(name);
  if (nameToKey[n]) return nameToKey[n];
  const loose = Object.entries(optionGroups).find(
    ([, g]) => normalizeName(g.name).replace(/\s/g, "") === n.replace(/\s/g, ""),
  );
  if (loose) return loose[0];
  throw new Error(`ไม่พบกลุ่มตัวเลือก: "${name}"`);
}

export function buildCatalogFromWongnaiExport(exportDir = DEFAULT_EXPORT_DIR) {
  const groupsRows = parseCsv(readFileSync(findCsvFile(exportDir, "e35d"), "utf8"));
  const itemsRows = parseCsv(readFileSync(findCsvFile(exportDir, "9627"), "utf8"));
  const catsRows = parseCsv(readFileSync(findCsvFile(exportDir, "28d1"), "utf8"));
  const linksRows = parseCsv(readFileSync(findCsvFile(exportDir, "723c"), "utf8"));

  const { optionGroups, nameToKey } = parseOptionGroups(groupsRows);
  const categories = parseCategories(catsRows);
  const items = parseMenuItems(itemsRows);
  const linksByMenu = parseMenuLinks(linksRows);

  const catByName = new Map(categories.map((c) => [c.name, c]));

  for (const item of items) {
    const cat = catByName.get(item.categoryName);
    if (!cat) throw new Error(`หมวดไม่พบสำหรับเมนู "${item.name}": ${item.categoryName}`);

    const groupNames = new Set(linksByMenu.get(item.name) || []);
    for (const g of CATEGORY_GROUP_DEFAULTS[item.categoryName] || []) groupNames.add(g);
    for (const g of cat.defaultGroupNames) groupNames.add(g);

    item.categoryKey = cat.key;
    item.optionGroupKeys = [...groupNames].map((g) => resolveGroupKey(g, nameToKey, optionGroups));
  }

  return {
    meta: {
      source: "wongnai-csv-export",
      exportDir,
      categories: categories.length,
      items: items.length,
      optionGroups: Object.keys(optionGroups).length,
    },
    categories,
    items,
    optionGroups,
  };
}

export function flattenCatalog(catalog) {
  return {
    categories: catalog.categories,
    items: catalog.items,
    optionGroups: catalog.optionGroups,
  };
}
