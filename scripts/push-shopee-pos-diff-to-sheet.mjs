#!/usr/bin/env node
/**
 * Push Shopee vs POS menu diff to TellTea Google Sheet.
 *
 *   node scripts/push-shopee-pos-diff-to-sheet.mjs [--scan path.json] [--pos path.csv]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import { normName } from "./lib/shopee-chrome.mjs";

const TELLTEA_SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const STOCK_SHEET_ID = "1K1cihkLGbhBTwVhuLJdhaWAjPPrmbiHSiOcmF8R5HxY";
const TAB = "★ Shopee vs POS diff";
const TAB_OPTS = "★ Shopee vs POS diff — ตัวเลือก";
const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE_CSV = join(__dir, "data/menu-price-baseline/shopee-baseline-2026-07-15.csv");
const DEFAULT_SCAN = join(__dir, "data/menu-price-baseline/shopee-live-scan.json");
const DEFAULT_POS = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const DEFAULT_POS_OPTS = join(__dir, "data/menu-price-baseline/telltea-option-prices-snapshot-2026-09-01.csv");

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

function posField(row, key) {
  return row[key] || row[`\ufeff${key}`] || "";
}

function posCategory(row) {
  return posField(row, "category");
}

function isActive(row) {
  return row.active === "true" || row.active === true;
}

function loadData(scanPath, posPath) {
  const baseline = parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true });
  const pos = parse(readFileSync(posPath), { columns: true, skip_empty_lines: true });
  const live = JSON.parse(readFileSync(scanPath));

  const shopeeSet = new Set(live.items.map((i) => normName(i.name)));
  const posByNorm = new Map(pos.map((p) => [normName(p.name), p]));

  function inPos(name) {
    const n = normName(name);
    if (posByNorm.has(n)) return true;
    const b = baseline.find((x) => normName(x.shopeeName) === n);
    if (b && posByNorm.has(normName(b.mainName))) return true;
    return false;
  }

  function onShopee(name) {
    const n = normName(name);
    if (shopeeSet.has(n)) return true;
    return baseline.some((b) => normName(b.mainName) === n || normName(b.shopeeName) === n);
  }

  const aliases = baseline
    .filter((b) => normName(b.shopeeName) !== normName(b.mainName))
    .map((b) => {
      const posItem = posByNorm.get(normName(b.mainName)) || posByNorm.get(normName(b.shopeeName));
      return {
        shopeeName: b.shopeeName,
        posName: posItem?.name || b.mainName,
        category: b.shopeeCategory,
        shopeeCode: b.shopeeCode,
        posActive: posItem ? isActive(posItem) : "",
      };
    });

  const shopeeOnly = live.items.filter((i) => !inPos(i.name));

  const posOnlyActive = pos
    .filter((p) => isActive(p) && !onShopee(p.name))
    .map((p) => ({
      name: p.name,
      category: posCategory(p),
      price: p.price,
      deliveryPrice: p.deliveryPrice,
      id: p.id,
    }));

  const posOnlyInactive = pos
    .filter((p) => !isActive(p) && !onShopee(p.name))
    .map((p) => ({
      name: p.name,
      category: posCategory(p),
      price: p.price,
      id: p.id,
    }));

  const matchedExact = baseline.filter((b) => posByNorm.has(normName(b.shopeeName))).length;
  const matchedViaMain = baseline.filter(
    (b) => !posByNorm.has(normName(b.shopeeName)) && posByNorm.has(normName(b.mainName)),
  ).length;

  return {
    shopeeCount: live.items.length,
    posActiveCount: pos.filter(isActive).length,
    posTotal: pos.length,
    matchedExact,
    matchedViaMain,
    aliases,
    shopeeOnly,
    posOnlyActive,
    posOnlyInactive,
  };
}

function buildRows(data) {
  const rows = [];
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");

  rows.push(["★ Shopee vs POS — เมนูที่ไม่ตรงกัน"]);
  rows.push([
    `อัปเดต ${now} · Shopee live ${data.shopeeCount} · POS active ${data.posActiveCount} · ตรงกัน ${data.matchedExact + data.matchedViaMain} (${data.matchedExact} ชื่อตรง + ${data.matchedViaMain} ชื่อต่าง)`,
  ]);
  rows.push([]);

  rows.push(["── Shopee มี แต่ POS ไม่มี (ชื่อตรง) ──", data.shopeeOnly.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ Shopee", "ราคา Shopee", "dish ID", "หมายเหตุ"]);
  if (data.shopeeOnly.length === 0) {
    rows.push(["", "(ไม่มี — ทุกเมนู Shopee match POS ได้)", "", "", ""]);
  } else {
    data.shopeeOnly.forEach((i, n) => {
      rows.push([n + 1, i.name, i.listPrice, i.dishId, ""]);
    });
  }
  rows.push([]);

  rows.push([
    "── ชื่อต่าง Shopee ↔ POS (เป็นตัวเดียวกัน) ──",
    data.aliases.length,
    "คู่",
  ]);
  rows.push(["ลำดับ", "ชื่อ Shopee", "ชื่อ POS", "หมวด Shopee", "รหัส Shopee", "POS active?"]);
  data.aliases.forEach((a, n) => {
    rows.push([n + 1, a.shopeeName, a.posName, a.category, a.shopeeCode, a.posActive ? "ใช่" : "ไม่"]);
  });
  rows.push([]);

  rows.push(["── POS มี แต่ Shopee ไม่มี (active) ──", data.posOnlyActive.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ POS", "หมวด", "ราคาหน้าร้าน", "ราคา delivery", "Firestore ID", "แนะนำ"]);
  data.posOnlyActive.forEach((p, n) => {
    let hint = "";
    if (p.category.includes("0% แคล")) hint = "พิจารณาขึ้น Shopee";
    else if (p.category.includes("ฟิวชัน")) hint = "POS-only fusion — Shopee มีแค่บางรส";
    else if (p.category.includes("ร้อน")) hint = "POS-only ร้อน — Shopee มีแค่พื้นฐาน";
    else if (p.category.includes("ไอศครีม")) hint = "Shopee มี Ice Cream To-Go 16oz แทน";
    rows.push([n + 1, p.name, p.category, p.price, p.deliveryPrice, p.id, hint]);
  });
  rows.push([]);

  rows.push(["── POS inactive ไม่ได้ขึ้น Shopee ──", data.posOnlyInactive.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อ POS", "หมวด", "ราคา", "Firestore ID", "หมายเหตุ"]);
  data.posOnlyInactive.forEach((p, n) => {
    let note = "";
    if (p.name.startsWith("[QA-TEST]") || p.name.startsWith("เทส")) note = "ทดสอบ";
    else if (p.category.includes("FoodStory")) note = "legacy/inactive";
    rows.push([n + 1, p.name, p.category, p.price, p.id, note]);
  });

  return rows;
}

async function fetchStockOptions(token) {
  const range = encodeURIComponent("'ตัวเลือก LINE MAN'!A1:Z80");
  const data = await sheetsFetch(STOCK_SHEET_ID, `/values/${range}`, token);
  const rows = data.values || [];
  const header = rows[0] || [];
  const col = (name) => header.indexOf(name);
  const opts = [];
  for (const row of rows.slice(1)) {
    const name = (row[col("ชื่อตัวเลือก")] || "").trim();
    if (!name) continue;
    opts.push({
      name,
      shopeeCheck: row[col("ราคา Shopee ตอนเช็ค")] || "",
      store: row[col("ราคาหน้าร้าน")] || "",
      delivery: row[col("ราคาขายเดลิเวอรี่")] || "",
      grabCheck: row[col("ราคา Grab ตอนเช็ค")] || "",
      note: row[col("หมายเหตุ Shopee")] || "",
    });
  }
  return opts;
}

/** Shopee menus that act as paid add-ons (not POS option groups). */
const TOPPING_MENU_HINTS = [
  "ไข่มุก",
  "เจลลี่",
  "เฉาก๊วย",
  "บุก",
  "ซอส",
  "ครีม",
  "วุ้น",
  "น้ำเปล่า",
];

