#!/usr/bin/env node
/**
 * One sheet: ★ Name sync — เมนู+ตัวเลือก ทุกช่องทาง
 * POS (หน้าร้าน) = source of truth. Compare Grab / Shopee / LINE MAN names.
 * Deletes old split name-diff tabs.
 *
 *   node scripts/push-name-sync-to-sheet.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/grab-csv.mjs";
import { isStoreOnlyName } from "./lib/name-sync-match.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const TAB = "★ Name sync — เมนู+ตัวเลือก";
const DELETE_TABS = [
  "★ Name sync — เมนู",
  "★ Name sync — Grab→POS rename",
  "★ Name sync — ตัวเลือก",
  "★ LINE MAN vs POS diff",
  "★ Shopee vs POS diff",
  "★ Shopee vs POS diff — ตัวเลือก",
];

const __dir = dirname(fileURLToPath(import.meta.url));
const POS_MENU = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const POS_OPTS = join(__dir, "data/menu-price-baseline/telltea-option-prices-snapshot-2026-09-01.csv");
const GRAB_SCAN = join(__dir, "data/menu-price-baseline/grab-live-scan.json");
const SHOPEE_SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const SHOPEE_OPTS = join(__dir, "data/menu-price-baseline/shopee-live-options.json");
const LM_SCAN = join(__dir, "data/menu-price-baseline/lineman-live-scan.json");
const LM_OPTS = join(__dir, "data/menu-price-baseline/lineman-stock-options.json");
const LM_OPTS_LIVE = join(__dir, "data/menu-price-baseline/lineman-live-options.json");
const OUT_JSON = join(__dir, "data/menu-price-baseline/name-sync-sheet-snapshot.json");

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
  const v = field(row, "active");
  return v === true || v === "true";
}

function statusName(posName, channelName) {
  if (!channelName) return "ไม่มี";
  if (normName(channelName) === normName(posName)) return "ตรง";
  return "ต่าง";
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function loadPosMenus() {
  const rows = parse(readFileSync(POS_MENU), { columns: true, skip_empty_lines: true, bom: true });
  return rows
    .map((r) => ({
      id: String(field(r, "id") || ""),
      name: String(field(r, "name") || "").trim(),
      category: String(field(r, "category") || "").trim(),
      active: isActive(r),
      storeOnly: isStoreOnlyName(field(r, "name")),
    }))
    .filter((r) => r.name && !/\[QA-TEST\]/i.test(r.name));
}

function loadPosOptions() {
  const rows = parse(readFileSync(POS_OPTS), { columns: true, skip_empty_lines: true, bom: true });
  return rows
    .map((r) => ({
      group: String(field(r, "group") || "").trim(),
      name: String(field(r, "option") || "").trim(),
      active: isActive(r),
    }))
    .filter((r) => r.name && !/\[QA-TEST\]/i.test(r.group) && !/\[QA-TEST\]/i.test(r.name));
}

function channelByNorm(items, nameKey = "name") {
  const map = new Map();
  for (const it of items || []) {
    const name = String(it[nameKey] || it.name || "").trim();
    if (!name) continue;
    map.set(normName(name), { ...it, name });
  }
  return map;
}

function pickChannel(map, posName) {
  const hit = map.get(normName(posName));
  if (!hit) return { name: "", status: "ไม่มี" };
  return { name: hit.name, status: statusName(posName, hit.name) };
}

function buildUnifiedRows(posMenus, posOpts, channels) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const deliveryMenus = posMenus.filter((p) => p.active && !p.storeOnly);
  const storeOnly = posMenus.filter((p) => p.storeOnly);

  const grabM = channelByNorm(channels.grabMenus);
  const shopeeM = channelByNorm(channels.shopeeMenus);
  const lmM = channelByNorm(channels.lmMenus);
  const grabO = channelByNorm(channels.grabOptions);
  const shopeeO = channelByNorm(channels.shopeeOptions);
  const lmO = channelByNorm(channels.lmOptions);

  let mGrab = 0,
    mShopee = 0,
    mLm = 0,
    oGrab = 0,
    oShopee = 0,
    oLm = 0;

  const header = [
    "ประเภท",
    "ลำดับ",
    "กลุ่ม / หมวด POS",
    "ชื่อ POS (หน้าร้าน)",
    "ชื่อ Grab",
    "สถานะ Grab",
    "ชื่อ Shopee",
    "สถานะ Shopee",
    "ชื่อ LINE MAN",
    "สถานะ LM",
    "หมายเหตุ",
  ];

  const rows = [
    ["★ Name sync — เมนู + ตัวเลือก · ทุกช่องทางเดลิเวอรี่ (เป้า = ชื่อหน้าร้าน POS)"],
    [
      `อัปเดต ${stamp} · POS เมนูโฟกัส ${deliveryMenus.length} · ตัวเลือก ${posOpts.length} · ตัดเฉพาะหน้าร้าน ${storeOnly.length}`,
    ],
    ["นโยบาย: ชื่อทุกช่องทางต้องเหมือน POS · เฉพาะหน้าร้าน / น้ำเปล่า ไม่ขายเดลิเวอรี่"],
    [],
    header,
  ];

  // —— MENUS ——
  let i = 0;
  for (const p of deliveryMenus.sort(
    (a, b) => a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th"),
  )) {
    i++;
    const g = pickChannel(grabM, p.name);
    const s = pickChannel(shopeeM, p.name);
    const l = pickChannel(lmM, p.name);
    if (g.status === "ตรง") mGrab++;
    if (s.status === "ตรง") mShopee++;
    if (l.status === "ตรง") mLm++;
    const notes = [];
    if (g.status !== "ตรง") notes.push(`Grab:${g.status}`);
    if (s.status !== "ตรง") notes.push(`Shopee:${s.status}`);
    if (l.status !== "ตรง") notes.push(`LM:${l.status}`);
    rows.push([
      "เมนู",
      i,
      p.category,
      p.name,
      g.name,
      g.status,
      s.name,
      s.status,
      l.name,
      l.status,
      notes.join(" · "),
    ]);
  }

  // channel extras (menus)
  const usedMenu = new Set(deliveryMenus.map((p) => normName(p.name)));
  const extras = [];
  for (const [label, map] of [
    ["Grab", grabM],
    ["Shopee", shopeeM],
    ["LINE MAN", lmM],
  ]) {
    for (const [n, it] of map) {
      if (usedMenu.has(n)) continue;
      if (/น้ำเปล่า/.test(it.name) || isStoreOnlyName(it.name)) {
        extras.push([label, it.name, "เฉพาะหน้าร้าน / ไม่ขายเดลิ"]);
      } else {
        extras.push([label, it.name, "ยังไม่จับคู่ POS"]);
      }
    }
  }
  if (extras.length) {
    rows.push([]);
    rows.push(["—", "", "เมนูบนช่องทางที่ยังไม่จับคู่ POS / นโยบายพิเศษ", "", "", "", "", "", "", "", ""]);
    extras
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], "th"))
      .forEach((e, idx) => {
        rows.push(["เมนูนอก", idx + 1, e[0], "", e[0] === "Grab" ? e[1] : "", "", e[0] === "Shopee" ? e[1] : "", "", e[0] === "LINE MAN" ? e[1] : "", "", e[2]]);
      });
  }

  // —— OPTIONS ——
  rows.push([]);
  rows.push(["── ตัวเลือก (POS เป็นหลัก) ──", "", "", "", "", "", "", "", "", "", ""]);
  rows.push(header);
  i = 0;
  for (const p of posOpts.sort(
    (a, b) => a.group.localeCompare(b.group, "th") || a.name.localeCompare(b.name, "th"),
  )) {
    i++;
    const g = pickChannel(grabO, p.name);
    const s = pickChannel(shopeeO, p.name);
    const l = pickChannel(lmO, p.name);
    if (g.status === "ตรง") oGrab++;
    if (s.status === "ตรง") oShopee++;
    if (l.status === "ตรง") oLm++;
    const notes = [];
    if (g.status !== "ตรง") notes.push(`Grab:${g.status}`);
    if (s.status !== "ตรง") notes.push(`Shopee:${s.status}`);
    if (l.status !== "ตรง") notes.push(`LM:${l.status}`);
    rows.push([
      "ตัวเลือก",
      i,
      p.group,
      p.name,
      g.name,
      g.status,
      s.name,
      s.status,
      l.name,
      l.status,
      notes.join(" · "),
    ]);
  }

  const usedOpt = new Set(posOpts.map((p) => normName(p.name)));
  const optExtras = [];
  for (const [label, map] of [
    ["Grab", grabO],
    ["Shopee", shopeeO],
    ["LINE MAN", lmO],
  ]) {
    for (const [n, it] of map) {
      if (usedOpt.has(n)) continue;
      optExtras.push([label, it.name, it.group || ""]);
    }
  }
  if (optExtras.length) {
    rows.push([]);
    rows.push(["—", "", "ตัวเลือกบนช่องทางที่ยังไม่จับคู่ POS", "", "", "", "", "", "", "", ""]);
    optExtras
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], "th"))
      .forEach((e, idx) => {
        rows.push([
          "ตัวเลือกนอก",
          idx + 1,
          `${e[0]}${e[2] ? ` · ${e[2]}` : ""}`,
          "",
          e[0] === "Grab" ? e[1] : "",
          "",
          e[0] === "Shopee" ? e[1] : "",
          "",
          e[0] === "LINE MAN" ? e[1] : "",
          "",
          "ยังไม่จับคู่ POS",
        ]);
      });
  }

  // summary line under title
  rows[1] = [
    `อัปเดต ${stamp} · เมนูตรง Grab ${mGrab}/${deliveryMenus.length} · Shopee ${mShopee}/${deliveryMenus.length} · LM ${mLm}/${deliveryMenus.length} · ตัวเลือกตรง Grab ${oGrab}/${posOpts.length} · Shopee ${oShopee}/${posOpts.length} · LM ${oLm}/${posOpts.length}`,
  ];

  return {
    rows,
    stats: {
      menus: deliveryMenus.length,
      options: posOpts.length,
      mGrab,
      mShopee,
      mLm,
      oGrab,
      oShopee,
      oLm,
      menuExtras: extras.length,
      optExtras: optExtras.length,
    },
  };
}

async function pushUnified(token, rows) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  const requests = [];

  for (const title of DELETE_TABS) {
    const sheetId = existing.get(title)?.sheetId;
    if (sheetId != null) {
      requests.push({ deleteSheet: { sheetId } });
      existing.delete(title);
    }
  }

  let sheetId = existing.get(TAB)?.sheetId;
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
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 15,
        },
        rows: [],
        fields: "userEnteredValue",
      },
    });
  }

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
      rows: rows.map((row) => ({ values: row.map((c) => cellValue(c)) })),
      fields: "userEnteredValue",
    },
  });

  await sheetsFetch(TELLTEA_SHEET_ID, ":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  return DELETE_TABS.filter((t) => meta.sheets?.some((s) => s.properties.title === t));
}

async function main() {
  if (!existsSync(POS_MENU)) throw new Error(`Missing ${POS_MENU}`);
  if (!existsSync(POS_OPTS)) throw new Error(`Missing ${POS_OPTS}`);

  const posMenus = loadPosMenus();
  const posOpts = loadPosOptions();

  const grabScan = loadJson(GRAB_SCAN, { items: [], options: [] });
  const shopeeScan = loadJson(SHOPEE_SCAN, { items: [] });
  const shopeeOpts = loadJson(SHOPEE_OPTS, { options: [] });
  const lmScan = loadJson(LM_SCAN, { items: [] });
  const lmOptsLive = loadJson(LM_OPTS_LIVE, { options: [] });
  const lmOptsStock = loadJson(LM_OPTS, { options: [] });
  const lmOptions =
    Array.isArray(lmOptsLive.options) && lmOptsLive.options.length > 10
      ? lmOptsLive.options
      : lmOptsStock.options || [];

  const built = buildUnifiedRows(posMenus, posOpts, {
    grabMenus: grabScan.items || [],
    shopeeMenus: shopeeScan.items || [],
    lmMenus: lmScan.items || [],
    grabOptions: grabScan.options || [],
    shopeeOptions: shopeeOpts.options || [],
    lmOptions,
  });

  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        tab: TAB,
        stats: built.stats,
        sources: {
          grabMenus: (grabScan.items || []).length,
          shopeeMenus: (shopeeScan.items || []).length,
          lmMenus: (lmScan.items || []).length,
          grabOptions: (grabScan.options || []).length,
          shopeeOptions: (shopeeOpts.options || []).length,
          lmOptions: lmOptions.length,
        },
      },
      null,
      2,
    ) + "\n",
  );

  const token = gcloudToken();
  const deleted = await pushUnified(token, built.rows);

  console.log(`OK tab "${TAB}"`);
  console.log(
    `  เมนูตรง Grab ${built.stats.mGrab}/${built.stats.menus} · Shopee ${built.stats.mShopee}/${built.stats.menus} · LM ${built.stats.mLm}/${built.stats.menus}`,
  );
  console.log(
    `  ตัวเลือกตรง Grab ${built.stats.oGrab}/${built.stats.options} · Shopee ${built.stats.oShopee}/${built.stats.options} · LM ${built.stats.oLm}/${built.stats.options}`,
  );
  if (deleted.length) console.log(`  ลบแท็บเก่า: ${deleted.join(", ")}`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
