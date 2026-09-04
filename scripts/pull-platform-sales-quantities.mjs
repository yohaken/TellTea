#!/usr/bin/env node
/**
 * pull-platform-sales-quantities.mjs
 * 
 * Controls open Chrome tabs (Grab, LINE MAN / Wongnai, Shopee) to scrape
 * sales quantities per menu item, queries Firestore for storefront POS sales,
 * matches them against POS menu items, and persists the data to Firestore
 * at `menuPriceHub/salesVolume`.
 * 
 * Usage:
 *   node scripts/pull-platform-sales-quantities.mjs
 *   node scripts/pull-platform-sales-quantities.mjs --period=1m
 *   node scripts/pull-platform-sales-quantities.mjs --period=3m
 *   node scripts/pull-platform-sales-quantities.mjs --period=6m
 *   node scripts/pull-platform-sales-quantities.mjs --period=all
 */

import { execFileSync } from "node:child_process";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { bestMatchByName } from "../src/lib/menu-name-match.ts";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripUndefined(val) {
  if (val === undefined) return null;
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(stripUndefined);
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== undefined) {
      out[k] = stripUndefined(v);
    }
  }
  return out;
}

function runAppleScript(script, timeoutMs = 120_000) {
  try {
    return execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (e) {
    throw new Error(e.stderr?.toString() || e.message || String(e));
  }
}

function b64Js(js) {
  return Buffer.from(js, "utf8").toString("base64");
}

function chromeJs(windowIndex, tabIndex, js) {
  const b64 = b64Js(js);
  const script = `
tell application "Google Chrome"
  tell window ${windowIndex}
    set js to do shell script "echo ${b64} | base64 -D"
    return execute tab ${tabIndex} javascript js
  end tell
end tell
`;
  const out = runAppleScript(script);
  if (out === "missing value" || out === "") return null;
  return out;
}

function findPlatformTabs() {
  const script = `
tell application "Google Chrome"
  set grabTab to "none"
  set wongnaiTab to "none"
  set shopeeTab to "none"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with tb in tabs of w
      set ti to ti + 1
      set u to URL of tb as string
      if u contains "merchant.grab.com" and grabTab is "none" then
        set grabTab to (wi as string) & "," & (ti as string)
      else if u contains "merchant.wongnai.com" and wongnaiTab is "none" then
        set wongnaiTab to (wi as string) & "," & (ti as string)
      else if u contains "partner.shopee" and shopeeTab is "none" then
        set shopeeTab to (wi as string) & "," & (ti as string)
      end if
    end repeat
  end repeat
  return grabTab & "|" & wongnaiTab & "|" & shopeeTab
end tell
`;
  const out = runAppleScript(script);
  const [g, w, s] = out.split("|");
  const parse = (str) => {
    if (!str || str === "none") return null;
    const [wi, ti] = str.split(",").map(Number);
    return { windowIndex: wi, tabIndex: ti };
  };
  return {
    grab: parse(g),
    wongnai: parse(w),
    shopee: parse(s),
  };
}

async function loadPosMenuItems(db) {
  const snap = await getDocs(collection(db, "menuItems"));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return items.filter((i) => i.active !== false);
}

async function fetchPosSalesForRange(db, startMs, endMs) {
  console.log(`  [POS] Querying Firestore posSales from ${new Date(startMs).toLocaleDateString("th-TH")} to ${new Date(endMs).toLocaleDateString("th-TH")}...`);
  const q = query(
    collection(db, "posSales"),
    where("date", ">=", startMs),
    where("date", "<=", endMs),
  );
  const snap = await getDocs(q);
  const itemMap = new Map();
  let billCount = 0;

  snap.forEach((d) => {
    const sale = d.data();
    if (sale.status === "voided") return;
    billCount++;
    for (const line of sale.lines || []) {
      const idKey = line.menuItemId || "";
      const nameKey = (line.name || "").trim();
      const key = idKey || nameKey;
      if (!key) continue;
      const cur = itemMap.get(key) || {
        itemId: idKey,
        name: nameKey,
        qty: 0,
        salesBaht: 0,
      };
      cur.qty += line.qty || 1;
      cur.salesBaht += Math.round((line.price || 0) * (line.qty || 1) * 100) / 100;
      itemMap.set(key, cur);
    }
  });

  return { itemMap, billCount, totalDocs: snap.size };
}

async function scrapeGrabForPeriod(grabTab, periodKey) {
  if (!grabTab) {
    return { available: false, items: [], note: "ไม่พบแท็บ Grab Merchant ใน Chrome" };
  }
  const { windowIndex, tabIndex } = grabTab;
  console.log(`  [Grab] Controlling tab ${windowIndex}:${tabIndex}...`);

  // Ensure on menu tab
  const curUrl = chromeJs(windowIndex, tabIndex, "location.href");
  if (!curUrl?.includes("insights?tab=menu")) {
    console.log("  [Grab] Navigating to https://merchant.grab.com/insights?tab=menu...");
    chromeJs(windowIndex, tabIndex, `location.href = "https://merchant.grab.com/insights?tab=menu";`);
    await sleep(3000);
  }

  // Select dropdown option
  const targetLabel = periodKey === "1m" ? "30 วันที่ผ่านมา" : "90 วันที่ผ่านมา";
  console.log(`  [Grab] Selecting date option "${targetLabel}"...`);

  chromeJs(windowIndex, tabIndex, `(() => {
    const item = document.querySelector("[title=mex-insightsv2-003-009-dropdown]");
    if (!item) return;
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    item.click();
  })()`);
  await sleep(400);

  chromeJs(windowIndex, tabIndex, `(() => {
    const opts = Array.from(document.querySelectorAll(".dui-select-item-option-content, [role=option]"));
    const opt = opts.find(o => o.innerText.includes("${targetLabel}"));
    if (opt) opt.click();
  })()`);
  await sleep(1500);

  const dateText = chromeJs(windowIndex, tabIndex, `document.querySelector(".dui-select-selection-item")?.innerText || ""`);
  console.log(`  [Grab] Active date range: ${dateText}`);

  // Auto scroll until all rows loaded
  let prevCount = 0;
  let stablePasses = 0;
  for (let i = 0; i < 20; i++) {
    const rawCount = chromeJs(
      windowIndex,
      tabIndex,
      `(() => {
      const rows = document.querySelectorAll(".insight-menu-table .troy-row");
      if (rows.length > 0) rows[rows.length - 1].scrollIntoView();
      return rows.length;
    })()`,
    );
    const count = Number(rawCount) || 0;
    if (count > 0 && count === prevCount) {
      stablePasses++;
      if (stablePasses >= 3) break;
    } else {
      stablePasses = 0;
    }
    prevCount = count;
    await sleep(800);
  }

  // Extract rows into window.__grabItems
  chromeJs(windowIndex, tabIndex, `(() => {
    const rows = Array.from(document.querySelectorAll(".insight-menu-table .troy-row"))
      .filter(r => !r.className.includes("menu-header"));
    window.__grabItems = [];
    for (const r of rows) {
      const c = r.children;
      if (c.length < 3) continue;
      const name = c[0].innerText.trim();
      const qtyText = c[1].innerText.trim().split("\\n")[0].replace(/,/g, "");
      const qty = parseInt(qtyText, 10) || 0;
      const salesText = c[2].innerText.trim().replace(/[^0-9.]/g, "");
      const sales = parseFloat(salesText) || 0;
      window.__grabItems.push({ name, qty, sales });
    }
    return window.__grabItems.length;
  })()`);

  // Fetch in chunks
  const items = [];
  for (let offset = 0; offset < 300; offset += 50) {
    const r = chromeJs(windowIndex, tabIndex, `encodeURIComponent(JSON.stringify(window.__grabItems.slice(${offset}, ${offset + 50})))`);
    if (!r) break;
    const chunk = JSON.parse(decodeURIComponent(r));
    if (!chunk || chunk.length === 0) break;
    items.push(...chunk);
  }

  const note = periodKey === "6m" ? "Grab insights รองรับช่วงเวลาย้อนหลังสูงสุด 90 วัน (แสดงข้อมูล 90 วัน)" : undefined;
  console.log(`  [Grab] Scraped ${items.length} items.`);
  return { available: true, items, dateRangeText: dateText, note };
}

async function scrapeLineManForPeriod(wongnaiTab, periodKey, refDate = new Date(2026, 8, 4)) {
  if (!wongnaiTab) {
    return { available: false, items: [], note: "ไม่พบแท็บ Wongnai Merchant ใน Chrome" };
  }
  const { windowIndex, tabIndex } = wongnaiTab;
  console.log(`  [LINE MAN] Controlling tab ${windowIndex}:${tabIndex}...`);

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const endD = new Date(refDate.getTime() - 86400_000); // yesterday
  const daysAgo = periodKey === "1m" ? 30 : periodKey === "3m" ? 90 : 180;
  const startD = new Date(refDate.getTime() - daysAgo * 86400_000);

  const startDateStr = fmt(startD);
  const endDateStr = fmt(endD);
  const targetUrl = `https://merchant.wongnai.com/report/menus/menu-items?startDate=${startDateStr}&endDate=${endDateStr}`;

  console.log(`  [LINE MAN] Navigating to ${targetUrl}...`);
  chromeJs(windowIndex, tabIndex, `location.href = "${targetUrl}";`);
  await sleep(2500);

  // Extract from MuiDataGrid-row
  chromeJs(windowIndex, tabIndex, `(() => {
    const rows = Array.from(document.querySelectorAll(".MuiDataGrid-row"));
    window.__lmItems = [];
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll(".MuiDataGrid-cell"));
      if (cells.length < 4) continue;
      const rank = parseInt(cells[0].innerText.trim(), 10) || 0;
      const name = cells[1].innerText.trim();
      const qty = parseInt(cells[2].innerText.trim().replace(/,/g, ""), 10) || 0;
      const sales = parseFloat(cells[3].innerText.trim().replace(/,/g, "")) || 0;
      window.__lmItems.push({ rank, name, qty, sales });
    }
    return window.__lmItems.length;
  })()`);

  // Fetch in chunks
  const items = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const cr = chromeJs(windowIndex, tabIndex, `encodeURIComponent(JSON.stringify(window.__lmItems.slice(${offset}, ${offset + 50})))`);
    if (!cr) break;
    const chunk = JSON.parse(decodeURIComponent(cr));
    if (!chunk || chunk.length === 0) break;
    items.push(...chunk);
  }

  const dateRangeText = `${startDateStr} ถึง ${endDateStr}`;
  console.log(`  [LINE MAN] Scraped ${items.length} items (${dateRangeText}).`);
  return { available: true, items, dateRangeText };
}

