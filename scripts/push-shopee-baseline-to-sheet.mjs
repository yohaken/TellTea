#!/usr/bin/env node
/**
 * Build Shopee baseline (Jul 15 export) + STOCK++ cross-ref + live Firestore,
 * then push to TellTea Google Sheet.
 *
 * Usage:
 *   node scripts/push-shopee-baseline-to-sheet.mjs [--csv path/to/shopee.csv]
 *
 * Requires: gcloud auth login yohaken@gmail.com --enable-gdrive-access
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { collection, getDocs } from "firebase/firestore";

const __dir = dirname(fileURLToPath(import.meta.url));
const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const DEFAULT_SHOPEE_CSV =
  "/Users/peerapongyohaken/Downloads/ไฟล์สำหรับการแก้ไขรายละเอียดเมนูู_15072026_141215.csv";

const TAB_MENU = "★ Shopee เมนู baseline";
const TAB_OPTS = "★ Shopee ตัวเลือก baseline";

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

async function fetchStockTab(token, title, maxRow = 300) {
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:Z${maxRow}`);
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const rows = data.values || [];
  const header = rows[0] || [];
  const col = (name) => header.indexOf(name);
  return { header, rows: rows.slice(1), col };
}

function parseShopeeCsv(csvPath) {
  const raw = readFileSync(csvPath);
  const rows = parse(raw, { relax_column_count: true, skip_empty_lines: true });
  const header = rows[0];
  const nameIdx = header.indexOf("ชื่อเมนูอาหาร");
  const priceIdx = header.indexOf("ราคา (฿)");
  const codeIdx = header.indexOf("รหัสเมนูอาหาร");
  const catIdx = header.indexOf("ชื่อหมวดหมู่");
  if (nameIdx < 0 || priceIdx < 0) {
    throw new Error("Shopee CSV missing ชื่อเมนูอาหาร or ราคา (฿) columns");
  }

  const items = [];
  for (const row of rows.slice(2)) {
    const name = (row[nameIdx] || "").trim();
    const priceRaw = (row[priceIdx] || "").trim();
    if (!name || !priceRaw) continue;
    const price = Number(priceRaw.replace(/,/g, ""));
    if (!Number.isFinite(price)) continue;
    items.push({
      shopeeName: name,
      shopeePriceBaseline: price,
      shopeeCode: (row[codeIdx] || "").trim(),
      shopeeCategory: (row[catIdx] || "").trim(),
    });
  }
  return items;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Firestore menu names often use NBSP — normalize for lookup. */
