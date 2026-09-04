/**
 * Match Grab menu names → POS (storefront) for rename planning.
 * Excludes POS "เฉพาะหน้าร้าน" from delivery-channel sync focus.
 */
import { normName } from "./grab-csv.mjs";

export const STORE_ONLY_RE = /เฉพาะหน้าร้าน/;

export function isStoreOnlyName(name) {
  return STORE_ONLY_RE.test(String(name || ""));
}

export function isHotName(s) {
  return /ร้อน/.test(s) && !/เย็น/.test(s);
}

export function isColdName(s) {
  return (/เย็น|ปั่น|16\s*ออนซ์/.test(s) && !/ร้อน/.test(s)) || /เย็น\/ปั่น/.test(s);
}

export function coreKey(s) {
  return normName(s)
    .toLowerCase()
    .replace(/[()（）]/g, " ")
    .replace(/\b(flat white|cappuccino|latte|espresso|americano|long black|caramel macchiato)\b/gi, " ")
    .replace(/กาแฟสด/g, " ")
    .replace(/\d+\s*ออนซ์/g, " ")
    .replace(/โฮมเมด/g, " ")
    .replace(/เฉพาะหน้าร้าน/g, " ")
    .replace(/ร้อน|เย็น|ปั่น/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreGrabToPos(grabName, posName) {
  const cg = coreKey(grabName);
  const cp = coreKey(posName);
  if (!cg || !cp) return 0;
  let s = 0;
  if (cg === cp) s = 0.9;
  else if (cp.includes(cg) || cg.includes(cp)) {
    // "ชานม" ⊂ "ชานมเผือก" must not beat exact peers — require near-equal length
    const shorter = cg.length <= cp.length ? cg : cp;
    const longer = cg.length > cp.length ? cg : cp;
    s = shorter.length / Math.max(1, longer.length) >= 0.85 ? 0.75 : 0.4;
  } else {
    const A = new Set(cg.split(" ").filter((x) => x.length >= 2));
    const B = new Set(cp.split(" ").filter((x) => x.length >= 2));
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    if (!A.size || !B.size) return 0;
    s = inter / (A.size + B.size - inter);
  }
  if ((isHotName(grabName) && isHotName(posName)) || (isColdName(grabName) && isColdName(posName))) s += 0.15;
  else if ((isHotName(grabName) && isColdName(posName)) || (isColdName(grabName) && isHotName(posName))) s -= 0.35;
  if (/12\s*ออนซ์/.test(posName) && isHotName(grabName)) s += 0.05;
  return s;
}

export function bestPosForGrab(grabName, posItems, { minScore = 0.5 } = {}) {
  const ranked = posItems
    .map((p) => ({ ...p, score: scoreGrabToPos(grabName, p.name) }))
    .filter((p) => p.score >= minScore)
    .sort((a, b) => {
      const aSame =
        (isHotName(grabName) && isHotName(a.name)) || (isColdName(grabName) && isColdName(a.name)) ? 1 : 0;
      const bSame =
        (isHotName(grabName) && isHotName(b.name)) || (isColdName(grabName) && isColdName(b.name)) ? 1 : 0;
      return bSame - aSame || b.score - a.score;
    });
  return ranked[0] || null;
}

/** Grab items whose name ≠ any POS name; pair to best POS for rename Grab → POS. */
export function buildGrabRenameToPosPlan(grabItems, posItems) {
  const deliveryPos = posItems.filter((p) => p.active !== false && !isStoreOnlyName(p.name));
  const posByNorm = new Map(deliveryPos.map((p) => [normName(p.name), p]));

  const exact = [];
  const rename = [];
  const unmatched = [];

  for (const g of grabItems) {
    if (isStoreOnlyName(g.name)) continue;
    const hit = posByNorm.get(normName(g.name));
    if (hit) {
      exact.push({ grab: g, pos: hit });
      continue;
    }
    const best = bestPosForGrab(g.name, deliveryPos);
    if (best) {
      const reasons = [];
      if (/[A-Za-z]/.test(g.name) || /[A-Za-z]/.test(best.name)) reasons.push("อังกฤษ/วงเล็บ");
      if (/12\s*ออนซ์/.test(best.name) && !/12\s*ออนซ์/.test(g.name)) reasons.push("POS มี 12 ออนซ์");
      if (isHotName(g.name) && isHotName(best.name)) reasons.push("คู่ร้อน");
      if (isColdName(g.name) && isColdName(best.name)) reasons.push("คู่เย็น");
      rename.push({
        grabName: g.name,
        grabId: g.itemId || g.id || "",
        grabCategory: g.category || "",
        posName: best.name,
        posId: best.id || "",
        posCategory: best.category || "",
        score: Number(best.score.toFixed(2)),
        reason: reasons.join(", "),
        action: "rename_grab_to_pos",
      });
    } else {
      unmatched.push({
        grabName: g.name,
        grabId: g.itemId || g.id || "",
        grabCategory: g.category || "",
      });
    }
  }

  return {
    at: new Date().toISOString(),
    note: "โฟกัส Grab→POS rename · ตัดเฉพาะหน้าร้านออก · เป้าชื่อ = หน้าร้าน (POS)",
    counts: {
      grab: grabItems.length,
      posDelivery: deliveryPos.length,
      exact: exact.length,
      renameGrabToPos: rename.length,
      unmatched: unmatched.length,
    },
    rename,
    unmatched,
  };
}
