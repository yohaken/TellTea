#!/usr/bin/env node
/**
 * Push ★ LINE MAN price tracker (+ options) — target = Shopee baseline.
 *
 *   node scripts/push-lineman-price-tracker-to-sheet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/grab-csv.mjs";
import { loadShopeeTargetsForGrab, matchGrabTarget } from "./lib/grab-targets.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const TAB_MENU = "★ LINE MAN price tracker";
const TAB_OPTS = "★ LINE MAN price tracker — ตัวเลือก";
const __dir = dirname(fileURLToPath(import.meta.url));
const LM_SCAN = join(__dir, "data/menu-price-baseline/lineman-stock-scan.json");
const LM_OPTS = join(__dir, "data/menu-price-baseline/lineman-stock-options.json");
const SHOPEE_LIVE = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const POS_CSV = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const TRACKER = join(__dir, "data/menu-price-baseline/lineman-price-tracker.json");

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

/** Parse price cells; STOCK often stores LM as "18/18" (สองช่องทาง) — อย่าตัด / แล้วต่อเลขเป็น 1818 */
function num(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  // "18/18" | "11 / 11" → ใช้ค่าแรก (หรือค่าเดียวถ้าเท่ากัน)
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => Number(String(p).replace(/[^\d.-]/g, "")));
    const valid = parts.filter((n) => Number.isFinite(n));
    if (!valid.length) return "";
    return valid[0];
  }
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

function lastRound(item) {
  const rounds = item?.rounds || [];
  return rounds.length ? rounds[rounds.length - 1] : null;
}

function loadPos() {
  if (!existsSync(POS_CSV)) return new Map();
  const rows = parse(readFileSync(POS_CSV), { columns: true, skip_empty_lines: true, relax_column_count: true });
  return new Map(rows.map((r) => [normName(r.name), { store: num(r.price), delivery: num(r.deliveryPrice) }]));
}

function loadShopeeLive() {
  if (!existsSync(SHOPEE_LIVE)) return new Map();
  const data = JSON.parse(readFileSync(SHOPEE_LIVE, "utf8"));
  return new Map((data.items || []).map((i) => [normName(i.name), i]));
}

async function fetchStockOptions(token) {
  if (existsSync(LM_OPTS)) {
    const data = JSON.parse(readFileSync(LM_OPTS, "utf8"));
    return (data.options || []).map((o) => ({
      name: o.name,
      group: "",
      target: o.shopeeCheck !== "" && o.shopeeCheck != null ? o.shopeeCheck : "",
      lmPrice: o.lmPrice ?? "",
      store: o.store ?? "",
      del: o.del ?? "",
      note: o.note || "เป้า Shopee จาก STOCK ตัวเลือก (ถ้ามี)",
      lmStatus: o.lmCheck || "",
    }));
  }
  const range = encodeURIComponent("'ตัวเลือก LINE MAN'!A1:Z120");
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const header = data.values?.[0] || [];
  const col = (n) => header.indexOf(n);
  const rows = [];
  for (const row of (data.values || []).slice(1)) {
    const name = (row[col("ชื่อตัวเลือก")] || "").trim();
    if (!name) continue;
    rows.push({
      name,
      group: "",
      target: num(row[col("ราคา Shopee ตอนเช็ค")]),
      lmPrice: num(row[col("ราคา LM ตอนเช็ค")]),
      store: num(row[col("ราคาหน้าร้าน")]),
      del: num(row[col("ราคาขายเดลิเวอรี่")]),
      note: "เป้า = Shopee ตอนเช็ค (ถ้ามี)",
      lmStatus: row[col("เช็ค LINE MAN")] || "",
    });
  }
  return rows;
}

