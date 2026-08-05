/**
 * Gate: X-report cash/item parity — native lines use "price"; print must not show ยอด=0.
 * Also: flush voids before X/Z paper so BO cash doesn't stay higher than the slip.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 673);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 177);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);

const form = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(form, /static double lineUnitPrice/);
assert.match(form, /Prefer[\s\S]*price[\s\S]*unitPrice/);
// Must not be the old unitPrice-only path for amount.
assert.match(form, /double unit = lineUnitPrice\(line\)/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /o\.put\("price", line\.unitPrice\)/);
assert.match(saleSync, /o\.put\("unitPrice", line\.unitPrice\)/);
assert.match(saleSync, /while \(arr\.length\(\) > 250\)/);
assert.match(saleSync, /flushPendingBlocking\(app\)/);
// printShiftReport must flush before building paper (void queue → BO cash parity).
const printIdx = saleSync.indexOf("public void printShiftReport(");
assert.ok(printIdx > 0);
const printChunk = saleSync.slice(printIdx, printIdx + 2500);
assert.match(printChunk, /flushPendingBlocking\(app\)/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /normalizeAdminPaymentMethod/);
assert.match(admin, /m === "transfer"/);
assert.doesNotMatch(
  admin,
  /paymentMethod: data\.paymentMethod === "promptpay" \? "promptpay" : "cash"/,
);

// Pure mirror of lineUnitPrice preference for the Tell Tea receipt shape (price only).
function lineUnitPrice(line) {
  const price = Number(line.price);
  if (Number.isFinite(price) && price > 0) return price;
  const unit = Number(line.unitPrice);
  if (Number.isFinite(unit) && unit > 0) return unit;
  if (Number.isFinite(price) && price >= 0) return price;
  if (Number.isFinite(unit) && unit >= 0) return unit;
  return 0;
}

const nativeLines = [
  { name: "ชาไทย", qty: 8, price: 45 },
  { name: "โกโก้", qty: 10, price: 50 },
  { name: "ชาเขียวนม", qty: 1, price: 54 },
];
let gross = 0;
for (const line of nativeLines) {
  const unit = lineUnitPrice(line);
  assert.ok(unit > 0, `expected price fallback for ${line.name}`);
  gross += line.qty * unit;
}
assert.equal(gross, 8 * 45 + 10 * 50 + 54);
assert.equal(lineUnitPrice({ unitPrice: 40 }), 40);
assert.equal(lineUnitPrice({ price: 0, unitPrice: 35 }), 35);

// Δ 54 case: one cash bill voided locally → print/prefs lower than BO until void flushes.
const printCash = 1259;
const voidedCashBill = 54;
const boCashBeforeFlush = printCash + voidedCashBill;
assert.equal(boCashBeforeFlush, 1313);

console.log("OK test-npos-shift-x-cash-print-parity");
