/**
 * Parse Shopee Partner "ดาวน์โหลดเมนู" ZIP / CSVs (เมนูหลัก + กลุ่มตัวเลือกเสริม).
 * IDs in the export are Excel-escaped: "=""123""".
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { parse } from "csv-parse/sync";
import { basename } from "node:path";

export function normName(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanShopeeId(s) {
  const raw = String(s ?? "").trim();
  const m = raw.match(/(\d{6,})/);
  return m ? m[1] : raw.replace(/[="'\s]/g, "");
}

function toBaht(raw) {
  const n = Number(String(raw ?? "").replace(/[,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Minimal ZIP reader (store / deflate) for Shopee export. */
export function unzipNamed(buf) {
  const files = {};
  let o = 0;
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  while (o + 30 <= bytes.length) {
    if (bytes.readUInt32LE(o) !== 0x04034b50) break;
    const flags = bytes.readUInt16LE(o + 6);
    const method = bytes.readUInt16LE(o + 8);
    let comp = bytes.readUInt32LE(o + 18);
    const nameLen = bytes.readUInt16LE(o + 26);
    const extraLen = bytes.readUInt16LE(o + 28);
    const name = bytes.subarray(o + 30, o + 30 + nameLen).toString("utf8");
    let start = o + 30 + nameLen + extraLen;
    if (flags & 0x8) {
      // data descriptor after payload — scan for PK\x07\x08
      throw new Error(`ZIP data descriptor not supported (${name})`);
    }
    const data = bytes.subarray(start, start + comp);
    files[name] = method === 0 ? data : inflateRawSync(data);
    o = start + comp;
  }
  return files;
}

function parseCsvBuffer(buf) {
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    relax_quotes: true,
  });
}

export function parseMenuCsv(buf) {
  const rows = parseCsvBuffer(buf);
  const items = [];
  for (const r of rows) {
    const name = normName(r["ชื่อเมนูอาหาร"] || r.shopeeName);
    if (!name) continue;
    const dishId = cleanShopeeId(r["รหัสเมนูอาหาร"] || r.shopeeCode);
    const listPrice = toBaht(r["ราคา (฿)"] || r.shopeePrice);
    if (listPrice == null) continue;
    items.push({
      name,
      listPrice,
      dishId: dishId || null,
      category: String(r["ชื่อหมวดหมู่"] || "").trim(),
      visible: String(r["สถานะการแสดงเมนูที่หน้าร้านค้า"] || "").trim(),
      stock: String(r["สถานะสต็อกสินค้า"] || "").trim(),
    });
  }
  return items;
}

export function parseOptionCsv(buf) {
  const rows = parseCsvBuffer(buf);
  const options = [];
  for (const r of rows) {
    const name = normName(r["ชื่อตัวเลือกเสริม"]);
    if (!name) continue;
    const price = toBaht(r["ราคาเพิ่มเติมของตัวเลือก (฿)"]);
    if (price == null) continue;
    const groupId = cleanShopeeId(r["รหัสกลุ่มตัวเลือกเสริม"]);
    const optionId = cleanShopeeId(r["รหัสตัวเลือกเสริม"]);
    const group = String(r["ชื่อกลุ่มตัวเลือกเสริม"] || "").trim();
    options.push({
      group,
      name,
      price,
      optionId: optionId || null,
      groupId: groupId || null,
      url: groupId
        ? `https://partner.shopee.co.th/shopee-pos/menu-management/option-group/edit?id=${groupId}&storeId=10212109&defaultTab=sf`
        : null,
    });
  }
  return options;
}

function pickFile(files, needle) {
  const keys = Object.keys(files);
  return keys.find((k) => k.includes(needle) || basename(k).includes(needle));
}

export function loadShopeeExportZip(zipPath) {
  const files = unzipNamed(readFileSync(zipPath));
  const menuKey =
    pickFile(files, "เมนูหลัก") ||
    pickFile(files, "menu") ||
    Object.keys(files).find((k) => k.toLowerCase().endsWith(".csv") && !k.includes("ตัวเลือก"));
  const optKey =
    pickFile(files, "กลุ่มตัวเลือกเสริม") ||
    pickFile(files, "option") ||
    Object.keys(files).find((k) => k.includes("ตัวเลือก"));
  if (!menuKey) throw new Error(`No เมนูหลัก.csv in ${zipPath} (${Object.keys(files).join(", ")})`);
  const items = parseMenuCsv(files[menuKey]);
  const options = optKey ? parseOptionCsv(files[optKey]) : [];
  return {
    scannedAt: new Date().toISOString(),
    method: "shopee-csv-export",
    sourceFile: basename(zipPath),
    items,
    options,
    files: Object.keys(files),
  };
}

export function toLiveScan(parsed) {
  return {
    scannedAt: parsed.scannedAt,
    method: parsed.method || "shopee-csv-export",
    sourceFile: parsed.sourceFile || null,
    count: parsed.items.length,
    items: parsed.items.map((it) => ({
      name: it.name,
      listPrice: it.listPrice,
      displayPrice: it.listPrice,
      prices: [it.listPrice],
      dishId: it.dishId,
      category: it.category,
      visible: it.visible,
      stock: it.stock,
    })),
  };
}

export function toLiveOptions(parsed) {
  const groups = new Set(parsed.options.map((o) => o.groupId).filter(Boolean));
  return {
    at: parsed.scannedAt,
    source: parsed.method || "shopee-csv-export",
    sourceFile: parsed.sourceFile || null,
    groups: groups.size,
    okGroups: groups.size,
    options: parsed.options,
  };
}
