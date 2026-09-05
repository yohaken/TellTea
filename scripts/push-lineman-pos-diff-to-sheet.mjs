#!/usr/bin/env node
/**
 * Push LINE MAN / Wongnai vs POS name check to TellTea Google Sheet
 * (same pattern as ★ Shopee vs POS diff).
 *
 *   node scripts/push-lineman-pos-diff-to-sheet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const TAB = "★ LINE MAN vs POS diff";
const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");
const DEFAULT_POS = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const VERIFY = join(__dir, "data/menu-price-baseline/lineman-name-verify.json");

function gcloudToken() {
  return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", {
    encoding: "utf8",
  }).trim();
}

async function sheetsFetch(sheetId, path, token, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function cellValue(cell) {
  const n = Number(cell);
  if (cell !== "" && Number.isFinite(n) && String(cell).trim() === String(n)) {
    return { userEnteredValue: { numberValue: n } };
  }
  return { userEnteredValue: { stringValue: String(cell ?? "") } };
}

function field(row, key) {
  return row[key] ?? row[`\ufeff${key}`] ?? "";
}

function isActive(row) {
  return field(row, "active") === "true" || field(row, "active") === true;
}

function loadVerifyMap() {
  if (!existsSync(VERIFY)) return new Map();
  const data = JSON.parse(readFileSync(VERIFY, "utf8"));
  return new Map((data.results || []).map((r) => [r.id || r.itemId, r]));
}

function loadData(scanPath, posPath) {
  const live = JSON.parse(readFileSync(scanPath, "utf8"));
  const pos = parse(readFileSync(posPath), { columns: true, skip_empty_lines: true, bom: true });
  const verify = loadVerifyMap();

  const deliveryPos = pos.filter((p) => isActive(p) && !isStoreOnlyName(field(p, "name")));
  const posByNorm = new Map(deliveryPos.map((p) => [normName(field(p, "name")), p]));
  const storeOnlyPos = pos.filter((p) => isStoreOnlyName(field(p, "name")));

  const items = (live.items || []).map((it) => {
    const v = verify.get(it.id);
    const liveName = v?.liveName || it.name;
    return { ...it, name: liveName, verified: !!v?.liveName };
  });

  const matched = [];
  const nameDiff = [];
  const lmOnly = [];
  const usedPos = new Set();

  for (const it of items) {
    if (/น้ำเปล่า/.test(it.name) || isStoreOnlyName(it.name)) {
      lmOnly.push({ ...it, note: "เฉพาะหน้าร้าน — ไม่ควรขายเดลิเวอรี่" });
      continue;
    }
    const posItem = posByNorm.get(normName(it.name));
    if (posItem) {
      usedPos.add(normName(it.name));
      matched.push({
        lmName: it.name,
        posName: field(posItem, "name"),
        category: field(posItem, "category") || it.category || "",
        id: it.id,
        check: "ตรง",
      });
    } else {
      // exact name only — leave unmatched as LM-only / needs rename
      lmOnly.push({ ...it, note: "ยังไม่จับคู่ POS (หรือชื่อคนละแบบ)" });
    }
  }

  const posOnly = deliveryPos
    .filter((p) => !usedPos.has(normName(field(p, "name"))))
    .map((p) => ({
      name: field(p, "name"),
      category: field(p, "category"),
      price: field(p, "price"),
      deliveryPrice: field(p, "deliveryPrice"),
      id: field(p, "id"),
    }));

  return {
    scannedAt: live.scannedAt || "",
    source: live.source || "",
    lmCount: items.length,
    matched,
    nameDiff,
    lmOnly,
    posOnly,
    storeOnlyPos: storeOnlyPos.map((p) => field(p, "name")),
    verified: [...verify.values()].filter((v) => v.liveName).length,
  };
}

function buildRows(data) {
  const rows = [];
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  rows.push(["★ LINE MAN / Wongnai vs POS — เช็คชื่อ (เป้า = ชื่อหน้าร้าน POS)"]);
  rows.push([
    `อัปเดต ${now} · LM live ${data.lmCount} · ตรงชื่อ ${data.matched.length} · LM นอก/พิเศษ ${data.lmOnly.length} · POS โฟกัสที่ยังไม่มีบน LM ${data.posOnly.length} · verified edit ${data.verified}`,
  ]);
  rows.push([
    `แหล่ง: ${data.source || "lineman-live-scan.json"} · scannedAt ${data.scannedAt} · merchant https://merchant.wongnai.com/businesses/2688343/menu`,
  ]);
  rows.push(["นโยบาย: ชื่อทุกช่องทางต้องเหมือน POS · น้ำเปล่า / เฉพาะหน้าร้าน ไม่ขายเดลิเวอรี่"]);
  rows.push([]);

  rows.push(["── ตรง POS ──", data.matched.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ LINE MAN", "ชื่อ POS", "หมวด", "Wongnai ID", "ตรง POS?"]);
  data.matched
    .sort((a, b) => a.posName.localeCompare(b.posName, "th"))
    .forEach((m, n) => {
      rows.push([n + 1, m.lmName, m.posName, m.category, m.id, m.check]);
    });
  rows.push([]);

  rows.push(["── LINE MAN พิเศษ / ยังไม่จับคู่ ──", data.lmOnly.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ LINE MAN", "Wongnai ID", "หมวด LM", "หมายเหตุ"]);
  if (!data.lmOnly.length) {
    rows.push(["", "(ไม่มี)", "", "", ""]);
  } else {
    data.lmOnly.forEach((m, n) => {
      rows.push([n + 1, m.name, m.id || "", m.category || "", m.note || ""]);
    });
  }
  rows.push([]);

  rows.push(["── POS โฟกัสที่ยังไม่มีบน LINE MAN ──", data.posOnly.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ POS", "หมวด", "ราคาหน้าร้าน", "ราคา delivery", "Firestore ID"]);
  data.posOnly.forEach((p, n) => {
    rows.push([n + 1, p.name, p.category, p.price, p.deliveryPrice, p.id]);
  });
  rows.push([]);

  rows.push(["── POS เฉพาะหน้าร้าน (ตัดออกจากเดลิ) ──", data.storeOnlyPos.length, "รายการ"]);
  data.storeOnlyPos.forEach((name, n) => rows.push([n + 1, name]));

  return rows;
}

async function pushTab(token, title, rows) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  const requests = [];
  let sheetId = existing.get(title)?.sheetId;
  if (sheetId == null) {
    sheetId = Math.floor(Math.random() * 1e9);
    requests.push({
      addSheet: {
        properties: { sheetId, title, index: 1, gridProperties: { frozenRowCount: 5 } },
      },
    });
  } else {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, index: 1, gridProperties: { frozenRowCount: 5 } },
        fields: "index,gridProperties.frozenRowCount",
      },
    });
  }
  const endRow = rows.length;
  const endCol = Math.max(...rows.map((r) => r.length), 1);
  requests.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: endCol },
      rows: rows.map((row) => ({ values: row.map((c) => cellValue(c)) })),
      fields: "userEnteredValue",
    },
  });
  await sheetsFetch(TELLTEA_SHEET_ID, ":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function main() {
  console.log("=== LINE MAN vs POS diff → TellTea Sheet ===");
  const data = loadData(DEFAULT_SCAN, DEFAULT_POS);
  const rows = buildRows(data);
  const token = gcloudToken();
  await pushTab(token, TAB, rows);
  console.log(`\nOK tab "${TAB}"`);
  console.log(`  ตรง POS: ${data.matched.length}/${data.lmCount}`);
  console.log(`  LM พิเศษ/ไม่จับคู่: ${data.lmOnly.length}`);
  console.log(`  POS โฟกัสที่ยังไม่มีบน LM: ${data.posOnly.length}`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
