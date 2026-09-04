#!/usr/bin/env node
/**
 * Push telltea-price-summary-workbook.xlsx tabs into Google Sheet.
 * Requires: gcloud auth login --enable-gdrive-access (yohaken@gmail.com)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import XLSX from "xlsx";

const SHEET_ID = "1_vl4gYTZoTT9U4vzrcV01TIgbEIJAaDn0L212QzmAwo";
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKBOOK = join(__dir, "data/menu-price-baseline/telltea-price-summary-workbook.xlsx");

const TAB_MAP = {
  "สรุปภาพรวม": "สรุปปรับราคา",
  เมนู: "เมนู — เก่า vs ปัจจุบัน",
  ตัวเลือก: "ตัวเลือก — เก่า vs ปัจจุบัน",
};

async function sheetsFetch(path, token, init = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
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

function aoaFromSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`missing tab ${name}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

function gcloudToken() {
  try {
    return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error("no access token — run: gcloud auth login yohaken@gmail.com --enable-gdrive-access");
  }
}

async function main() {
  const token = gcloudToken();

  const meta = await sheetsFetch("?fields=sheets(properties(sheetId,title))", token);
  const existing = new Map(
    (meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]),
  );

  const wb = XLSX.readFile(WORKBOOK);
  const requests = [];

  for (const [srcName, destTitle] of Object.entries(TAB_MAP)) {
    const rows = aoaFromSheet(wb, srcName);
    let sheetId = existing.get(destTitle);
    if (sheetId == null) {
      sheetId = Math.floor(Math.random() * 1e9);
      requests.push({
        addSheet: {
          properties: { sheetId, title: destTitle, gridProperties: { frozenRowCount: 1 } },
        },
      });
      existing.set(destTitle, sheetId);
    } else {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      });
    }

    const endRow = rows.length;
    const endCol = Math.max(...rows.map((r) => r.length), 1);
    const colLetter = (n) => {
      let s = "";
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const range = `'${destTitle.replace(/'/g, "''")}'!A1:${colLetter(endCol)}${endRow}`;

    requests.push({
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: endCol },
        rows: rows.map((row) => ({
          values: row.map((cell) => {
            const n = Number(cell);
            if (cell !== "" && Number.isFinite(n) && String(cell).trim() === String(n)) {
              return { userEnteredValue: { numberValue: n } };
            }
            return { userEnteredValue: { stringValue: String(cell ?? "") } };
          }),
        })),
        fields: "userEnteredValue",
      },
    });
  }

  await sheetsFetch(":batchUpdate", token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  console.log("OK pushed summary tabs to Google Sheet");
  console.log(`  https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