function isToppingMenu(name, category) {
  const n = normName(name);
  if ((category || "").includes("ท็อป") || (category || "").includes("เพิ่ม")) return true;
  return TOPPING_MENU_HINTS.some((h) => n.includes(normName(h)));
}

function loadOptionData(scanPath, posOptsPath, stockOpts) {
  const baseline = parse(readFileSync(BASELINE_CSV), { columns: true, skip_empty_lines: true });
  const live = JSON.parse(readFileSync(scanPath));
  const posOpts = parse(readFileSync(posOptsPath), { columns: true, skip_empty_lines: true });

  const shopeeMenuByNorm = new Map(
    live.items.map((i) => [normName(i.name), { name: i.name, price: i.listPrice, dishId: i.dishId }]),
  );
  const stockByNorm = new Map(stockOpts.map((o) => [normName(o.name), o]));
  const posActive = posOpts.filter((o) => posField(o, "active") === "true");

  const toppingMenus = live.items.filter((i) => {
    const b = baseline.find((x) => x.shopeeCode === i.dishId);
    return isToppingMenu(i.name, b?.shopeeCategory);
  });

  function onShopeeOption(optionName) {
    const n = normName(optionName);
    if (shopeeMenuByNorm.has(n)) return { via: "เมนูแยก", ...shopeeMenuByNorm.get(n) };
    const b = baseline.find((x) => normName(x.mainName) === n || normName(x.shopeeName) === n);
    if (b && shopeeMenuByNorm.has(normName(b.shopeeName))) {
      return { via: "เมนูแยก", ...shopeeMenuByNorm.get(normName(b.shopeeName)) };
    }
    if (stockByNorm.has(n) && stockByNorm.get(n).shopeeCheck) {
      return { via: "STOCK Shopee", shopeePrice: stockByNorm.get(n).shopeeCheck };
    }
    return null;
  }

  const matched = [];
  const posOnly = [];
  const nameDiff = [];

  for (const o of posActive) {
    const group = posField(o, "group");
    const option = posField(o, "option");
    if (option.startsWith("[QA-TEST]")) continue;

    const hit = onShopeeOption(option);
    if (!hit) {
      posOnly.push({
        group,
        option,
        priceDelta: posField(o, "priceDelta"),
        deliveryDelta: posField(o, "deliveryPriceDelta"),
        kind: group.includes("โปร") ? "โปรโมชั่น" : "modifier POS",
      });
      continue;
    }

    const shopeeName = hit.name || option;
    if (hit.via === "เมนูแยก" && normName(shopeeName) !== normName(option)) {
      nameDiff.push({
        group,
        posOption: option,
        shopeeName,
        via: hit.via,
        posDelta: posField(o, "deliveryPriceDelta"),
        shopeePrice: hit.price,
        dishId: hit.dishId,
      });
    } else {
      matched.push({
        group,
        option,
        via: hit.via,
        posDelta: posField(o, "deliveryPriceDelta"),
        shopeePrice: hit.price ?? hit.shopeePrice,
        dishId: hit.dishId || "",
      });
    }
  }

  const posOptionNorm = new Set(posActive.map((o) => normName(posField(o, "option"))));
  const shopeeToppingOnly = toppingMenus
    .filter((m) => !posOptionNorm.has(normName(m.name)))
    .map((m) => ({
      name: m.name,
      price: m.listPrice,
      dishId: m.dishId,
    }));

  const groups = [...new Set(posActive.map((o) => posField(o, "group")).filter(Boolean))];

  return {
    posActiveCount: posActive.length,
    groupCount: groups.length,
    stockWithShopee: stockOpts.filter((o) => o.shopeeCheck).length,
    matched,
    nameDiff,
    posOnly,
    shopeeToppingOnly,
    toppingMenuCount: toppingMenus.length,
  };
}

