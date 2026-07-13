/**
 * Match FoodStory manifest menu names → Firestore menu item names.
 */
import { normalizeName } from "./wongnai-csv.mjs";

export function normKey(s) {
  return normalizeName(s).toLowerCase();
}

export function normLoose(s) {
  return normKey(s)
    .replace(/[()]/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "");
}

export function stripEllipsis(s) {
  return String(s || "")
    .replace(/\.{2,}$/u, "")
    .trim();
}

export function alphaCore(s) {
  return normKey(stripEllipsis(s)).replace(/[^\p{L}\p{N}]+/gu, "");
}

function prefixScore(a, b) {
  const x = stripEllipsis(a);
  const y = stripEllipsis(b);
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length < 8) return 0;
  if (!longer.startsWith(shorter)) return 0;
  return shorter.length;
}

function alphaScore(a, b) {
  const x = alphaCore(a);
  const y = alphaCore(b);
  if (!x || !y) return 0;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length < 12) return 0;
  if (!longer.startsWith(shorter)) return 0;
  return shorter.length;
}

/**
 * @param {string} dbName
 * @param {Array<{ name: string, download?: { ok?: boolean } }>} manifestItems
 * @returns {{ row: object, method: string } | null}
 */
export function matchManifestRow(dbName, manifestItems) {
  const okRows = manifestItems.filter((r) => r.download?.ok);
  const nk = normKey(dbName);
  const nl = normLoose(dbName);

  const exact = okRows.find((r) => normKey(r.name) === nk);
  if (exact) return { row: exact, method: "exact" };

  const loose = okRows.find((r) => normLoose(r.name) === nl);
  if (loose) return { row: loose, method: "loose" };

  let best = null;
  let bestScore = 0;
  let bestMethod = "";
  let ties = 0;

  for (const row of okRows) {
    const p = prefixScore(normKey(dbName), normKey(row.name));
    if (p > bestScore) {
      best = row;
      bestScore = p;
      bestMethod = "prefix";
      ties = 0;
    } else if (p && p === bestScore) {
      ties += 1;
    }

    const a = alphaScore(dbName, row.name);
    if (a > bestScore) {
      best = row;
      bestScore = a;
      bestMethod = "alpha";
      ties = 0;
    } else if (a && a === bestScore && bestMethod === "alpha") {
      ties += 1;
    }
  }

  if (!best || bestScore < 8) return null;
  if (ties > 0) return null;
  return { row: best, method: bestMethod };
}

export function buildManifestIndex(manifestItems) {
  const okRows = manifestItems.filter((r) => r.download?.ok);
  return {
    okRows,
    byExact: new Map(okRows.map((r) => [normKey(r.name), r])),
    byLoose: new Map(okRows.map((r) => [normLoose(r.name), r])),
  };
}
