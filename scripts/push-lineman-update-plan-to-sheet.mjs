#!/usr/bin/env node
/**
 * Push ★ LINE MAN update plan — LM (STOCK/POS) vs เป้า = ราคา Shopee ที่วิเคราะห์.
 *
 *   node scripts/push-lineman-update-plan-to-sheet.mjs
 *
 * แหล่งราคา LM ปัจจุบัน: STOCK เทลทีราคา (ราคา LM ตอนเช็ค) + Firestore delivery
 * เป้า: Shopee baseline 15 ก.ค. (สูตรเดียวกับ Grab) · แสดง Shopee live เป็นอ้างอิง
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { loadShopeeTargetsForGrab, matchGrabTarget } from "./lib/grab-targets.mjs";
import { normName } from "./lib/grab-csv.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const TAB = "★ LINE MAN update plan";
const __dir = dirname(fileURLToPath(import.meta.url));
const LM_SCAN = join(__dir, "data/menu-price-baseline/lineman-stock-scan.json");
const SHOPEE_LIVE = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const POS_CSV = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");

function gcloudToken() {
  return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", { encoding: "utf8" }).trim();
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

function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

async function pushTab(token, title, rows) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  let sheetId = existing.get(title)?.sheetId;
  const requests = [];
  if (sheetId == null) {
    sheetId = Math.floor(Math.random() * 1e9);
    requests.push({
      addSheet: { properties: { sheetId, title, index: 0, gridProperties: { frozenRowCount: 4 } } },
    });
  } else {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, index: 0, gridProperties: { frozenRowCount: 4 } },
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

function loadPosDelivery() {
  if (!existsSync(POS_CSV)) return new Map();
  const rows = parse(readFileSync(POS_CSV), { columns: true, skip_empty_lines: true, relax_column_count: true });
  return new Map(
    rows.map((r) => [
      normName(r.name),
      { store: num(r.price), delivery: num(r.deliveryPrice), category: r.category || "", active: r.active, visible: r.visibleOnPos },
    ]),
  );
}

function loadShopeeLive() {
  if (!existsSync(SHOPEE_LIVE)) return new Map();
  const data = JSON.parse(readFileSync(SHOPEE_LIVE, "utf8"));
  return new Map((data.items || []).map((i) => [normName(i.name), i]));
}

async function main() {
  if (!existsSync(LM_SCAN)) throw new Error(`Missing ${LM_SCAN}`);
  const scan = JSON.parse(readFileSync(LM_SCAN, "utf8"));
  const targets = loadShopeeTargetsForGrab();
  const posMap = loadPosDelivery();
  const shopeeLive = loadShopeeLive();
  const token = gcloudToken();

  const header = [
    "ลำดับ",
    "ชื่อเมนู (POS/Main)",
    "ราคา LM ตอนเช็ค (STOCK)",
    "ราคาเดลิ POS (Firestore)",
    "ราคาเป้า (= Shopee baseline)",
    "Shopee live ตอนนี้",
    "ชื่อ Shopee ที่จับคู่",
    "ต้องแก้?",
    "ผลต่าง (LM−เป้า)",
    "% ต่าง",
    "เช็ค LM สถานะ",
    "เวลาเช็ค LM",
    "ต้องขายเดลิ (STOCK)",
    "หมายเหตุ",
  ];

  let need = 0;
  let unmatched = 0;
  let noLm = 0;
  const dataRows = [];
  const seenTarget = new Set();

  for (const it of scan.items || []) {
    const s =
      matchGrabTarget(it.name, targets) ||
      (it.shopeeName ? matchGrabTarget(it.shopeeName, targets) : null);
    if (!s) continue; // โฟกัสเมนูที่มีใน Shopee baseline ก่อน
    seenTarget.add(normName(s.shopeeName));

    const pos = posMap.get(normName(it.name)) || posMap.get(normName(s.mainName)) || posMap.get(normName(s.shopeeName));
    const liveLmRaw = it.listPrice ?? "";
    const liveLm = liveLmRaw !== "" && Number(liveLmRaw) > 0 ? liveLmRaw : "";
    const posDel = pos?.delivery ?? "";
    // STOCK บางแถวเป็น 0 = ว่าง → ใช้ POS เดลิเป็นราคาปัจจุบัน
    const current = liveLm !== "" ? liveLm : posDel !== "" && Number(posDel) > 0 ? posDel : "";
    const target = s.target;
    const sLive = shopeeLive.get(normName(s.shopeeName))?.listPrice ?? "";

    let must = "";
    let diff = "";
    let pct = "";
    if (current === "") {
      must = "ไม่มีราคา LM";
      noLm++;
    } else if (Number(current) !== Number(target)) {
      must = "ใช่";
      need++;
      diff = Number(current) - Number(target);
      pct = Number(current) > 0 ? `${((Math.abs(diff) / Number(current)) * 100).toFixed(1)}%` : "";
    } else {
      must = "ไม่";
    }

    const notes = [];
    if (liveLm !== "" && posDel !== "" && Number(liveLm) !== Number(posDel)) {
      notes.push(`STOCK LM≠POS เดลิ (${liveLm}≠${posDel})`);
    }
    if (sLive !== "" && Number(sLive) !== Number(target)) {
      notes.push(`Shopee live ยังไม่ถึงเป้า (${sLive})`);
    }
    if (it.lmNote) notes.push(String(it.lmNote).slice(0, 80));

    dataRows.push([
      0,
      it.name,
      liveLmRaw === "" ? "" : liveLmRaw,
      posDel,
      target,
      sLive,
      s.shopeeName,
      must,
      diff,
      pct,
      it.lmStatus || "",
      it.lmCheckedAt || "",
      it.delTarget ?? "",
      notes.join(" · "),
    ]);
  }

  // baseline items missing from STOCK scan
  for (const [key, s] of targets) {
    if (seenTarget.has(normName(s.shopeeName))) continue;
    if (key !== normName(s.shopeeName)) continue;
    unmatched++;
    const pos = posMap.get(normName(s.mainName)) || posMap.get(normName(s.shopeeName));
    const sLive = shopeeLive.get(normName(s.shopeeName))?.listPrice ?? "";
    dataRows.push([
      0,
      s.mainName || s.shopeeName,
      "",
      pos?.delivery ?? "",
      s.target,
      sLive,
      s.shopeeName,
      "ไม่มีใน STOCK LM",
      "",
      "",
      "",
      "",
      "",
      "มีใน Shopee baseline แต่ไม่พบใน STOCK เทลทีราคา",
    ]);
  }

  dataRows.sort((a, b) => {
    const rank = (r) => (r[7] === "ใช่" ? 0 : r[7] === "ไม่มีราคา LM" || r[7] === "ไม่มีใน STOCK LM" ? 1 : 2);
    return rank(a) - rank(b) || Math.abs(Number(b[8]) || 0) - Math.abs(Number(a[8]) || 0);
  });
  dataRows.forEach((r, i) => {
    r[0] = i + 1;
  });

  const intro = [
    ["★ LINE MAN update plan — วิเคราะห์เบื้องต้นก่อนอัปเดตที่ Wongnai Merchant"],
    [
      `อัปเดต ${new Date().toISOString().slice(0, 16).replace("T", " ")} · เมนูในแผน ${dataRows.length} · ต้องแก้ ${need} · ไม่มีราคา LM ${noLm} · ไม่มีใน STOCK ${unmatched}`,
    ],
    [
      "เป้า = ราคา Shopee baseline (15 ก.ค. — ชุดที่วิเคราะห์แล้ว) · ราคา LM จาก STOCK เช็ค ก.ค. (ยังไม่ใช่ live จาก merchant.wongnai.com) · อัปเดตจริงที่ https://merchant.wongnai.com/businesses/2688343/menu",
    ],
    [],
    header,
  ];

  await pushTab(token, TAB, [...intro, ...dataRows]);
  console.log(`=== LINE MAN update plan → TellTea Sheet ===`);
  console.log(`OK tab "${TAB}" — ${dataRows.length} rows, ~${need} need change (target=Shopee)`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