function buildMenuRows(scan, targets, posMap, shopeeLive, trackerMap, globalRound) {
  const header = [
    "ลำดับ",
    "ชื่อเมนู LINE MAN / POS",
    "ราคาเป้า (= Shopee)",
    "ราคา LM ตอนเช็ค",
    "ราคาเดลิ POS",
    "Shopee live",
    "รอบถัดไปควรตั้ง",
    "ถึงเป้า?",
    "% ต่างจากเป้า",
    "รอบล่าสุด",
    "ก่อนปรับ",
    "พยายามตั้ง",
    "หลังบันทึก (ในรอบ)",
    "เปลี่ยนจริง?",
    "สถานะรอบล่าสุด",
    "popup / หมายเหตุ",
    "ชื่อ Shopee ที่จับคู่",
    "เวลาเช็ค LM",
  ];

  const rows = [];
  let pending = 0;

  const items = (scan.items || []).filter((it) => {
    const s = matchGrabTarget(it.name, targets) || (it.shopeeName ? matchGrabTarget(it.shopeeName, targets) : null);
    return !!s;
  });

  for (const [i, it] of items.entries()) {
    const s = matchGrabTarget(it.name, targets) || matchGrabTarget(it.shopeeName, targets);
    const pos = posMap.get(normName(it.name)) || posMap.get(normName(s?.mainName)) || posMap.get(normName(s?.shopeeName));
    const lmRaw = it.listPrice ?? "";
    const lmOk = lmRaw !== "" && Number(lmRaw) > 0 ? lmRaw : "";
    const posDel = pos?.delivery ?? "";
    const current = lmOk !== "" ? lmOk : posDel !== "" && Number(posDel) > 0 ? posDel : "";
    const target = s?.target ?? "";
    const sLive = s ? shopeeLive.get(normName(s.shopeeName))?.listPrice ?? "" : "";
    const tr = trackerMap.get(it.name);
    const lr = lastRound(tr);
    const atTarget = current !== "" && target !== "" && Number(current) === Number(target);
    if (!atTarget && current !== "" && target !== "") pending++;

    const nextApply = !atTarget && target !== "" ? target : "";
    const dp =
      current !== "" && target !== "" && Number(current) > 0
        ? `${((Math.abs(Number(current) - Number(target)) / Number(current)) * 100).toFixed(1)}%`
        : "";

    let changed = "";
    if (lr && current !== "") {
      if (Number(current) === Number(lr.before)) changed = "ไม่";
      else if (Number(current) === Number(lr.attempted) || Number(current) === Number(lr.after)) changed = "ใช่";
      else changed = `บางส่วน (${lr.before}→${current})`;
    }

    rows.push([
      i + 1,
      it.name,
      target,
      lmRaw === "" ? "" : lmRaw,
      posDel,
      sLive,
      nextApply,
      atTarget ? "ใช่" : target === "" ? "ไม่มีเป้า" : current === "" ? "รอเช็ค" : "ยัง",
      dp,
      lr?.round ?? globalRound ?? "",
      lr?.before ?? "",
      lr?.attempted ?? "",
      lr?.after ?? tr?.currentLive ?? "",
      changed,
      lr?.status ?? "",
      lr?.popupText ?? it.lmNote ?? "",
      s?.shopeeName || "",
      it.lmCheckedAt || "",
    ]);
  }

  const intro = [
    ["★ LINE MAN price tracker — เป้า = ราคา Shopee ที่วิเคราะห์ (baseline 15 ก.ค.)"],
    [
      `อัปเดต ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ยกราคา Shopee มาใส่ LINE MAN · ไม่มีขีด 15% · รอบล่าสุด ${globalRound || 0}`,
    ],
    [
      `คงเหลือไม่ถึงเป้า: ${pending} · แหล่ง LM: STOCK เทลทีราคา (เช็ค ก.ค.) · อัปเดตจริง: https://merchant.wongnai.com/businesses/2688343/menu`,
    ],
    [],
    header,
  ];
  return [...intro, ...rows];
}

function buildOptionRows(stockOpts) {
  const header = [
    "ลำดับ",
    "ชื่อตัวเลือก",
    "ราคา LM ตอนเช็ค",
    "เป้า Shopee",
    "ราคาหน้าร้าน",
    "ราคาเดลิ",
    "ถึงเป้า?",
    "สถานะเช็ค LM",
    "หมายเหตุ",
  ];
  const rows = [];

  stockOpts.forEach((o, i) => {
    const current = o.lmPrice !== "" ? o.lmPrice : o.del;
    let at = "";
    if (current !== "" && o.target !== "") at = Number(current) === Number(o.target) ? "ใช่" : "ยัง";
    else if (o.target === "") at = "ไม่มีเป้า Shopee";
    else at = "ไม่มีราคา LM";
    rows.push([i + 1, o.name, o.lmPrice, o.target, o.store, o.del, at, o.lmStatus, o.note]);
  });

  return [
    ["★ LINE MAN price tracker — ตัวเลือก"],
    ["รอบแรกโฟกัสราคาเมนู · ตัวเลือกจาก STOCK ตัวเลือก LINE MAN"],
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
  if (!existsSync(LM_SCAN)) throw new Error(`Missing ${LM_SCAN}`);
  const scan = JSON.parse(readFileSync(LM_SCAN, "utf8"));
  const trackerData = existsSync(TRACKER) ? JSON.parse(readFileSync(TRACKER, "utf8")) : { round: 0, items: {} };
  const trackerMap = new Map(Object.entries(trackerData.items || {}));
  const targets = loadShopeeTargetsForGrab();
  const token = gcloudToken();
  const stockOpts = await fetchStockOptions(token);
  const posMap = loadPos();
  const shopeeLive = loadShopeeLive();

  await pushTabs(token, [
    {
      title: TAB_MENU,
      rows: buildMenuRows(scan, targets, posMap, shopeeLive, trackerMap, trackerData.round || 0),
    },
    { title: TAB_OPTS, rows: buildOptionRows(stockOpts) },
  ]);

  console.log(`OK "${TAB_MENU}" + "${TAB_OPTS}"`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