function buildOptionRows(data) {
  const rows = [];
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");

  rows.push(["★ Shopee vs POS — กลุ่มตัวเลือก / ท็อปปิ้ง"]);
  rows.push([
    `อัปเดต ${now} · POS active ${data.posActiveCount} ตัวเลือก / ${data.groupCount} กลุ่ม · Shopee topping เมนู ${data.toppingMenuCount} · STOCK มีราคา Shopee ${data.stockWithShopee}`,
  ]);
  rows.push([
    "หมายเหตุ: Shopee ไม่มีกลุ่มตัวเลือกแบบ POS — ท็อปปิ้งบางอย่างเป็นเมนูแยก · modifier (ความหวาน/ปั่น) มัก POS-only",
  ]);
  rows.push([]);

  rows.push(["── ตรงกัน (POS option ↔ Shopee) ──", data.matched.length, "รายการ"]);
  rows.push(["ลำดับ", "กลุ่ม POS", "ชื่อตัวเลือก", "ช่องทาง Shopee", "POS delivery +฿", "ราคา Shopee", "dish ID"]);
  data.matched.forEach((m, n) => {
    rows.push([n + 1, m.group, m.option, m.via, m.posDelta, m.shopeePrice, m.dishId]);
  });
  rows.push([]);

  rows.push(["── ชื่อต่าง (ตัวเลือก/ท็อป ↔ เมนู Shopee) ──", data.nameDiff.length, "คู่"]);
  rows.push(["ลำดับ", "กลุ่ม POS", "ชื่อ POS", "ชื่อ Shopee", "POS delivery +฿", "ราคา Shopee", "dish ID"]);
  data.nameDiff.forEach((m, n) => {
    rows.push([n + 1, m.group, m.posOption, m.shopeeName, m.posDelta, m.shopeePrice, m.dishId]);
  });
  rows.push([]);

  rows.push(["── POS มี แต่ Shopee ไม่มี (ตัวเลือก) ──", data.posOnly.length, "รายการ"]);
  rows.push(["ลำดับ", "กลุ่ม POS", "ชื่อตัวเลือก", "POS delivery +฿", "ประเภท", "หมายเหตุ"]);
  data.posOnly.forEach((p, n) => {
    let note = "";
    if (p.group.includes("ความหวาน") || p.group.includes("ประเภท") || p.group.includes("ขนาด")) {
      note = "modifier ใน POS — Shopee ไม่มีกลุ่มนี้";
    } else if (p.group.includes("โปร")) note = "โปร POS-only";
    rows.push([n + 1, p.group, p.option, p.deliveryDelta, p.kind, note]);
  });
  rows.push([]);

  rows.push(["── Shopee มี (เมนูท็อป) แต่ POS ไม่มีในตัวเลือก ──", data.shopeeToppingOnly.length, "รายการ"]);
  rows.push(["ลำดับ", "ชื่อเมนู Shopee", "ราคา Shopee", "dish ID", "หมายเหตุ"]);
  data.shopeeToppingOnly.forEach((m, n) => {
    rows.push([n + 1, m.name, m.price, m.dishId, "ขายเป็นเมนูแยกบน Shopee"]);
  });

  return rows;
}

