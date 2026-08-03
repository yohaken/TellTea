/**
 * Guard: cash-in round edit — photos stay on day lines, notes, save/update
 * (add/remove calendar days UI was removed; tick sessions own the bundle)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const panel = read("src/components/CashInLedgerPanel.tsx");
const preview = read("src/components/EntryPhotoCell.tsx");
const css = read("src/app/globals.css");
const lib = read("src/lib/cash-deposits.ts");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 667, `APP_BUILD >= 667, got ${buildMatch[1]}`);

assert.match(panel, /ลบรูป|clearSlipUrls|removePreviewPhotoAt/);
assert.match(panel, /setDaySlipUrls/);
assert.match(panel, /editNote|draft\.note/);
assert.match(panel, /emptyCashDepositDay/);
assert.match(panel, /updateCashDeposit|addCashDeposit/);
assert.match(panel, /slipUrls: \[\.\.\.d\.slipUrls\]/);
assert.match(panel, /sessionActualAmounts/);
assert.match(preview, /onRemoveAt/);
assert.match(preview, /ลบรูปนี้/);
assert.match(css, /photo-fs-download\.is-danger/);
assert.match(lib, /note: \(input\.note/);
assert.match(lib, /emptyCashDepositDay/);
assert.match(lib, /sessionActualAmounts/);

console.log("OK test-cash-in-edit-round");
