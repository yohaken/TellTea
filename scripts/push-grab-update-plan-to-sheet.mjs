#!/usr/bin/env node
/**
 * Push ★ Grab update plan — live Grab vs Shopee baseline targets.
 *
 *   node scripts/push-grab-update-plan-to-sheet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadShopeeTargetsForGrab, matchGrabTarget } from "./lib/grab-targets.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const TAB = "★ Grab update plan";
const __dir = dirname(fileURLToPath(import.meta.url));
const SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");

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

async function main() {
  if (!existsSync(SCAN)) throw new Error(`Missing ${SCAN} — run grab-ingest-export.mjs`);
  const scan = JSON.parse(readFileSync(SCAN, "utf8"));
  const targets = loadShopeeTargetsForGrab();
  const token = gcloudToken();

  const header = [
    "ลำดับ",
    "ชื่อเมนู Grab",
    "ItemID",
    "ราคา live Grab",
    "ราคาเป้า (= Shopee baseline)",
    "ชื่อ Shopee ที่จับคู่",
    "ต้องแก้?",
    "ผลต่าง (live−เป้า)",
    "% ต่าง",
    "สถานะจำหน่าย",
    "หมวด",
  ];

  let need = 0;
  let unmatched = 0;
  const dataRows = [];

  (scan.items || []).forEach((it, i) => {
    const s = matchGrabTarget(it.name, targets);
    const live = it.listPrice ?? "";
    const target = s?.target ?? "";
    let must = "";
    let diff = "";
    let pct = "";
    if (live === "" || target === "") {
      must = target === "" ? "ไม่มีเป้า Shopee" : "ไม่มีราคา live";
      if (target === "") unmatched++;
    } else if (Number(live) !== Number(target)) {
      must = "ใช่";
      need++;
      diff = Number(live) - Number(target);
      pct = `${((Math.abs(diff) / Number(live)) * 100).toFixed(1)}%`;
    } else {
      must = "ไม่";
    }
    dataRows.push([
      i + 1,
      it.name,
      it.itemId,
      live,
      target,
      s?.shopeeName || "",
      must,
      diff,
      pct,
      it.status || "",
      it.category || "",
    ]);
  });

  dataRows.sort((a, b) => {
    const rank = (r) => (r[6] === "ใช่" ? 0 : r[6] === "ไม่มีเป้า Shopee" ? 1 : 2);
    return rank(a) - rank(b) || Math.abs(Number(b[7]) || 0) - Math.abs(Number(a[7]) || 0);
  });
  dataRows.forEach((r, i) => {
    r[0] = i + 1;
  });

  const intro = [
    ["★ Grab update plan — live Grab vs เป้า = ราคา Shopee baseline (15 ก.ค.)"],
    [
      `อัปเดต ${new Date().toISOString().slice(0, 16).replace("T", " ")} · items ${scan.items?.length || 0} · ต้องแก้ ${need} · ไม่มีเป้า ${unmatched} · ตั้งเป้าทีเดียว (ไม่มีขีด 15%)`,
    ],
    ["อัปเดตจริง: Chrome multi-tab — ยกราคา Shopee มาใส่ Grab"],
    [],
    header,
  ];

  await pushTab(token, TAB, [...intro, ...dataRows]);
  console.log(`=== Grab update plan → TellTea Sheet ===`);
  console.log(`OK tab "${TAB}" — ${dataRows.length} rows, ~${need} need change (target=Shopee)`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