async function pushTabs(token, tabs) {
  const meta = await sheetsFetch(TELLTEA_SHEET_ID, "?fields=sheets(properties(sheetId,title,index))", token);
  const existing = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));
  const requests = [];

  let insertIndex = 1;
  for (const { title, rows } of tabs) {
    let sheetId = existing.get(title)?.sheetId;
    if (sheetId == null) {
      sheetId = Math.floor(Math.random() * 1e9);
      requests.push({
        addSheet: {
          properties: { sheetId, title, index: insertIndex, gridProperties: { frozenRowCount: 4 } },
        },
      });
      existing.set(title, { sheetId });
    } else {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, index: insertIndex, gridProperties: { frozenRowCount: 4 } },
          fields: "index,gridProperties.frozenRowCount",
        },
      });
    }
    insertIndex++;

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

async function pushTab(token, rows) {
  await pushTabs(token, [{ title: TAB, rows }]);
}

async function main() {
  const scanArg = process.argv.find((a) => a.startsWith("--scan="));
  const posArg = process.argv.find((a) => a.startsWith("--pos="));
  const posOptsArg = process.argv.find((a) => a.startsWith("--pos-opts="));
  const scanPath = scanArg ? scanArg.slice("--scan=".length) : DEFAULT_SCAN;
  const posPath = posArg ? posArg.slice("--pos=".length) : DEFAULT_POS;
  const posOptsPath = posOptsArg ? posOptsArg.slice("--pos-opts=".length) : DEFAULT_POS_OPTS;

  console.log("=== Shopee vs POS diff → TellTea Sheet ===");
  const data = loadData(scanPath, posPath);
  const menuRows = buildRows(data);
  const token = gcloudToken();
  const stockOpts = await fetchStockOptions(token);
  const optData = loadOptionData(scanPath, posOptsPath, stockOpts);
  const optRows = buildOptionRows(optData);

  await pushTabs(token, [
    { title: TAB, rows: menuRows },
    { title: TAB_OPTS, rows: optRows },
  ]);

  console.log(`\nOK tab "${TAB}"`);
  console.log(`  Shopee-only (ชื่อตรง): ${data.shopeeOnly.length}`);
  console.log(`  ชื่อต่าง (alias): ${data.aliases.length}`);
  console.log(`  POS-only active: ${data.posOnlyActive.length}`);
  console.log(`  POS inactive: ${data.posOnlyInactive.length}`);
  console.log(`\nOK tab "${TAB_OPTS}"`);
  console.log(`  ตรงกัน: ${optData.matched.length}`);
  console.log(`  ชื่อต่าง: ${optData.nameDiff.length}`);
  console.log(`  POS-only ตัวเลือก: ${optData.posOnly.length}`);
  console.log(`  Shopee topping-only: ${optData.shopeeToppingOnly.length}`);
  console.log(`  https://docs.google.com/spreadsheets/d/${TELLTEA_SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
