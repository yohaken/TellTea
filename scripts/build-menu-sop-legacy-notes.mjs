#!/usr/bin/env node
/**
 * Rebuild legacy SOP notes from Google Sheet tabs SOP + วัตถุดิบ
 * (or from scripts/data/menu-sop-legacy/parsed.json if offline)
 *
 *   node scripts/build-menu-sop-legacy-notes.mjs
 *
 * Requires: gcloud auth (yohaken@gmail.com) when refreshing from Sheet.
 * Output: scripts/data/menu-sop-legacy/legacy-sop-notes.json
 *         src/lib/data/legacy-sop-notes.json
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "data/menu-sop-legacy");
const POS_CSV = join(
  __dir,
  "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv",
);
const APP_OUT = join(__dir, "../src/lib/data/legacy-sop-notes.json");

mkdirSync(DATA, { recursive: true });
mkdirSync(dirname(APP_OUT), { recursive: true });

function token() {
  return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", {
    encoding: "utf8",
  }).trim();
}

async function fetchTab(tab) {
  const enc = encodeURIComponent(tab);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${enc}'`,
    { headers: { Authorization: `Bearer ${token()}` } },
  );
  if (!res.ok) throw new Error(`sheet ${tab} ${res.status}`);
  return res.json();
}

const SKIP_TOK = new Set([
  "เย็น",
  "ร้อน",
  "ปั่น",
  "สด",
  "กาแฟสด",
  "ออนซ์",
  "oz",
  "16",
  "22",
  "14",
  "12",
  "แก้ว",
  "ใหญ่",
  "เล็ก",
]);

function stripParen(s) {
  return String(s || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim();
}

function thaiCore(s) {
  let t = stripParen(s);
  t = t
    .replace(/\d+\s*(oz\.?|ออนซ์).*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (t.startsWith("กาแฟสด ")) t = t.slice("กาแฟสด ".length);
  return t.trim();
}

function expandKeys(name) {
  const keys = new Set();
  const base = thaiCore(name);
  keys.add(base);
  keys.add(stripParen(name).toLowerCase());
  keys.add(String(name).trim().toLowerCase());
  for (const suf of ["ปั่น", "เย็น", "ร้อน"]) {
    if (base.endsWith(suf) && base.length > suf.length + 1) {
      keys.add(base.slice(0, -suf.length).trim());
    }
  }
  if (base.startsWith("0% แคล ")) keys.add(base.replace("0% แคล ", ""));
  keys.add(base.replace(/\s+/g, ""));
  return [...keys].filter((k) => k && k.length >= 2);
}

function tokens(s) {
  const raw = thaiCore(s).match(/[\u0e00-\u0e7fa-z0-9%]+/gi) || [];
  return raw
    .map((t) => t.toLowerCase())
    .filter((t) => !SKIP_TOK.has(t) && t.length > 1)
    .map((t) => (t.endsWith("ปั่น") && t.length > 3 ? t.slice(0, -3) : t));
}

const STOCK_DEFS = [
  { stockName: "เมล็ดกาแฟ", aliases: ["เมล็ดกาแฟ", "กาแฟ"], sourceHint: "อาแม" },
  {
    stockName: "นมเมจิเรย์",
    aliases: ["นมเมจิเรย์", "นมจืด", "นมเมจิ", "นมสด"],
    sourceHint: "แม็คโคร",
  },
  {
    stockName: "นมข้นจืด คาร์เนชัน",
    aliases: ["นมข้นจืด", "คาร์เนชัน", "ครีมเทียมพร่องไขมัน"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "นมข้นหวานคาเนชั่น",
    aliases: ["นมข้นหวาน", "คาเนชั่น"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "ครีมเทียมดรีมมี่",
    aliases: ["ครีมเทียม", "ดรีมมี่", "เฟรปเป้"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "น้ำเชื่อมมิตรผล",
    aliases: ["น้ำเชื่อม", "มิตรผล"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "น้ำตาลคาราเมลมิตรผล",
    aliases: ["น้ำตาลคาราเมล", "คาราเมล"],
    sourceHint: "ท็อปเวิลด์",
  },
  { stockName: "น้ำผึ้ง", aliases: ["น้ำผึ้ง"], sourceHint: "แม็คโคร" },
  {
    stockName: "เนื้อมะม่วงแช่แข็ง",
    aliases: ["มะม่วง", "เนื้อมะม่วง"],
    sourceHint: "แม็คโคร",
  },
  {
    stockName: "เนื้อส้มแช่แข็ง",
    aliases: ["ส้ม", "เนื้อส้ม"],
    sourceHint: "แม็คโคร",
  },
  {
    stockName: "เนื้อมิกซ์เบอร์รี่แช่แข็ง",
    aliases: ["มิกซ์เบอร์รี่", "เบอร์รี่", "เนื้อผลไม้มิกซ์"],
    sourceHint: "แม็คโคร",
  },
  {
    stockName: "เนื้อพีชแช่แข็ง",
    aliases: ["พีช", "เนื้อพีช"],
    sourceHint: "แม็คโคร",
  },
  { stockName: "ผงมะนาว", aliases: ["ผงมะนาว", "มะนาว"], sourceHint: "แม็คโคร" },
  { stockName: "ผงเผือก", aliases: ["ผงเผือก", "เผือก"], sourceHint: "อี้เหวิน" },
  {
    stockName: "ผงมันม่วง",
    aliases: ["ผงมันม่วง", "มันม่วง"],
    sourceHint: "Babe Bake",
  },
  {
    stockName: "ชามะลิโยคุ",
    aliases: ["ชามะลิ", "ใบชามะลิ", "เบสชามะลิ"],
    sourceHint: "อี้เหวิน",
  },
  { stockName: "ชาแดงโยคุ", aliases: ["ชาแดง", "ชาดำ"], sourceHint: "ท็อปเวิลด์" },
  {
    stockName: "ชาไทย",
    aliases: ["ชาไทย", "เบสชาไทย"],
    sourceHint: "ชาใต้มาเลย์",
  },
  {
    stockName: "ชาเขียวนมตรามือ",
    aliases: ["ชาเขียวนม", "ตรามือ", "เบสชานม"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "มัทฉะตรามือ",
    aliases: ["มัทฉะ", "ผงมัทฉะ", "matcha"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "โกโก้",
    aliases: ["โกโก้", "ผงโกโก้", "ช็อกโกแลต"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "โอวัลติน",
    aliases: ["โอวัลติน", "ผงโอวัลติน"],
    sourceHint: "ท็อปเวิลด์",
  },
  { stockName: "ไมโล", aliases: ["ไมโล", "ผงไมโล"], sourceHint: "ท็อปเวิลด์" },
  {
    stockName: "เนสกาแฟเรดคัพ",
    aliases: ["เนสกาแฟ", "ผงเนสกาแฟ", "ผงกาแฟ"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "โอเลี้ยงตรามือ",
    aliases: ["โอเลี้ยง", "เบสโอเลี้ยง"],
    sourceHint: "ท็อปเวิลด์",
  },
  { stockName: "ไข่มุก", aliases: ["ไข่มุก"], sourceHint: "ท็อปเวิลด์" },
  {
    stockName: "บุกบราวน์ชูการ์ ติ่งฟง",
    aliases: ["บุกบราวน์", "บุกบราวน์ชูการ์"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "ซอสบราวน์ติ่งฟง",
    aliases: ["ซอสบราวน์", "บราวน์ชูการ์"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "ไซรัปคาราเมลลองบีช",
    aliases: ["ไซรัปคาราเมล"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "ไซรัปลองบีช",
    aliases: ["ไซรัปลองบีช", "เฮเซลนัท"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "ไซรัปติ่งฟง",
    aliases: ["ไซรัปติ่งฟง", "ติ่งฟง"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "เฮลซ์บลูบอยแดง",
    aliases: ["เฮลซ์", "บลูบอย", "นมชมพู", "นมมรกต"],
    sourceHint: "ท็อปเวิลด์",
  },
  { stockName: "ครีมชีส", aliases: ["ครีมชีส"], sourceHint: "TEA" },
  { stockName: "บ๊วยมังกรคู่", aliases: ["บ๊วย"], sourceHint: "ท็อปเวิลด์" },
  {
    stockName: "เจลลี่ผลไม้รวม",
    aliases: ["เจลลี่", "ผลไม้รวม"],
    sourceHint: "ท็อปเวิลด์",
  },
  {
    stockName: "น้ำเต้าหู้",
    aliases: ["น้ำเต้าหู้", "น้ำเต้าหู"],
    sourceHint: "ผลิตเอง",
  },
  {
    stockName: "สตรอเบอร์รี่แช่แข็ง",
    aliases: ["สตรอเบอร์รี่", "สตรอว์เบอร์รี"],
    sourceHint: "แม็คโคร?",
  },
];

function isPack(name) {
  return ["ถุง", "หลอด", "แก้ว", "ฝา", "ฟิล์ม", "กระดาษ", "โคน", "แก๊ซ", "ถ้วยท็อป"].some(
    (k) => name.includes(k),
  );
}

function stockShort(full) {
  if (full.includes("http")) return null;
  let s = full.split(/\s*[×xX]\s*\d+/)[0];
  s = s.replace(
    /\d[\d,]*\s*(กรัม|ก\.|กก|กิโลกรัม|มล|ลิตร|ซม|มิล|ชิ้น|ใบ|เส้น|ฝา|ม้วน).*/,
    "",
  );
  s = s.replace(/\d[\d,]*\s*$/, "").replace(/\s+/g, " ").trim().replace(/^[·\-/]+|[·\-/]+$/g, "");
  return s.length >= 2 ? s : null;
}

