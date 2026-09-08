#!/usr/bin/env node
/**
 * Pull live Grab menu via Merchant API (Chrome cookies) → grab-live-scan.json
 * Includes items, all modifier options (used + leftover clones), and categories.
 *
 *   node scripts/grab-api-scan.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGrabMenuApi, findGrabTab } from "./lib/grab-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const OUT_SCAN = join(DATA, "grab-live-scan.json");
const OUT_IDS = join(DATA, "grab-item-ids.json");

function baht(n) {
  n = Number(n);
  return Number.isFinite(n) ? Math.round(n / 100) : null;
}

function normalizePhotoId(id) {
  const s = String(id || "").trim();
  if (!s) return s;
  try {
    if (/^https?:\/\//i.test(s)) {
      return decodeURIComponent(new URL(s).pathname.split("/").filter(Boolean).pop() || s);
    }
  } catch {
    /* fall through */
  }
  return s;
}

function grabItemPhotoId(it) {
  const photos = it.photos || it.images;
  if (Array.isArray(photos) && photos.length) {
    const first = photos[0];
    if (typeof first === "string" && first.trim()) return normalizePhotoId(first.trim());
    if (first && typeof first === "object") {
      const u = first.url || first.photoURL || first.imageURL;
      if (typeof u === "string" && u.trim()) return normalizePhotoId(u.trim());
    }
  }
  const direct = it.photoURL || it.imageURL || it.itemPhoto || it.photoId;
  if (typeof direct === "string" && direct.trim()) return normalizePhotoId(direct.trim());
  return undefined;
}

function main() {
  const { windowIndex, tabIndex } = findGrabTab();
  const menu = fetchGrabMenuApi(tabIndex, windowIndex);
  const scannedAt = new Date().toISOString();

  const items = [];
  const byName = {};
  const byId = {};
  const categories = [];
  const linkedIds = new Set();
  const groupNameById = new Map();
  for (const g of menu.modifierGroups || []) {
    const id = g.modifierGroupID || g.modifierGroupId;
    if (id) groupNameById.set(id, g.modifierGroupName || g.name || "");
  }
  for (const c of menu.categories || []) {
    const catName = c.categoryName || c.name || "";
    const catItems = c.items || [];
    categories.push({
      id: c.categoryID || null,
      name: catName,
      itemCount: catItems.length,
    });
    for (const it of catItems) {
      const name = it.itemName || it.name || "";
      const itemId = it.itemID || it.itemId || "";
      const listPrice = baht(it.priceInMin ?? it.price);
      for (const id of it.linkedModifierGroupIDs || []) linkedIds.add(id);
      const optionGroupNames = (it.linkedModifierGroupIDs || [])
        .map((id) => groupNameById.get(id))
        .filter(Boolean);
      const photoId = grabItemPhotoId(it);
      items.push({
        name,
        listPrice,
        itemId,
        category: catName,
        status: it.availableStatus || it.status || "",
        optionGroupCount: (it.linkedModifierGroupIDs || []).length,
        optionGroupNames,
        sortIndex: items.length,
        ...(photoId !== undefined ? { photoId } : {}),
      });
      if (itemId) {
        byName[name] = itemId;
        byId[itemId] = { name, listPrice, category: catName };
      }
    }
  }

  const options = [];
  for (const g of menu.modifierGroups || []) {
    const group = g.modifierGroupName || "";
    const groupId = g.modifierGroupID || null;
    const related = (g.relatedItemIDs || []).length;
    const linked = related > 0 || linkedIds.has(groupId);
    let choiceIndex = 0;
    for (const m of g.modifiers || []) {
      options.push({
        group,
        name: m.modifierName || "",
        price: baht(m.priceInMin ?? m.price),
        optionId: m.modifierID || null,
        groupId,
        related,
        linked,
        choiceIndex: choiceIndex++,
      });
    }
  }

  const scan = {
    scannedAt,
    method: "grab-menu-api-v2",
    count: items.length,
    items,
    options,
    categories,
  };
  writeFileSync(OUT_SCAN, JSON.stringify(scan, null, 2) + "\n");
  writeFileSync(
    OUT_IDS,
    JSON.stringify({ updatedAt: scannedAt, byName, byId }, null, 2) + "\n",
  );

  const emptyCats = categories.filter((c) => c.itemCount === 0);
  const usedGroups = new Set(
    (menu.modifierGroups || [])
      .filter((g) => (g.relatedItemIDs || []).length > 0)
      .map((g) => g.modifierGroupName),
  );
  const leftoverGroups = [
    ...new Set(
      (menu.modifierGroups || [])
        .filter((g) => !(g.relatedItemIDs || []).length && !linkedIds.has(g.modifierGroupID))
        .map((g) => g.modifierGroupName),
    ),
  ];
  console.log(
    `Grab API items ${items.length} · options ${options.length} · cats ${categories.length} (empty ${emptyCats.length})`,
  );
  if (emptyCats.length) {
    console.log("empty categories:", emptyCats.map((c) => c.name).join(" · "));
  }
  if (leftoverGroups.length) {
    console.log(`unused modifier groups ${leftoverGroups.length}:`, leftoverGroups.join(" · "));
  } else {
    console.log(`in-use modifier group names: ${[...usedGroups].join(" · ") || "(none)"}`);
  }
  console.log(`→ ${OUT_SCAN}`);
}

main();
