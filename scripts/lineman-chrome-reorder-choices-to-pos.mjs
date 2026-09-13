#!/usr/bin/env node
/**
 * Reorder choices *within* LINE MAN option groups to match POS
 * (menuOptionGroups.options[].sortOrder) via Wongnai GraphQL menuPropertyUpdate.
 *
 *   node scripts/lineman-chrome-reorder-choices-to-pos.mjs --dry-run
 *   node scripts/lineman-chrome-reorder-choices-to-pos.mjs --apply
 *   node scripts/lineman-chrome-reorder-choices-to-pos.mjs --apply --group=ท้อปปิ้ง
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection, getDocs } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { namesEqual, normName } from "./lib/grab-csv.mjs";
import { BUSINESS, wongnaiGql, sleep } from "./lib/lineman-chrome.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-price-baseline");
const LIVE = join(DATA, "lineman-live-options.json");
const LOG = join(DATA, "lineman-choice-reorder-log.json");

const HASH = {
  menuProperty: "51ce02f7819912a541f32cec6c0274fe8c817ba96aa6136ca103cf28d7fec3a6",
  menuPropertyUpdate:
    "886976d76ccbca37c73767ccf4ee25e93534f282c23b2e7ee23cdb5338eeb6da",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || !args.includes("--apply");
const apply = args.includes("--apply");
const groupFilter = (args.find((a) => a.startsWith("--group=")) || "").slice(8);
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || 0;

function fold(s) {
  return normName(s || "");
}

function posChoices(group) {
  const raw = Array.isArray(group.options)
    ? group.options
    : Array.isArray(group.choices)
      ? group.choices
      : [];
  return [...raw]
    .filter((o) => o && (o.active !== false) && (o.name || o.label))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
    .map((o) => String(o.name || o.label || "").trim())
    .filter(Boolean);
}

function liveChoiceNames(group) {
  const opts = Array.isArray(group.options) ? group.options : [];
  return opts
    .map((o) => String(o.name || o.label || "").trim())
    .filter((n) => n && n !== "แก้ไขลำดับ");
}

function sameOrder(pos, live) {
  if (pos.length !== live.length) return false;
  return pos.every((n, i) => namesEqual(n, live[i]));
}

function toValueInput(v) {
  const out = {
    name: { primary: v.name?.primary || "" },
    restaurantId: Number(BUSINESS),
    price: v.additionalPrice ?? 0,
    outOfStock: !!v.outOfStock,
    status: v.status || "AVAILABLE",
    unsetSelfPickupPrice: true,
    unsetOfflinePrice: true,
  };
  if (v.name?.thai) out.name.thai = v.name.thai;
  if (v.name?.english) out.name.english = v.name.english;
  if (v.selfPickupPrice != null) {
    out.selfPickupPrice = v.selfPickupPrice;
    out.unsetSelfPickupPrice = false;
  }
  if (v.offlinePrice != null) {
    out.offlinePrice = v.offlinePrice;
    out.unsetOfflinePrice = false;
  }
  return out;
}

function matchLiveValue(byName, want) {
  const exact = byName.get(fold(want));
  if (exact) return exact;
  for (const [k, v] of byName) {
    if (namesEqual(k, want)) return v;
  }
  return null;
}

async function fetchProperty(propertyId) {
  const json = await wongnaiGql("menuProperty", HASH.menuProperty, {
    businessId: Number(BUSINESS),
    propertyId,
  });
  if (json?.errors || json?.err) {
    throw new Error(
      `menuProperty ${propertyId}: ${JSON.stringify(json.errors || json.err).slice(0, 300)}`,
    );
  }
  return json?.data?.my?.menu?.property || null;
}

async function updatePropertyOrder(prop, orderedValues) {
  const input = {
    id: prop.id,
    restaurantId: Number(BUSINESS),
    type: prop.type,
    name: {
      primary: prop.name?.primary || "",
      ...(prop.name?.thai ? { thai: prop.name.thai } : {}),
      ...(prop.name?.english ? { english: prop.name.english } : {}),
    },
    min: prop.min ?? 0,
    max: prop.max ?? 1,
    propertyValues: orderedValues.map(toValueInput),
  };
  const json = await wongnaiGql("menuPropertyUpdate", HASH.menuPropertyUpdate, {
    in: input,
  });
  if (json?.errors || json?.err) {
    throw new Error(
      `menuPropertyUpdate ${prop.id}: ${JSON.stringify(json.errors || json.err).slice(0, 400)}`,
    );
  }
  return json?.data?.menuPropertyUpdate?.property || null;
}

async function main() {
  if (!apply && !args.includes("--dry-run")) {
    console.log("Hint: pass --dry-run or --apply (defaulting to dry-run)");
  }

  const db = await getSeedDb();
  const groupsSnap = await getDocs(collection(db, "menuOptionGroups"));
  const posGroups = groupsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((g) => g.active !== false);

  if (!existsSync(LIVE)) {
    throw new Error(`Missing ${LIVE} — run lineman-chrome-scan-options.mjs first`);
  }
  const liveDoc = JSON.parse(readFileSync(LIVE, "utf8"));
  /** Scan stores flat choices; rebuild groups preserving scan order. */
  const liveGroups = [];
  if (Array.isArray(liveDoc.groups) && liveDoc.groups[0]?.options) {
    liveGroups.push(...liveDoc.groups);
  } else {
    const byId = new Map();
    for (const row of liveDoc.options || []) {
      const id = row.id;
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: row.group || row.name || "",
          url: row.url,
          options: [],
        });
      }
      const g = byId.get(id);
      if (!g.name && row.group) g.name = row.group;
      g.options.push({
        name: row.name,
        price: row.price,
        choiceIndex: row.choiceIndex,
        rank: row.rank,
      });
    }
    liveGroups.push(...byId.values());
  }

  const plan = [];
  for (const live of liveGroups) {
    const liveName = String(live.name || "").trim();
    if (!liveName || !live.id) continue;
    if (
      groupFilter &&
      !namesEqual(liveName, groupFilter) &&
      !fold(liveName).includes(fold(groupFilter))
    ) {
      continue;
    }
    const pos = posGroups.find((g) => namesEqual(g.name, liveName));
    if (!pos) continue;
    const want = posChoices(pos);
    const have = liveChoiceNames(live);
    if (!want.length || !have.length) continue;
    if (sameOrder(want, have)) continue;
    plan.push({
      id: live.id,
      name: liveName,
      pos: want,
      live: have,
      url: `https://merchant.wongnai.com/businesses/${BUSINESS}/menu-option/${live.id}/edit`,
    });
  }

  let work = plan;
  if (limit > 0) work = work.slice(0, limit);

  console.log(
    `LINE MAN choice-in-group reorder: ${work.length} group(s) wrong` +
      (groupFilter ? ` (filter=${groupFilter})` : "") +
      (dryRun ? " [dry-run]" : " [apply]"),
  );

  const log = { at: new Date().toISOString(), dryRun, results: [] };

  for (const item of work) {
    console.log(`\n• ${item.name}`);
    console.log(`  live: ${item.live.join(" · ")}`);
    console.log(`  pos:  ${item.pos.join(" · ")}`);
    if (dryRun) {
      log.results.push({ ...item, status: "dry-run" });
      continue;
    }

    try {
      const prop = await fetchProperty(item.id);
      if (!prop) throw new Error("property not found");

      const apiLive = (prop.values || []).map((v) => v.name?.primary || "");
      if (item.pos.every((n, i) => namesEqual(n, apiLive[i])) && apiLive.length >= item.pos.length) {
        console.log("  → already ok (API)");
        log.results.push({ id: item.id, name: item.name, status: "already-ok", after: apiLive });
        continue;
      }

      const byName = new Map(
        (prop.values || []).map((v) => [fold(v.name?.primary || v.name), v]),
      );
      const ordered = [];
      const missing = [];
      for (const want of item.pos) {
        const v = matchLiveValue(byName, want);
        if (!v) {
          missing.push(want);
          continue;
        }
        ordered.push(v);
        byName.delete(fold(v.name?.primary || v.name));
      }
      const extras = [...byName.values()];
      if (missing.length) {
        throw new Error(`missing on LM: ${missing.join(", ")}`);
      }
      const finalValues = [...ordered, ...extras];
      if (extras.length) {
        console.log(
          `  extras kept at end: ${extras.map((v) => v.name?.primary).join(" · ")}`,
        );
      }

      const updated = await updatePropertyOrder(prop, finalValues);
      const afterNames = (updated?.values || []).map((v) => v.name?.primary || "");
      const okExact = item.pos.every((n, i) => namesEqual(n, afterNames[i]));
      console.log(`  → ${okExact ? "ok" : "check"} ${afterNames.join(" · ")}`);
      log.results.push({
        id: item.id,
        name: item.name,
        status: okExact ? "ok" : "mismatch",
        after: afterNames,
      });
      await sleep(400);
    } catch (e) {
      console.log(`  FAIL ${e.message || e}`);
      log.results.push({ id: item.id, name: item.name, status: "fail", error: String(e.message || e) });
    }
  }

  writeFileSync(LOG, JSON.stringify(log, null, 2));
  console.log(`\nWrote ${LOG}`);
  const fails = log.results.filter((r) => r.status === "fail" || r.status === "mismatch");
  if (apply && fails.length) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
