/**
 * Import stock CSV using TS parser + Firestore REST API
 * Usage: npx tsx scripts/import-stock-firestore.ts [csv-path]
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { GoogleAuth } from "google-auth-library";
import { parseStockCsv } from "../src/lib/stock-import";

const PROJECT = "mypeer-501909";
const CREATED_BY = process.env.CREATED_BY || "yohaken@gmail.com";
const YEAR = Number(process.env.STOCK_YEAR || 2026);
const MONTH = Number(process.env.STOCK_MONTH || 7);

function resolveCsvPath() {
  if (process.argv[2]) return process.argv[2];
  const repoData = path.join(process.cwd(), "data/TELL TEA - สต๊อกสินค้า.csv");
  if (existsSync(repoData)) return repoData;
  return path.join(process.env.HOME || "", "Downloads", "TELL TEA - สต๊อกสินค้า.csv");
}

function firestoreValue(value: unknown) {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  throw new Error(`unsupported ${typeof value}`);
}

function docFields(data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = firestoreValue(v);
  return fields;
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function norm(s: string) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9.]/g, "")
    .toLowerCase();
}

async function getToken() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no token");
  return token;
}

async function listDocs(token: string, collectionId: string) {
  const docs: { name: string; fields?: Record<string, { stringValue?: string }> }[] = [];
  let pageToken = "";
  for (;;) {
    const qs = new URLSearchParams({ pageSize: "300" });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${collectionId} ${res.status}`);
    const json = (await res.json()) as { documents?: typeof docs; nextPageToken?: string };
    for (const d of json.documents || []) docs.push(d);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return docs;
}

async function commitWrites(token: string, writes: unknown[]) {
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200);
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ writes: chunk }),
      },
    );
    if (!res.ok) throw new Error(`commit ${res.status} ${(await res.text()).slice(0, 400)}`);
  }
}

async function main() {
  const csvPath = resolveCsvPath();
  if (!existsSync(csvPath)) throw new Error(`missing ${csvPath}`);

  const text = readFileSync(csvPath, "utf8");
  const preview = parseStockCsv(text, YEAR, MONTH);
  if (!preview.products.length) {
    throw new Error(`parse failed — ${preview.skipped.length} skipped rows`);
  }

  console.log(`parsed ${preview.products.length} products, ${preview.movements.length} movements (${preview.format})`);
  preview.products.forEach((p) =>
    console.log(`  ${p.name}: ${p.qty} (${p.counts.length} counts)`),
  );

  const token = await getToken();
  const stockDocs = await listDocs(token, "stock");
  const byName = new Map<string, string>();
  for (const d of stockDocs) {
    const name = d.fields?.name?.stringValue;
    if (name) byName.set(norm(name), d.name.split("/").pop()!);
  }

  const now = Date.now();
  const writes: unknown[] = [];
  const itemIdByName = new Map<string, string>();

  for (const p of preview.products) {
    const key = norm(p.name);
    const existingId = byName.get(key);
    const id = existingId || randomId();
    itemIdByName.set(key, id);
    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/stock/${id}`,
        fields: docFields({
          name: p.name,
          unit: p.unit,
          qty: p.qty,
          minQty: p.minQty,
          safetyStock: p.safetyStock,
          unitCost: p.unitCost,
          barcode: null,
          note: "",
          updatedAt: now,
          updatedBy: CREATED_BY,
        }),
      },
    });
  }

  for (const m of preview.movements) {
    const itemId = itemIdByName.get(norm(m.itemName));
    if (!itemId) continue;
    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/stockMovements/${randomId()}`,
        fields: docFields({
          itemId,
          itemName: m.itemName,
          type: m.type,
          quantity: m.quantity,
          date: m.date,
          inspector: CREATED_BY,
          remark: m.remark,
          createdAt: now,
          createdBy: CREATED_BY,
        }),
      },
    });
  }

  await commitWrites(token, writes);
  console.log(`done — upsert ${preview.products.length} products, ${preview.movements.length} movements`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
