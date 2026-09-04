#!/usr/bin/env node
/**
 * Push ★ Shopee price tracker — round-by-round verify columns for menu + options.
 *
 *   node scripts/push-shopee-price-tracker-to-sheet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { nextStepPrice, MAX_STEP_PCT, diffPct } from "./lib/shopee-price-step.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const TAB_MENU = "★ Shopee price tracker";
const TAB_OPTS = "★ Shopee price tracker — ตัวเลือก";
const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const PROMO = join(__dir, "data/menu-price-baseline/shopee-list-promo-scan.json");
const TRACKER = join(__dir, "data/menu-price-baseline/shopee-price-tracker.json");

function gcloudToken() {
  return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", { encoding: "utf8" }).trim();
}

async function sheetsFetch(sheetId, path, token, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
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

function loadTrackerMap() {
  if (!existsSync(TRACKER)) return new Map();
  const data = JSON.parse(readFileSync(TRACKER, "utf8"));
  return new Map(Object.entries(data.items || {}));
}

function lastRound(item) {
  const rounds = item?.rounds || [];
  return rounds.length ? rounds[rounds.length - 1] : null;
}

function buildMenuRows(baseline, liveMap, promoMap, trackerMap, globalRound) {
  const header = [
    "ลำดับ",
    "ชื่อเมนู Shopee",
    "รหัส Shopee",
    "ราคาเป้า (baseline)",
    "ราคา live ตอนนี้ (refresh)",
    "ราคาโปร ShopeeFood",
    "รอบถัดไปควรตั้ง",
    "ถึงเป้า?",
    "% ต่างจากเป้า",
    "รอบล่าสุด",
    "ก่อนปรับ",
    "พยายามตั้ง",
    "หลังบันทึก (ในรอบ)",
    "เปลี่ยนจริง? (live vs ก่อน)",
    "สถานะรอบล่าสุด",
    "popup / หมายเหตุ",
    "รอบที่เหลือ (ประมาณ)",
    "POS main name",
  ];

  const rows = [];
  let pending = 0;

  baseline.forEach((b, i) => {
    const live = liveMap.get(b.shopeeName);
    const promo = promoMap.get(b.shopeeName);
    const current = live?.listPrice ?? "";
    const promoPrice = promo?.promoPrice ?? live?.promoPrice ?? "";
    const target = b.targetPrice;
    const tr = trackerMap.get(b.shopeeCode) || trackerMap.get(b.shopeeName);
    const lr = lastRound(tr);
    const atTarget = current !== "" && current === target;
    if (!atTarget && current !== "") pending++;

    let nextApply = "";
    let stepsLeft = "";
    if (current !== "" && !atTarget) {
      const s = nextStepPrice(Number(current), target);
      nextApply = s.apply;
      stepsLeft = s.stepsRemaining;
    }

    const dp = current !== "" && target ? `${((diffPct(current, target) || 0) * 100).toFixed(1)}%` : "";
    let changed = "";
    if (lr && current !== "") {
      if (Number(current) === Number(lr.before)) changed = "ไม่";
      else if (Number(current) === Number(lr.attempted) || Number(current) === Number(lr.after))
        changed = "ใช่";
      else changed = `บางส่วน (${lr.before}→${current})`;
    }

    rows.push([
      i + 1,
      b.shopeeName,
      b.shopeeCode,
      target,
      current,
      promoPrice,
      nextApply,
      atTarget ? "ใช่" : current === "" ? "รอสแกน" : "ยัง",
      dp,
      lr?.round ?? globalRound ?? "",
      lr?.before ?? "",
      lr?.attempted ?? "",
      lr?.after ?? tr?.currentLive ?? "",
      changed,
      lr?.status ?? "",
      lr?.popupText ?? "",
      stepsLeft,
      b.mainName,
    ]);
  });

  const intro = [
    ["★ Shopee price tracker — เมนู (refresh หลังแต่ละรอบ apply)"],
    [
      `อัปเดต ${new Date().toISOString().slice(0, 16).replace("T", " ")} · เป้า baseline 15 ก.ค. · ค่อยๆ ปรับ ≤${MAX_STEP_PCT * 100}% ต่อครั้ง · รอบล่าสุด ${globalRound || 0}`,
    ],
    [`คงเหลือไม่ถึงเป้า: ${pending} · คำสั่ง: scan → batch-update --apply → push tracker`],
    [],
    header,
  ];

  return [...intro, ...rows];
}

async function fetchStockOptions(token) {
  const range = encodeURIComponent("'ตัวเลือก LINE MAN'!A1:Z80");
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const header = data.values?.[0] || [];
  const col = (n) => header.indexOf(n);
  const rows = [];
  for (const row of (data.values || []).slice(1)) {
    const name = (row[col("ชื่อตัวเลือก")] || "").trim();
    const shopeeCheck = row[col("ราคา Shopee ตอนเช็ค")] || "";
    if (!name || !shopeeCheck) continue;
    rows.push({
      name,
      target: Number(String(shopeeCheck).replace(/[^\d.-]/g, "")),
      store: row[col("ราคาหน้าร้าน")] || "",
      note: row[col("หมายเหตุ Shopee")] || "",
    });
  }
  return rows;
}

function buildOptionRows(stockOpts, liveMap) {
  const header = [
    "ลำดับ",
    "ชื่อตัวเลือก",
    "เป้า Shopee (STOCK เช็ค 17 ก.ค.)",
    "ราคา live (ถ้าเป็นเมนูแยก)",
    "Shopee menu?",
    "รอบถัดไปควรตั้ง",
    "ถึงเป้า?",
    "หมายเหตุ",
  ];
  const rows = [];

  stockOpts.forEach((o, i) => {
    const live = liveMap.get(o.name);
    const current = live?.listPrice ?? "";
    const isMenu = !!live;
    let nextApply = "";
    let atTarget = "";
    if (isMenu && current !== "") {
      const s = nextStepPrice(Number(current), o.target);
      nextApply = s.apply;
      atTarget = Number(current) === o.target ? "ใช่" : "ยัง";
    } else if (!isMenu) {
      atTarget = "N/A (modifier POS-only?)";
    }

    rows.push([
      i + 1,
      o.name,
      o.target,
      current,
      isMenu ? "เมนูแยก" : "ไม่พบใน scan",
      nextApply,
      atTarget,
      o.note,
    ]);
  });

  const intro = [
    ["★ Shopee price tracker — ตัวเลือก / ท็อป (STOCK baseline)"],
    ["ตัวเลือก modifier ส่วนใหญ่ไม่มีหน้า edit แยก — ท็อปที่เป็นเมนูแยก (ไข่มุก ฯลฯ) อยู่แท็บเมนู"],
    [],
    header,
  ];
  return [...intro, ...rows];
}

async function pushTabs(token, tabs) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  const requests = [];
  let idx = 0;

  for (const { title, rows } of tabs) {
    let sheetId = existing.get(title)?.sheetId;
    if (sheetId == null) {
      sheetId = Math.floor(Math.random() * 1e9);
      requests.push({
        addSheet: { properties: { sheetId, title, index: idx, gridProperties: { frozenRowCount: 4 } } },
      });
    } else {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, index: idx, gridProperties: { frozenRowCount: 4 } },
          fields: "index,gridProperties.frozenRowCount",
        },
      });
    }
    idx++;
    const endRow = rows.length;
    const endCol = Math.max(...rows.map((r) => r.length), 1);
    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: endCol },
        rows: rows.map((row) => ({ values: row.map((c) => cellValue(c)) })),
        fields: "userEnteredValue",
      },
    });
  }

  await sheetsFetch(TELLTEA_SHEET_ID, ":batchUpdate", token, { method: "POST", body: JSON.stringify({ requests }) });
}

async function main() {
  const baseline = parse(readFileSync(BASELINE), { columns: true, skip_empty_lines: true }).map((r) => ({
    shopeeName: r.shopeeName,
    shopeeCode: r.shopeeCode,
    targetPrice: Number(r.shopeePrice),
    mainName: r.mainName || "",
  }));
  const scan = existsSync(SCAN) ? JSON.parse(readFileSync(SCAN, "utf8")) : { items: [] };
  const liveMap = new Map((scan.items || []).map((i) => [i.name, i]));
  const promoMap = existsSync(PROMO)
    ? new Map(JSON.parse(readFileSync(PROMO, "utf8")).items.map((i) => [i.name, i]))
    : new Map();
  const tracker = loadTrackerMap();
  const globalRound = existsSync(TRACKER) ? JSON.parse(readFileSync(TRACKER, "utf8")).round : 0;

  const token = gcloudToken();
  const stockOpts = await fetchStockOptions(token);
  const menuRows = buildMenuRows(baseline, liveMap, promoMap, tracker, globalRound);
  const optRows = buildOptionRows(stockOpts, liveMap);

  await pushTabs(token, [
    { title: TAB_MENU, rows: menuRows },
    { title: TAB_OPTS, rows: optRows },
  ]);

  console.log(`OK "${TAB_MENU}" + "${TAB_OPTS}"`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
