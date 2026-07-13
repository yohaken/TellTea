/**
 * POS menu catalog — จาก Wongnai CSV export (scripts/data/wongnai-export/)
 */
import {
  buildCatalogFromWongnaiExport,
  flattenCatalog as flattenWongnai,
  DEFAULT_EXPORT_DIR,
} from "../lib/wongnai-csv.mjs";

const catalog = buildCatalogFromWongnaiExport(DEFAULT_EXPORT_DIR);

export const CATALOG_META = catalog.meta;

export function flattenCatalog() {
  return flattenWongnai(catalog);
}

export const { categories: CATEGORIES, items: MENU_ITEMS, optionGroups: OPTION_GROUPS } = {
  categories: catalog.categories,
  items: catalog.items,
  optionGroups: catalog.optionGroups,
};
