#!/usr/bin/env node
/**
 * Audit inactive/suspect menu items — ever sold in posSales?
 *
 *   node scripts/audit-inactive-menu-sales.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { collection, getDocs } from "firebase/firestore";

const __dir = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(__dir, "data/menu-price-baseline/telltea-menu-prices-snapshot-2026-09-01.csv");
const OUT = join(__dir, "data/menu-price-baseline/inactive-menu-sales-audit.json");

const SUSPECT_NAMES = new Set(
  `
เทส
เทส 2
0% แคล ชามะพร้าว
กาแฟสด เผือกลาเต้ร้อน
กาแฟสด โอวัลตินช็อตกาแฟ เย็นม
(แก้วใหญ่) ไอศกรีมซอฟเสิร์ฟ
เฉาก๊วยลูกหนึบเนื้อแน่น
เฉาก๊วยหนึบลูกนิมิต
ชาเขียวนมปั่น
ชาไทยปั่น
ชานมไต้หวันปั่น
ชิโอปัง ชาโคล โฮมเมด
ชิโอปังมัทฉะ โฮมเมด
ชิโอปังมันม่วง + ไส้มันม่วง โฮมเมด
ชิโอปัง (Shio Pan) โฮมเมด ใส้ (แฮม/ชีส)
ซอฟต์คุกกี้มัจฉะช็อกชิพ
สเลอร์ปี้ชาไทย
หวานเย็นโบราณ
Craft Osmanthus Oolong (คราฟต์อู่หลงหอมหมื่นลี้)
[QA-TEST] เมนูทดสอบ A
[QA-TEST] เมนูทดสอบ B
`
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

function norm(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s) {
  return norm(s).toLowerCase();
}

async function main() {
  const rows = parse(readFileSync(SNAPSHOT, "utf8"), { columns: true, skip_empty_lines: true });
  const field = (r, k) => r[k] || r[`\ufeff${k}`] || "";

  const suspects = rows.filter((r) => SUSPECT_NAMES.has(norm(field(r, "name"))));
  const byId = new Map();
  for (const r of suspects) {
    const id = field(r, "id");
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: field(r, "name"),
        category: field(r, "category"),
        active: field(r, "active") === "true",
        visibleOnPos: field(r, "visibleOnPos") === "true",
        qty: 0,
        bills: 0,
        firstSaleAt: null,
        lastSaleAt: null,
        nameHits: 0,
      });
    }
  }

  const nameToIds = new Map();
  for (const item of byId.values()) {
    const k = normKey(item.name);
    if (!nameToIds.has(k)) nameToIds.set(k, []);
    nameToIds.get(k).push(item.id);
  }

  console.log(`Suspect menu records: ${byId.size} (unique ids)`);
  console.log("Scanning posSales…");

  const db = await getSeedDb();
  const salesSnap = await getDocs(collection(db, "posSales"));
  console.log(`posSales docs: ${salesSnap.size}`);

  for (const d of salesSnap.docs) {
    const x = d.data();
    if (x.status && x.status !== "completed") continue;
    const createdAt = typeof x.createdAt === "number" ? x.createdAt : 0;
    const lines = Array.isArray(x.lines) ? x.lines : [];
    const matchedInBill = new Set();

    for (const line of lines) {
      if (!line) continue;
      const qty = Math.max(0, Number(line.qty) || 0);
      if (!qty) continue;
      const menuItemId = typeof line.menuItemId === "string" ? line.menuItemId.trim() : "";
      const lineName = norm(typeof line.name === "string" ? line.name : "");

      let target = menuItemId && byId.has(menuItemId) ? byId.get(menuItemId) : null;
      if (!target && lineName) {
        const ids = nameToIds.get(normKey(lineName)) || [];
        if (ids.length === 1) target = byId.get(ids[0]);
        else if (ids.length > 1) {
          for (const id of ids) {
            const t = byId.get(id);
            t.nameHits += qty;
          }
        }
      }
      if (!target) continue;

      target.qty += qty;
      matchedInBill.add(target.id);
      if (!target.firstSaleAt || createdAt < target.firstSaleAt) target.firstSaleAt = createdAt;
      if (!target.lastSaleAt || createdAt > target.lastSaleAt) target.lastSaleAt = createdAt;
    }

    for (const id of matchedInBill) byId.get(id).bills += 1;
  }

  const results = [...byId.values()]
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "th"))
    .map((r) => ({
      ...r,
      firstSaleAt: r.firstSaleAt ? new Date(r.firstSaleAt).toISOString() : null,
      lastSaleAt: r.lastSaleAt ? new Date(r.lastSaleAt).toISOString() : null,
      verdict: r.qty > 0 ? "เคยขาย" : "ไม่เคยขาย (ใน posSales)",
    }));

  const everSold = results.filter((r) => r.qty > 0);
  const neverSold = results.filter((r) => r.qty === 0);

  const payload = {
    auditedAt: new Date().toISOString(),
    salesScanned: salesSnap.size,
    suspectCount: results.length,
    everSoldCount: everSold.length,
    neverSoldCount: neverSold.length,
    results,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  console.log(`\nเคยขาย: ${everSold.length} / ${results.length}`);
  everSold.forEach((r) =>
    console.log(`  ${r.qty} แก้ว · ${r.bills} บิล · ${r.name} (${r.id})`),
  );
  console.log(`\nไม่เคยขาย: ${neverSold.length}`);
  neverSold.forEach((r) => console.log(`  - ${r.name} (${r.id})`));
  console.log(`\n→ ${OUT}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
