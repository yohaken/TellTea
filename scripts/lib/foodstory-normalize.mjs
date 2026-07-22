/**
 * Normalize FoodStory API rows → POS menu snapshot (Phase 0).
 * Does not write Firestore — Phase 1 applies this snapshot.
 */
import { imageUrlFromKey } from "./foodstory-api.mjs";

function asString(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function asNumber(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function asBoolFlag(v) {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  return null;
}

function pickId(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]);
  }
  return "";
}

function mapSelection(requireFlag, minChoice, maxChoice) {
  const required = requireFlag === 1 || requireFlag === true || requireFlag === "1";
  const min = asNumber(minChoice, required ? 1 : 0);
  const max = asNumber(maxChoice, 1);
  if (max === 0) {
    return {
      required,
      selectionType: "unlimited",
      minSelect: required ? 1 : 0,
      maxSelect: undefined,
    };
  }
  if (max === 1) {
    return { required, selectionType: "single", minSelect: required ? 1 : 0, maxSelect: 1 };
  }
  return {
    required,
    selectionType: "multi",
    minSelect: required ? Math.max(1, min) : Math.max(0, min),
    maxSelect: max,
  };
}

function choicesForOption(optionId, choices) {
  return choices.filter((c) => {
    const oid = pickId(c, ["option_id", "optionId", "mas_option_id", "option_group_id"]);
    return oid && oid === String(optionId);
  });
}

