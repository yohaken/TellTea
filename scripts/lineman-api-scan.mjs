#!/usr/bin/env node
/**
 * Pull live LINE MAN / Wongnai menu via GraphQL (Chrome session)
 * → lineman-live-scan.json (items + photoId + category + sortIndex)
 *
 *   node scripts/lineman-api-scan.mjs
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listWongnaiMenuItems,
  wongnaiGql,
  WONGNAI_GQL,
  BUSINESS,
  findWongnaiTab,
} from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");

async function main() {
  findWongnaiTab();
  const prev = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  const prevById = new Map((prev.items || []).map((it) => [it.id, it]));

  const groupsJson = await wongnaiGql("menuGroups", WONGNAI_GQL.menuGroups, {
    businessId: BUSINESS,
  });
  const groups = groupsJson?.data?.my?.menu?.groups?.data || [];
  const groupById = new Map(
    groups.map((g) => [g.id, g.name?.primary || g.name?.thai || g.name || ""]),
  );
  const groupOrder = new Map(groups.map((g, i) => [g.id, i]));

  const listed = await listWongnaiMenuItems();
  const scannedAt = new Date().toISOString();

  const items = listed.map((it, i) => {
    const old = prevById.get(it.id) || {};
    const catId = (it.categoryIds || [])[0] || "";
    return {
      id: it.id,
      name: it.name,
      status: it.status || old.status || "",
      listPrice: it.listPrice ?? old.listPrice ?? null,
      category: groupById.get(catId) || old.category || "",
      categoryId: catId || null,
      catalogRank: groupOrder.has(catId) ? groupOrder.get(catId) : null,
      sortIndex: Number.isFinite(Number(old.sortIndex)) ? Number(old.sortIndex) : i,
      href: it.href,
      offlinePrice: it.offlinePrice ?? old.offlinePrice ?? null,
      prices:
        old.prices ||
        [it.listPrice, it.pickupPrice, it.offlinePrice].filter((n) => n != null),
      photoId: it.photoId || "",
    };
  });

  // Recompute sortIndex within each category (preserve relative order from prior scan).
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  for (const [, arr] of byCat) {
    arr.sort(
      (a, b) =>
        (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.name.localeCompare(b.name, "th"),
    );
    arr.forEach((it, idx) => {
      it.sortIndex = idx;
    });
  }

  const withPhoto = items.filter((it) => it.photoId).length;
  const out = {
    at: scannedAt,
    scannedAt,
    source: "wongnai-gql-menuItems",
    method: "lineman-api-scan",
    count: items.length,
    items,
    categories: groups.map((g, i) => ({
      id: g.id,
      name: g.name?.primary || g.name?.thai || g.name || "",
      sortIndex: i,
      itemCount: items.filter((it) => it.categoryId === g.id).length,
    })),
  };
  writeFileSync(SCAN, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `LINE MAN API items ${items.length} · photos ${withPhoto} · cats ${groups.length}`,
  );
  console.log(`→ ${SCAN}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
