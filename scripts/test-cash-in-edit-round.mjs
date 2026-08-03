/**
 * Guard: cash-in round edit — bank slip photos, notes, save/update
 * (day/round-print attach removed; tick sessions + bank slips only)
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
assert.ok(Number(buildMatch[1]) >= 674, `APP_BUILD >= 674, got ${buildMatch[1]}`);

assert.match(panel, /ลบรูป|clearSlipUrls|removePreviewPhotoAt/);
assert.match(panel, /setTransferSlipUrls/);
assert.doesNotMatch(panel, /setDaySlipUrls|openDayPhoto|attachPosPrintForSession/);
assert.match(panel, /editNote|draft\.note/);
assert.match(panel, /emptyCashDepositDay/);
assert.match(panel, /updateCashDeposit|addCashDeposit/);
assert.match(panel, /slipUrls: \[\.\.\.d\.slipUrls\]/);
assert.match(preview, /onRemoveAt/);
assert.match(preview, /ลบรูปนี้/);
assert.match(css, /photo-fs-download\.is-danger/);
assert.match(lib, /note: \(input\.note/);
assert.match(lib, /emptyCashDepositDay/);

console.log("OK test-cash-in-edit-round");