function optionIdsFromMenuDetail(detail) {
  if (!detail || typeof detail !== "object") return [];
  const ids = [];
  const list = detail.option_list || detail.option_group_list || detail.options || [];
  if (Array.isArray(list)) {
    for (const row of list) {
      if (typeof row === "string" || typeof row === "number") {
        ids.push(String(row));
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const id = pickId(row, ["option_id", "optionId", "option_group_id", "id"]);
      // skip unchecked links when choose_flag present and false
      if ("choose_flag" in row && !(row.choose_flag === true || row.choose_flag === 1 || row.choose_flag === "1")) {
        continue;
      }
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

/**
 * @param {{
 *   meta?: Record<string, unknown>,
 *   categories?: unknown[],
 *   menus?: unknown[],
 *   options?: unknown[],
 *   choices?: unknown[],
 *   menuDetails?: Record<string, unknown>,
 *   groups?: unknown[],
 * }} raw
 */
export function normalizeFoodstoryRaw(raw = {}) {
  const categoriesIn = Array.isArray(raw.categories) ? raw.categories : [];
  const menusIn = Array.isArray(raw.menus) ? raw.menus : [];
  const optionsIn = Array.isArray(raw.options) ? raw.options : [];
  const choicesIn = Array.isArray(raw.choices) ? raw.choices : [];
  const details = raw.menuDetails && typeof raw.menuDetails === "object" ? raw.menuDetails : {};

  const categories = categoriesIn
    .map((row, i) => {
      const externalId = pickId(row, ["category_id", "categoryId", "id"]);
      if (!externalId) return null;
      const activeFlag = asBoolFlag(row.active ?? row.is_active ?? row.status);
      return {
        externalId,
        name: asString(row.category_name || row.name || row.categoryName, 80) || externalId,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? row.seq ?? (i + 1) * 1000, (i + 1) * 1000),
        active: activeFlag == null ? true : activeFlag,
      };
    })
    .filter(Boolean);

  const catByName = new Map(categories.map((c) => [c.name, c.externalId]));

  const optionGroups = optionsIn
    .map((row, i) => {
      const externalId = pickId(row, ["option_id", "optionId", "id"]);
      if (!externalId) return null;
      const sel = mapSelection(row.require_flag ?? row.requireFlag, row.min_choice ?? row.minChoice, row.max_choice ?? row.maxChoice);
      const nested = Array.isArray(row.choice_list)
        ? row.choice_list
        : Array.isArray(row.choices)
          ? row.choices
          : choicesForOption(externalId, choicesIn);
      const options = nested
        .map((c, j) => {
          const cid = pickId(c, ["choice_id", "choiceId", "mas_choice_id", "id"]);
          const name = asString(c.choice_name || c.name || c.choiceName, 80);
          if (!cid || !name) return null;
          const activeFlag = asBoolFlag(c.active ?? c.is_active);
          return {
            externalId: cid,
            name,
            priceDelta: asNumber(c.price ?? c.price_delta ?? c.priceDelta, 0),
            sortOrder: asNumber(c.sort_order ?? c.sortOrder ?? (j + 1) * 100, (j + 1) * 100),
            active: activeFlag == null ? true : activeFlag,
          };
        })
        .filter(Boolean);
      const activeFlag = asBoolFlag(row.active ?? row.is_active);
      return {
        externalId,
        name: asString(row.option_name || row.name || row.optionName, 80) || externalId,
        ...sel,
        options,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? (i + 1) * 1000, (i + 1) * 1000),
        active: activeFlag == null ? true : activeFlag,
      };
    })
    .filter(Boolean);

  const items = menusIn
    .map((row, i) => {
      const externalId = pickId(row, ["menu_id", "menuId", "id"]);
      if (!externalId) return null;
      const name = asString(row.menu_name || row.name || row.menuName, 120);
      if (!name) return null;
      let categoryExternalId = pickId(row, ["category_id", "categoryId"]);
      const categoryName = asString(row.category_name || row.categoryName, 80);
      if (!categoryExternalId && categoryName && catByName.has(categoryName)) {
        categoryExternalId = catByName.get(categoryName);
      }
      const detail = details[externalId] || details[String(externalId)] || null;
      let optionGroupExternalIds = optionIdsFromMenuDetail(detail);
      if (!optionGroupExternalIds.length) {
        optionGroupExternalIds = optionIdsFromMenuDetail(row);
      }
      const activeFlag = asBoolFlag(row.active ?? row.is_active ?? row.menu_active);
      const imageKey = row.image_key || row.imageKey || row.image || "";
      return {
        externalId,
        categoryExternalId: categoryExternalId || "",
        categoryName: categoryName || undefined,
        name,
        nameEn: asString(row.menu_name2 || row.name_en || row.nameEn, 120) || undefined,
        description: asString(row.detail || row.description, 500) || undefined,
        price: asNumber(row.price, 0),
        imageUrl: imageUrlFromKey(imageKey) || undefined,
        imageKey: asString(imageKey, 240) || undefined,
        optionGroupExternalIds,
        sortOrder: asNumber(row.sort_order ?? row.sortOrder ?? (i + 1) * 100, (i + 1) * 100),
        active: activeFlag == null ? true : activeFlag,
        code: asString(row.code, 64) || undefined,
      };
    })
    .filter(Boolean);

  // Ensure categories referenced by name-only menus exist
  for (const item of items) {
    if (!item.categoryExternalId && item.categoryName) {
      const synId = `name:${item.categoryName}`;
      if (!categories.some((c) => c.externalId === synId || c.name === item.categoryName)) {
        categories.push({
          externalId: synId,
          name: item.categoryName,
          sortOrder: (categories.length + 1) * 1000,
          active: true,
        });
      }
      item.categoryExternalId =
        categories.find((c) => c.name === item.categoryName)?.externalId || synId;
    }
  }

  const snapshot = {
    meta: {
      source: "foodstory-browser-capture",
      schemaVersion: 1,
      capturedAt: raw.meta?.capturedAt || new Date().toISOString(),
      branchId: raw.meta?.branchId || null,
      companyId: raw.meta?.companyId || null,
      counts: {
        categories: categories.length,
        items: items.length,
        optionGroups: optionGroups.length,
        choices: optionGroups.reduce((n, g) => n + g.options.length, 0),
      },
      ...(raw.meta && typeof raw.meta === "object" ? { upstream: raw.meta } : {}),
    },
    categories,
    items,
    optionGroups,
  };

  return snapshot;
}

export function validateSnapshot(snapshot) {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object") {
    return ["snapshot ว่าง"];
  }
  if (!Array.isArray(snapshot.categories) || !snapshot.categories.length) {
    issues.push("ไม่มีหมวด (categories)");
  }
  if (!Array.isArray(snapshot.items) || !snapshot.items.length) {
    issues.push("ไม่มีเมนู (items)");
  }
  const catIds = new Set((snapshot.categories || []).map((c) => c.externalId));
  const groupIds = new Set((snapshot.optionGroups || []).map((g) => g.externalId));
  for (const item of snapshot.items || []) {
    if (!item.externalId) issues.push(`เมนูไม่มี externalId: ${item.name}`);
    if (!item.name) issues.push(`เมนูไม่มีชื่อ: ${item.externalId}`);
    if (item.categoryExternalId && !catIds.has(item.categoryExternalId)) {
      issues.push(`เมนู "${item.name}" อ้างหมวดไม่มี: ${item.categoryExternalId}`);
    }
    for (const gid of item.optionGroupExternalIds || []) {
      if (!groupIds.has(gid)) {
        issues.push(`เมนู "${item.name}" อ้างกลุ่มตัวเลือกไม่มี: ${gid}`);
      }
    }
  }
  for (const g of snapshot.optionGroups || []) {
    if (!g.options?.length) {
      issues.push(`กลุ่มตัวเลือกว่าง: ${g.name || g.externalId}`);
    }
  }
  return issues;
}

export function summarizeSnapshot(snapshot) {
  const withOpts = (snapshot.items || []).filter((i) => (i.optionGroupExternalIds || []).length > 0);
  return {
    categories: snapshot.categories?.length || 0,
    items: snapshot.items?.length || 0,
    optionGroups: snapshot.optionGroups?.length || 0,
    itemsWithOptions: withOpts.length,
    issues: validateSnapshot(snapshot),
  };
}
