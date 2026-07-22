/**
 * Staff / owner / PnL share the same ledger type labels via labelLedgerType.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const labels = read("src/lib/ledger-labels.ts");
const cats = read("src/lib/categories.ts");
const owner = read("src/app/owner-books/page.tsx");
const pnl = read("src/app/pnl/page.tsx");
const xlsx = read("src/lib/xlsx-export.ts");
const xlsxImport = read("src/lib/xlsx-import.ts");
const ai = read("src/lib/ledger-ai.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 243/);
assert.match(labels, /canonicalLedgerType/);
assert.match(labels, /ต้นทุน \(cogs\)/);
assert.match(labels, /ค่าใช้จ่าย \(sga\)/);
assert.match(labels, /สินทรัพย์ \(asset\)/);
assert.match(cats, /canonicalLedgerType/);
assert.match(cats, /labelLedgerType/);
assert.match(cats, /categoryLabel/);
assert.doesNotMatch(cats, /return "Asset"/);
assert.match(owner, /labelLedgerType\(row\.type\)/);
assert.doesNotMatch(owner, /\{row\.type \|\| "—"\}/);
assert.match(pnl, /categoryLabel\("asset"\)/);
assert.match(pnl, /categoryLabel\("cogs"\)/);
assert.match(pnl, /categoryLabel\("sga"\)/);
assert.doesNotMatch(pnl, />Asset</);
assert.match(xlsx, /categoryLabel\("asset"\)/);
assert.match(xlsx, /categoryLabel\("cogs"\)/);
assert.match(xlsxImport, /canonicalLedgerType/);
assert.match(ai, /canonicalLedgerType/);

function canonicalLedgerType(raw) {
  const TYPE_ALIASES = {
    cogs: "cogs",
    cosg: "cogs",
    assets: "asset",
    asset: "asset",
    sga: "sga",
    other: "อื่นๆ",
    others: "อื่นๆ",
    อื่นๆ: "อื่นๆ",
    "ต้นทุน (cogs)": "cogs",
    "ค่าใช้จ่าย (sga)": "sga",
    "สินทรัพย์ (asset)": "asset",
  };
  const t = String(raw || "").trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  if (TYPE_ALIASES[lower]) return TYPE_ALIASES[lower];
  return t;
}
function normalizeCategory(type) {
  const key = canonicalLedgerType(type);
  if (key === "asset") return "asset";
  if (key === "cogs") return "cogs";
  if (key === "sga") return "sga";
  return "other";
}

assert.equal(canonicalLedgerType("Assets"), "asset");
assert.equal(canonicalLedgerType("ต้นทุน (cogs)"), "cogs");
assert.equal(canonicalLedgerType("ค่าใช้จ่าย (sga)"), "sga");
assert.equal(normalizeCategory("Asset"), "asset");
assert.equal(normalizeCategory("สินทรัพย์ (asset)"), "asset");
assert.equal(normalizeCategory("โอนเข้า"), "other");

console.log("OK test-ledger-type-labels-unify");