async function buildPeriodSummary(db, posMenuItems, tabs, periodKey, refDate = new Date(2026, 8, 4)) {
  console.log(`\n======================================================`);
  console.log(`Processing Period: ${periodKey.toUpperCase()}...`);
  console.log(`======================================================`);

  const daysAgo = periodKey === "1m" ? 30 : periodKey === "3m" ? 90 : 180;
  const nowMs = refDate.getTime();
  const startMs = nowMs - daysAgo * 86400_000;

  // 1. POS sales
  const { itemMap: posItemMap, billCount } = await fetchPosSalesForRange(db, startMs, nowMs);

  // 2. Grab sales
  const grabRes = await scrapeGrabForPeriod(tabs.grab, periodKey);

  // 3. LINE MAN sales
  const lmRes = await scrapeLineManForPeriod(tabs.wongnai, periodKey, refDate);

  // 4. Shopee status
  const shopeeRes = {
    available: false,
    items: [],
    note: "Shopee Partner ไม่มีรายงานยอดขายแยกรายเมนูในพอร์ทัล",
  };

  // Build byItemId
  const byItemId = {};

  // Initialize for all active POS menu items
  for (const item of posMenuItems) {
    byItemId[item.id] = {
      itemId: item.id,
      name: item.name,
      pos: { qty: 0, salesBaht: 0, available: true },
      grab: { qty: 0, salesBaht: 0, available: grabRes.available, note: grabRes.note },
      lineman: { qty: 0, salesBaht: 0, available: lmRes.available },
      shopee: { qty: 0, salesBaht: 0, available: false, note: shopeeRes.note },
      totalQty: 0,
      totalSalesBaht: 0,
    };
  }

  // Populate POS
  let posTotalQty = 0;
  let posTotalBaht = 0;
  for (const [key, pData] of posItemMap.entries()) {
    let target = byItemId[pData.itemId];
    if (!target) {
      const match = bestMatchByName(pData.name, posMenuItems);
      if (match && match.score >= 0.7) {
        target = byItemId[match.id];
      }
    }
    if (target) {
      target.pos.qty += pData.qty;
      target.pos.salesBaht += pData.salesBaht;
      posTotalQty += pData.qty;
      posTotalBaht += pData.salesBaht;
    }
  }

  // Populate Grab
  let grabTotalQty = 0;
  let grabTotalBaht = 0;
  let grabMatchedCount = 0;
  for (const g of grabRes.items) {
    const match = bestMatchByName(g.name, posMenuItems);
    if (match && match.score >= 0.7) {
      const target = byItemId[match.id];
      if (target) {
        target.grab.qty = g.qty;
        target.grab.salesBaht = g.sales;
        target.grab.rawName = g.name;
        grabTotalQty += g.qty;
        grabTotalBaht += g.sales;
        grabMatchedCount++;
      }
    }
  }

  // Populate LINE MAN
  let lmTotalQty = 0;
  let lmTotalBaht = 0;
  let lmMatchedCount = 0;
  for (const lm of lmRes.items) {
    const match = bestMatchByName(lm.name, posMenuItems);
    if (match && match.score >= 0.7) {
      const target = byItemId[match.id];
      if (target) {
        target.lineman.qty = lm.qty;
        target.lineman.salesBaht = lm.sales;
        target.lineman.rawName = lm.name;
        target.lineman.rank = lm.rank;
        lmTotalQty += lm.qty;
        lmTotalBaht += lm.sales;
        lmMatchedCount++;
      }
    }
  }

  // Calculate totals
  for (const item of Object.values(byItemId)) {
    item.totalQty = item.pos.qty + item.grab.qty + item.lineman.qty + item.shopee.qty;
    item.totalSalesBaht = item.pos.salesBaht + item.grab.salesBaht + item.lineman.salesBaht + item.shopee.salesBaht;
  }

  const periodLabels = { "1m": "1 เดือน", "3m": "3 เดือน", "6m": "6 เดือน" };

  return {
    period: periodKey,
    label: periodLabels[periodKey] || periodKey,
    dateRangeText: `${grabRes.dateRangeText || ""} · ${lmRes.dateRangeText || ""}`.trim() || `${daysAgo} วันล่าสุด`,
    updatedAt: Date.now(),
    channels: {
      pos: {
        available: true,
        itemCount: posItemMap.size,
        totalQty: posTotalQty,
        totalSalesBaht: Math.round(posTotalBaht * 100) / 100,
        note: `จากบิลหน้าร้าน ${billCount} ใบ`,
      },
      grab: {
        available: grabRes.available,
        itemCount: grabMatchedCount,
        totalQty: grabTotalQty,
        totalSalesBaht: Math.round(grabTotalBaht * 100) / 100,
        note: grabRes.note,
        dateRangeText: grabRes.dateRangeText,
      },
      lineman: {
        available: lmRes.available,
        itemCount: lmMatchedCount,
        totalQty: lmTotalQty,
        totalSalesBaht: Math.round(lmTotalBaht * 100) / 100,
        dateRangeText: lmRes.dateRangeText,
      },
      shopee: {
        available: false,
        itemCount: 0,
        totalQty: 0,
        totalSalesBaht: 0,
        note: shopeeRes.note,
      },
    },
    byItemId,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const periodArg = args.find((a) => a.startsWith("--period="))?.split("=")[1] || "all";

  console.log("=== TellTea Menu Sales Quantity Importer ===");
  const tabs = findPlatformTabs();
  console.log("Chrome Tabs detected:");
  console.log(`  Grab:     ${tabs.grab ? `Window ${tabs.grab.windowIndex}, Tab ${tabs.grab.tabIndex}` : "Not found"}`);
  console.log(`  LINE MAN: ${tabs.wongnai ? `Window ${tabs.wongnai.windowIndex}, Tab ${tabs.wongnai.tabIndex}` : "Not found"}`);
  console.log(`  Shopee:   ${tabs.shopee ? `Window ${tabs.shopee.windowIndex}, Tab ${tabs.shopee.tabIndex}` : "Not found"}`);

  if (!tabs.grab && !tabs.wongnai) {
    console.warn("\nWarning: Neither Grab nor LINE MAN tabs are open. Will only process POS sales.");
  }

  const db = await getSeedDb();
  const posMenuItems = await loadPosMenuItems(db);
  console.log(`Loaded ${posMenuItems.length} active POS menu items from Firestore.`);

  const periodsToRun =
    periodArg === "all" ? ["1m", "3m", "6m"] : [periodArg];

  const periodsData = {};
  for (const p of periodsToRun) {
    periodsData[p] = await buildPeriodSummary(db, posMenuItems, tabs, p);
  }

  console.log("\nWriting salesVolume document to Firestore (menuPriceHub/salesVolume)...");
  await setDoc(
    doc(db, "menuPriceHub", "salesVolume"),
    stripUndefined({
      updatedAt: Date.now(),
      activePeriod: "1m",
      periods: periodsData,
    }),
    { merge: true },
  );

  console.log("Firestore update successful!\n");

  // Summary printout for 1m
  const p1 = periodsData["1m"] || Object.values(periodsData)[0];
  if (p1) {
    console.log(`--- สรุปยอดขายรายเมนู (${p1.label}) ---`);
    console.log(`  หน้าร้าน: ${p1.channels.pos.totalQty} ชิ้น (฿${p1.channels.pos.totalSalesBaht.toLocaleString()})`);
    console.log(`  Grab:     ${p1.channels.grab.totalQty} ชิ้น (฿${p1.channels.grab.totalSalesBaht.toLocaleString()})`);
    console.log(`  LINE MAN: ${p1.channels.lineman.totalQty} ชิ้น (฿${p1.channels.lineman.totalSalesBaht.toLocaleString()})`);
    console.log(`  Shopee:   ${p1.channels.shopee.available ? p1.channels.shopee.totalQty : "— (ไม่มีในพอร์ทัล)"}`);

    const top10 = Object.values(p1.byItemId)
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10);

    console.log("\nTop 10 Bestselling Items (ทุกช่องทางรวมกัน):");
    console.table(
      top10.map((item, idx) => ({
        "อันดับ": idx + 1,
        "ชื่อเมนู": item.name,
        "หน้าร้าน": item.pos.qty,
        "Grab": item.grab.qty,
        "LINE MAN": item.lineman.qty,
        "Shopee": item.shopee.available ? item.shopee.qty : "—",
        "รวม (ชิ้น)": item.totalQty,
        "ยอดรวม (฿)": item.totalSalesBaht.toLocaleString(),
      })),
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
