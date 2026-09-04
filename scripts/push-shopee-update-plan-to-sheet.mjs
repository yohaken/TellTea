#!/usr/bin/env node
/**
 * Build ★ Shopee update plan tab: baseline (15 Jul) vs live Shopee vs STOCK++.
 * Optionally merge live scan from shopee-chrome-scan.mjs.
 *
 *   node scripts/push-shopee-update-plan-to-sheet.mjs [--scan path.json]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/shopee-chrome.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const TAB = "★ Shopee update plan";
const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_CSV = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const DEFAULT_SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");

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

function loadBaseline() {
  const rows = parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true });
  return rows.map((r) => ({
    shopeeName: r.shopeeName,
    targetPrice: Number(r.shopeePrice),
    shopeeCode: r.shopeeCode || "",
    mainName: r.mainName || "",
    stockAfterJuly: num(r.stock_shopee_check),
    grabCheck: num(r.stock_grab_check),
    lmCheck: num(r.stock_lm_check),
  }));
}

function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

async function loadStockShopee(token) {
  const range = encodeURIComponent("'เทลทีราคา'!A1:Z300");
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const header = data.values?.[0] || [];
  const col = (n) => header.indexOf(n);
  const map = new Map();
  for (const row of (data.values || []).slice(1)) {
    const sn = (row[col("ชื่อเมนู Shopee")] || "").trim();
    if (!sn) continue;
    map.set(sn, {
      afterCheck: num(row[col("ราคา Shopee ตอนเช็ค")]),
      checkTime: row[col("เวลาเช็ค Shopee")] || "",
    });
  }
  return map;
}

function loadLiveScan(path) {
  if (!existsSync(path)) return new Map();
  const data = JSON.parse(readFileSync(path, "utf8"));
  const map = new Map();
  for (const it of data.items || []) {
    map.set(it.name, it);
  }
  return map;
}

function buildRows(baseline, liveMap, stockMap) {
  const header = [
    "ลำดับ",
    "ชื่อเมนู Shopee",
    "ราคาเป้า (baseline 15 ก.ค.)",
    "ราคา Shopee ตอนนี้ (Chrome)",
    "ราคาในระบบ (list)",
    "ราคาแสดง (promo?)",
    "STOCK หลังปรับ ก.ค.",
    "Grab เช็ค",
    "LM เช็ค",
    "ต้องแก้?",
    "ผลต่าง (เป้า−ปัจจุบัน)",
    "สถานะ",
    "เวลาเช็คล่าสุด",
    "หมายเหตุ",
    "ชื่อ TellTea/POS",
    "รหัส Shopee",
  ];

  const dataRows = [];
  let needChange = 0;

  baseline.forEach((b, i) => {
    const live = liveMap.get(b.shopeeName);
    const liveList = live?.listPrice ?? "";
    const liveDisplay = live?.displayPrice ?? "";
    const current = liveList !== "" ? liveList : "";
    const diff = current !== "" ? b.targetPrice - current : "";
    const mustChange =
      current !== "" && current !== b.targetPrice ? "ใช่" : current === "" ? "รอสแกน" : "ไม่";
    if (mustChange === "ใช่") needChange++;

    const stock = stockMap.get(b.shopeeName);
    const notes = [];
    if (liveDisplay !== "" && liveList !== "" && liveDisplay !== liveList) {
      notes.push("มีราคา 2 ชั้น (โปร?)");
    }
    if (stock && stock.afterCheck !== "" && stock.afterCheck !== b.targetPrice) {
      notes.push("STOCK หลังปรับ≠baseline");
    }

    dataRows.push([
      i + 1,
      b.shopeeName,
      b.targetPrice,
      current,
      liveList,
      liveDisplay,
      stock?.afterCheck ?? b.stockAfterJuly ?? "",
      b.grabCheck,
      b.lmCheck,
      mustChange,
      diff,
      "",
      live ? new Date().toISOString().slice(0, 16).replace("T", " ") : "",
      notes.join("; "),
      b.mainName,
      b.shopeeCode,
    ]);
  });

  const intro = [
    ["★ ShopeeFood — แผน restore ราคา (อัปผ่าน Chrome ไม่ใช้ CSV upload)"],
    [
      `เป้า: baseline 15 ก.ค. · ${baseline.length} เมนู · ต้องแก้ ${needChange} (จาก live scan) · Grab/LM แยกชีทภายหลัง`,
    ],
    [
      "Workflow: shopee-chrome-scan --workers=6 → batch-update --workers=6 · สถานะ=OK เมื่อราคาตรงเป้า",
    ],
    [],
    header,
  ];

  return { rows: [...intro, ...dataRows], needChange, total: baseline.length };
}

async function pushTab(token, rows) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = (meta.sheets || []).find((s) => s.properties.title === TAB);
  let sheetId = existing?.properties.sheetId;
  const requests = [];

  if (sheetId == null) {
    sheetId = Math.floor(Math.random() * 1e9);
    requests.push({
      addSheet: {
        properties: { sheetId, title: TAB, index: 0, gridProperties: { frozenRowCount: 5 } },
      },
    });
  } else {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, index: 0, gridProperties: { frozenRowCount: 5 } },
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
  const scanArg = process.argv.find((a) => a.startsWith("--scan="));
  const scanPath = scanArg ? scanArg.slice("--scan=".length) : DEFAULT_SCAN;

  console.log("=== Shopee update plan → TellTea Sheet ===");
  const baseline = loadBaseline();
  const token = gcloudToken();
  const stockMap = await loadStockShopee(token);
  const liveMap = loadLiveScan(scanPath);
  console.log("Baseline:", baseline.length, "| Live scan:", liveMap.size, "| STOCK:", stockMap.size);

  const { rows, needChange, total } = buildRows(baseline, liveMap, stockMap);
  await pushTab(token, rows);

  console.log(`\nOK tab "${TAB}" — ${total} rows, ~${needChange} need change`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
  if (!liveMap.size) {
    console.log("\nTip: run `node scripts/shopee-chrome-scan.mjs` then re-run with --scan=...");
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
