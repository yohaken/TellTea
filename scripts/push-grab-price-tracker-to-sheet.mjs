#!/usr/bin/env node
/**
 * Push ★ Grab price tracker (+ options) — target = Shopee baseline.
 *
 *   node scripts/push-grab-price-tracker-to-sheet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { normName } from "./lib/grab-csv.mjs";
import { loadShopeeTargetsForGrab, matchGrabTarget } from "./lib/grab-targets.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const TAB_MENU = "★ Grab price tracker";
const TAB_OPTS = "★ Grab price tracker — ตัวเลือก";
const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const TRACKER = join(__dir, "data/menu-price-baseline/grab-price-tracker.json");

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

function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

function lastRound(item) {
  const rounds = item?.rounds || [];
  return rounds.length ? rounds[rounds.length - 1] : null;
}

async function fetchStockOptions(token) {
  const range = encodeURIComponent("'ตัวเลือก LINE MAN'!A1:Z120");
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const header = data.values?.[0] || [];
  const col = (n) => header.indexOf(n);
  const rows = [];
  for (const row of (data.values || []).slice(1)) {
    const name = (row[col("ชื่อตัวเลือก")] || "").trim();
    if (!name) continue;
    const shopee = row[col("ราคา Shopee ตอนเช็ค")] || "";
    rows.push({
      name,
      group: row[col("กลุ่มตัวเลือก")] || row[col("ชื่อกลุ่ม")] || "",
      target: num(shopee),
      note: "เป้า = Shopee ตอนเช็ค (ถ้ามี)",
    });
  }
  return rows;
}

function buildMenuRows(scan, targets, trackerMap, globalRound) {
  const header = [
    "ลำดับ",
    "ชื่อเมนู Grab",
    "ItemID",
    "ราคาเป้า (= Shopee)",
    "ราคา live ตอนนี้ (refresh)",
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
    "ชื่อ Shopee ที่จับคู่",
  ];

  const rows = [];
  let pending = 0;

  for (const [i, it] of (scan.items || []).entries()) {
    const s = matchGrabTarget(it.name, targets);
    const current = it.listPrice ?? "";
    const target = s?.target ?? "";
    const tr = trackerMap.get(it.itemId) || trackerMap.get(it.name);
    const lr = lastRound(tr);
    const atTarget = current !== "" && target !== "" && Number(current) === Number(target);
    if (!atTarget && current !== "" && target !== "") pending++;

    const nextApply = !atTarget && target !== "" ? target : "";
    const dp =
      current !== "" && target !== ""
        ? `${((Math.abs(Number(current) - Number(target)) / Number(current)) * 100).toFixed(1)}%`
        : "";

    let changed = "";
    if (lr && current !== "") {
      if (Number(current) === Number(lr.before)) changed = "ไม่";
      else if (Number(current) === Number(lr.attempted) || Number(current) === Number(lr.after))
        changed = "ใช่";
      else changed = `บางส่วน (${lr.before}→${current})`;
    }

    rows.push([
      i + 1,
      it.name,
      it.itemId,
      target,
      current,
      nextApply,
      atTarget ? "ใช่" : target === "" ? "ไม่มีเป้า" : current === "" ? "รอสแกน" : "ยัง",
      dp,
      lr?.round ?? globalRound ?? "",
      lr?.before ?? "",
      lr?.attempted ?? "",
      lr?.after ?? tr?.currentLive ?? "",
      changed,
      lr?.status ?? "",
      lr?.popupText ?? "",
      s?.shopeeName || "",
    ]);
  }

  const intro = [
    ["★ Grab price tracker — เป้า = ราคา Shopee baseline"],
    [
      `อัปเดต ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ยกราคา Shopee มาใส่ Grab · ไม่มีขีด 15% · รอบล่าสุด ${globalRound || 0}`,
    ],
    [`คงเหลือไม่ถึงเป้า: ${pending}`],
    [],
    header,
  ];
  return [...intro, ...rows];
}

function buildOptionRows(scan, stockOpts) {
  const header = ["ลำดับ", "กลุ่ม", "ชื่อตัวเลือก", "ราคาใน Grab CSV", "เป้า Shopee", "ถึงเป้า?", "หมายเหตุ"];
  const byName = new Map((scan.options || []).map((o) => [normName(o.name), o]));
  const rows = [];
  const seen = new Set();

  stockOpts.forEach((o, i) => {
    const live = byName.get(normName(o.name));
    const current = live?.price ?? (live?.prices?.length === 1 ? live.prices[0] : live?.prices?.join("/") || "");
    seen.add(normName(o.name));
    let at = "";
    if (current !== "" && o.target !== "") at = Number(current) === Number(o.target) ? "ใช่" : "ยัง";
    else if (!live) at = "ไม่พบใน Grab CSV";
    rows.push([i + 1, o.group, o.name, current, o.target, at, o.note]);
  });

  let extra = rows.length;
  for (const o of scan.options || []) {
    if (seen.has(normName(o.name))) continue;
    extra++;
    rows.push([extra, o.group, o.name, o.price ?? o.prices?.join("/") ?? "", "", "ไม่มีเป้า", "จาก Grab OptionGroup"]);
  }

  return [
    ["★ Grab price tracker — ตัวเลือก"],
    ["รอบแรกโฟกัสราคาเมนู"],
    [],
    header,
    ...rows,
  ];
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
  await sheetsFetch(TELLTEA_SHEET_ID, ":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function main() {
  if (!existsSync(SCAN)) throw new Error(`Missing ${SCAN}`);
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const trackerData = existsSync(TRACKER) ? JSON.parse(readFileSync(TRACKER, "utf8")) : { round: 0, items: {} };
  const trackerMap = new Map(Object.entries(trackerData.items || {}));
  const targets = loadShopeeTargetsForGrab();
  const token = gcloudToken();
  const stockOpts = await fetchStockOptions(token);

  await pushTabs(token, [
    { title: TAB_MENU, rows: buildMenuRows(scan, targets, trackerMap, trackerData.round || 0) },
    { title: TAB_OPTS, rows: buildOptionRows(scan, stockOpts) },
  ]);

  console.log(`OK "${TAB_MENU}" + "${TAB_OPTS}"`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