function normName(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexByNormName(items) {
  const map = new Map();
  for (const item of items) {
    map.set(normName(item.name), item);
  }
  return map;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellValue(cell) {
  const n = Number(cell);
  if (cell !== "" && Number.isFinite(n) && String(cell).trim() === String(n)) {
    return { userEnteredValue: { numberValue: n } };
  }
  return { userEnteredValue: { stringValue: String(cell ?? "") } };
}

async function buildMenuRows(shopeeItems, stock, firestoreByName) {
  const stockByShopee = new Map();
  for (const row of stock.rows) {
    const shopeeName = (row[stock.col("ชื่อเมนู Shopee")] || "").trim();
    if (!shopeeName) continue;
    stockByShopee.set(shopeeName, {
      mainName: (row[stock.col("ชื่อเมนู Main")] || "").trim(),
      storeOld: row[stock.col("ราคาเก่า")] || "",
      signPrice: row[stock.col("ราคาป้ายอ้างอิง")] || "",
      deliveryTarget: row[stock.col("ราคาขายเดลิเวอรี่")] || "",
      shopeeAfterCheck: row[stock.col("ราคา Shopee ตอนเช็ค")] || "",
      shopeeCheckTime: row[stock.col("เวลาเช็ค Shopee")] || "",
      grabCheck: row[stock.col("ราคา Grab ตอนเช็ค")] || "",
      lmCheck: row[stock.col("ราคา LM ตอนเช็ค")] || "",
      shopeeGroup: row[stock.col("กลุ่ม Shopee")] || "",
    });
  }

  const header = [
    "ชื่อเมนู Shopee",
    "ราคา Shopee เดิม (15 ก.ค.)",
    "รหัส Shopee",
    "หมวด Shopee",
    "ชื่อเมนู TellTea/POS",
    "firestore_id",
    "หน้าร้านปัจจุบัน",
    "เดลิ Firestore ปัจจุบัน",
    "ราคาป้าย (STOCK)",
    "เดลิเป้า (STOCK)",
    "Shopee หลังปรับ (STOCK เช็ค)",
    "Grab ตอนเช็ค",
    "LINE MAN ตอนเช็ค",
    "SF − Grab",
    "SF − LM",
    "SF − เดลิ FS",
    "match STOCK",
    "หมายเหตุ",
  ];

  const dataRows = [];
  let stockMatch = 0;
  let fsMatch = 0;

  for (const item of shopeeItems) {
    const s = stockByShopee.get(item.shopeeName);
    const mainName = s?.mainName || item.shopeeName;
    const fs = firestoreByName.get(normName(mainName));
    if (s) stockMatch++;
    if (fs) fsMatch++;

    const sf = item.shopeePriceBaseline;
    const grab = num(s?.grabCheck);
    const lm = num(s?.lmCheck);
    const fsDel = fs?.deliveryPrice ?? null;

    const notes = [];
    if (!s) notes.push("ไม่พบใน STOCK++");
    if (!fs) notes.push("ไม่พบใน Firestore");

    dataRows.push([
      item.shopeeName,
      sf,
      item.shopeeCode,
      item.shopeeCategory,
      mainName,
      fs?.id || "",
      fs?.price ?? "",
      fs?.deliveryPrice ?? "",
      s?.signPrice ?? "",
      s?.deliveryTarget ?? "",
      s?.shopeeAfterCheck ?? "",
      s?.grabCheck ?? "",
      s?.lmCheck ?? "",
      grab != null ? sf - grab : "",
      lm != null ? sf - lm : "",
      fsDel != null ? sf - fsDel : "",
      s ? "OK" : "missing",
      notes.join("; "),
    ]);
  }

  const intro = [
    [
      "★ ShopeeFood baseline — export 15 ก.ค. 2026 (ราคาเดิมก่อนปรับรอบ 18–21 ก.ค.)",
    ],
    [
      `รายการ ${shopeeItems.length} · จับคู่ STOCK++ ${stockMatch}/${shopeeItems.length} · Firestore ${fsMatch}/${shopeeItems.length}`,
    ],
    [
      "แหล่ง: Downloads CSV + STOCK++ แท็บ เทลทีราคา + Firestore live · คอลัมน์ SF−Grab/LM ติดลบ = Shopee ถูกกว่า",
    ],
    [],
    header,
  ];

  return { rows: [...intro, ...dataRows], counts: { total: shopeeItems.length, stockMatch, fsMatch } };
}

async function buildOptionRows(stockOpts, firestoreOpts) {
  const header = [
    "ชื่อตัวเลือก",
    "ราคา Shopee เดิม (STOCK เช็ค)",
    "หน้าร้าน (STOCK)",
    "เดลิเป้า (STOCK)",
    "Grab ตอนเช็ค",
    "LINE MAN ตอนเช็ค",
    "ชื่อ Grab",
    "หน้าร้าน Firestore",
    "เดลิ Firestore",
    "หมายเหตุ",
  ];

  const dataRows = [];
  for (const row of stockOpts.rows) {
    const name = (row[stockOpts.col("ชื่อตัวเลือก")] || "").trim();
    if (!name) continue;
    const shopeeCheck = row[stockOpts.col("ราคา Shopee ตอนเช็ค")] || "";
    if (!shopeeCheck) continue;

    const fs = firestoreOpts.get(normName(name));
    dataRows.push([
      name,
      shopeeCheck,
      row[stockOpts.col("ราคาหน้าร้าน")] || "",
      row[stockOpts.col("ราคาขายเดลิเวอรี่")] || "",
      row[stockOpts.col("ราคา Grab ตอนเช็ค")] || "",
      row[stockOpts.col("ราคา LM ตอนเช็ค")] || "",
      row[stockOpts.col("ชื่อตัวเลือก Grab")] || "",
      fs?.priceDelta ?? "",
      fs?.deliveryPriceDelta ?? "",
      row[stockOpts.col("หมายเหตุ Shopee")] || "",
    ]);
  }

  const intro = [
    ["★ Shopee ตัวเลือก — จาก STOCK++ แท็บ ตัวเลือก LINE MAN (ราคา Shopee ตอนเช็ค 17 ก.ค.)"],
    [`รายการ ${dataRows.length} · ยังไม่มี export CSV ตัวเลือกแยก — ใช้ STOCK เป็นฐาน`],
    [],
    header,
  ];

  return { rows: [...intro, ...dataRows], count: dataRows.length };
}

function indexFirestoreOptions(groups) {
  const map = new Map();
  for (const g of groups) {
    for (const o of g.options || []) {
      const name = String(o.name || "").trim();
      if (name) map.set(normName(name), o);
    }
  }
  return map;
}

async function pushTabs(token, tabs) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  const requests = [];

  let insertIndex = 0;
  for (const { title, rows } of tabs) {
    let sheetId = existing.get(title)?.sheetId;
    if (sheetId == null) {
      sheetId = Math.floor(Math.random() * 1e9);
      requests.push({
        addSheet: {
          properties: {
            sheetId,
            title,
            index: insertIndex,
            gridProperties: { frozenRowCount: 5 },
          },
        },
      });
      existing.set(title, { sheetId, index: insertIndex });
    } else {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, index: insertIndex, gridProperties: { frozenRowCount: 5 } },
          fields: "index,gridProperties.frozenRowCount",
        },
      });
    }
    insertIndex++;

    const endRow = rows.length;
    const endCol = Math.max(...rows.map((r) => r.length), 1);
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: endRow,
          startColumnIndex: 0,
          endColumnIndex: endCol,
        },
        rows: rows.map((row) => ({
          values: row.map((cell) => cellValue(cell)),
        })),
        fields: "userEnteredValue",
      },
    });
  }

  await sheetsFetch(TELLTEA_SHEET_ID, ":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function main() {
  const csvArg = process.argv.find((a) => a.startsWith("--csv="));
  const csvPath = csvArg ? csvArg.slice("--csv=".length) : DEFAULT_SHOPEE_CSV;

  console.log("=== Shopee baseline → TellTea Sheet ===");
  console.log("CSV:", csvPath);

  const shopeeItems = parseShopeeCsv(csvPath);
  console.log("Shopee items parsed:", shopeeItems.length);
  if (shopeeItems.length < 100) {
    throw new Error(`expected ~149 items, got ${shopeeItems.length}`);
  }

  const token = gcloudToken();
  const stockMenu = await fetchStockTab(token, "เทลทีราคา");
  const stockOpts = await fetchStockTab(token, "ตัวเลือก LINE MAN", 80);

  const db = await getSeedDb();
  const items = (await getDocs(collection(db, "menuItems"))).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
  const firestoreByName = indexByNormName(items);

  const optGroups = (await getDocs(collection(db, "menuOptionGroups"))).docs.map((d) => d.data());
  const firestoreOpts = indexFirestoreOptions(optGroups);

  const menu = await buildMenuRows(shopeeItems, stockMenu, firestoreByName);
  const opts = await buildOptionRows(stockOpts, firestoreOpts);

  console.log("Menu STOCK match:", menu.counts.stockMatch, "/", menu.counts.total);
  console.log("Menu Firestore match:", menu.counts.fsMatch, "/", menu.counts.total);
  console.log("Options rows:", opts.count);

  await pushTabs(token, [
    { title: TAB_MENU, rows: menu.rows },
    { title: TAB_OPTS, rows: opts.rows },
  ]);

  console.log("\nOK pushed to TellTea Google Sheet");
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