function matchStocks(ingredientText, methodText = "") {
  const text = `${ingredientText} ${methodText}`.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const d of STOCK_DEFS) {
    for (const al of [...d.aliases].sort((a, b) => b.length - a.length)) {
      if (text.includes(al.toLowerCase()) && !seen.has(d.stockName)) {
        found.push({ stockName: d.stockName, via: al, sourceHint: d.sourceHint });
        seen.add(d.stockName);
        break;
      }
    }
  }
  return found;
}

async function main() {
  const parsedPath = join(DATA, "parsed.json");
  let parsed;
  if (process.argv.includes("--offline") && existsSync(parsedPath)) {
    parsed = JSON.parse(readFileSync(parsedPath, "utf8"));
  } else {
    const sopRaw = await fetchTab("SOP");
    const ingRaw = await fetchTab("วัตถุดิบ");
    writeFileSync(join(DATA, "sheet-SOP.json"), JSON.stringify(sopRaw, null, 2));
    writeFileSync(join(DATA, "sheet-วัตถุดิบ.json"), JSON.stringify(ingRaw, null, 2));
    const sopRows = [];
    for (const r of (sopRaw.values || []).slice(1)) {
      if (!r?.[0]?.trim()) continue;
      sopRows.push({
        name: String(r[0]).trim(),
        ingredients: String(r[1] || "").trim(),
        method: String(r[2] || "").trim(),
        note: String(r[3] || "").trim(),
        equip: String(r[4] || "").trim(),
        cost: String(r[5] || "").trim(),
        price: String(r[6] || "").trim(),
      });
    }
    const ingRows = [];
    for (const r of (ingRaw.values || []).slice(1)) {
      if (!r?.[1]?.trim()) continue;
      ingRows.push({
        source: String(r[0] || "").trim(),
        name: String(r[1]).trim(),
        packUnit: String(r[2] || "").trim(),
        packPrice: String(r[3] || "").trim(),
        unitCost: String(r[4] || "").trim(),
        baseUnit: String(r[5] || "").trim(),
      });
    }
    parsed = { sop: sopRows, ingredients: ingRows };
    writeFileSync(parsedPath, JSON.stringify(parsed, null, 2));
  }

  const posNames = parse(readFileSync(POS_CSV, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  })
    .map((r) => String(r.name || r["\ufeffname"] || "").trim())
    .filter(Boolean);

  function scoreMatch(sheetName, posName) {
    const at = tokens(sheetName);
    const bt = tokens(posName);
    if (!at.length || !bt.length) return 0;
    const sheet0 = thaiCore(sheetName).startsWith("0%");
    const pos0 = posName.includes("0%");
    if (sheet0 !== pos0) return 0;
    if (at.join() === bt.join()) return 100;
    const as = new Set(at);
    const bs = new Set(bt);
    if ([...as].every((x) => bs.has(x))) return 92 - (bs.size - as.size) * 5;
    if ([...bs].every((x) => as.has(x)) && as.size - bs.size <= 1) return 86;
    return 0;
  }

  function bestMenuMatch(name) {
    const scored = posNames
      .map((c) => [scoreMatch(name, c), c])
      .sort((a, b) => b[0] - a[0]);
    if (scored[0]?.[0] >= 80) return [scored[0][1], `score:${scored[0][0]}`];
    return [null, "none"];
  }

  const sheetStocks = [];
  for (const x of parsed.ingredients) {
    if (isPack(x.name)) continue;
    const short = stockShort(x.name);
    if (!short) continue;
    sheetStocks.push({
      stockName: short,
      fullName: x.name,
      source: x.source,
      packUnit: x.packUnit,
      packPrice: x.packPrice,
      unitCost: x.unitCost,
      baseUnit: x.baseUnit,
    });
  }

  const notesList = [];
  for (const s of parsed.sop) {
    const [match, how] = bestMenuMatch(s.name);
    const stocks = matchStocks(s.ingredients, s.method);
    const stockNames = stocks.map((x) => x.stockName);
    let ingShort = s.ingredients.replace(/\s+/g, " ").slice(0, 90);
    if (s.ingredients.length > 90) ingShort += "…";
    const stockPart = stockNames.length ? stockNames.join(", ") : "— ยังไม่จับคู่";
    const note = `ของเดิมมี · ${ingShort} · คลังเบื้องต้น: ${stockPart}`;
    notesList.push({
      sheetName: s.name,
      matchMenu: match,
      matchHow: how,
      ingredients: s.ingredients,
      method: s.method,
      specialNote: s.note && s.note !== "-" ? s.note : "",
      equip: s.equip,
      legacyCost: s.cost,
      legacyPrice: s.price,
      stockMatches: stocks,
      note,
    });
  }

  const byKey = new Map();
  for (const entry of notesList) {
    const keys = new Set(expandKeys(entry.sheetName));
    if (entry.matchMenu) for (const k of expandKeys(entry.matchMenu)) keys.add(k);
    const sc = entry.matchHow.startsWith("score:")
      ? Number(entry.matchHow.split(":")[1])
      : 0;
    const ingLen = (entry.ingredients || "").length;
    for (const k of keys) {
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, entry);
        continue;
      }
      const psc = prev.matchHow.startsWith("score:")
        ? Number(prev.matchHow.split(":")[1])
        : 0;
      const ping = (prev.ingredients || "").length;
      let better = false;
      if (entry.matchMenu && !prev.matchMenu) better = true;
      else if (sc > psc) better = true;
      else if (sc === psc && ingLen > ping) better = true;
      if (better) byKey.set(k, entry);
    }
  }

  const notesByKey = Object.fromEntries(
    [...byKey.entries()].map(([k, v]) => [k, v.note]),
  );

  const out = {
    sourceSheetId: SHEET_ID,
    tabs: ["SOP", "วัตถุดิบ"],
    updatedAt: new Date().toISOString().slice(0, 10),
    summary: {
      sopRows: parsed.sop.length,
      matchedMenus: notesList.filter((e) => e.matchMenu).length,
      unmatchedMenus: notesList.filter((e) => !e.matchMenu).length,
      stockCatalogCandidates: sheetStocks.length,
      withStockMatch: notesList.filter((e) => e.stockMatches.length).length,
      noteKeys: byKey.size,
    },
    stockCatalogCandidates: sheetStocks,
    stockMatchDefs: STOCK_DEFS,
    notesByKey,
    entries: notesList,
  };

  writeFileSync(join(DATA, "legacy-sop-notes.json"), JSON.stringify(out, null, 2));
  const app = {
    sourceSheetId: out.sourceSheetId,
    updatedAt: out.updatedAt,
    summary: out.summary,
    notesByKey: out.notesByKey,
  };
  writeFileSync(join(DATA, "legacy-sop-notes-app.json"), JSON.stringify(app, null, 2));
  writeFileSync(APP_OUT, JSON.stringify(app, null, 2));
  console.log("OK build-menu-sop-legacy-notes", out.summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
