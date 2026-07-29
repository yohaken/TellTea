/**
 * Guard: cash-in round edit — delete/replace photos, add/remove days, notes
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

assert.match(version, /APP_BUILD = 395/);
assert.match(panel, /ลบรูป/);
assert.match(panel, /clearSlipUrls|removePreviewPhotoAt/);
assert.match(panel, /function addDay/);
assert.match(panel, /function removeDay/);
assert.match(panel, /\+ วันก่อนหน้า|\+ วันถัดไป/);
assert.match(panel, /โน้ตรอบ/);
assert.match(panel, /โน้ตวัน|col-note/);
assert.match(panel, /editNote|draft\.note/);
assert.match(panel, /emptyCashDepositDay/);
assert.match(preview, /onRemoveAt/);
assert.match(preview, /ลบรูปนี้/);
assert.match(css, /photo-fs-download\.is-danger/);
assert.match(css, /cash-in-day-add-bar/);
assert.match(css, /cash-in-note-field/);
assert.match(lib, /note: \(input\.note/);
assert.match(lib, /emptyCashDepositDay/);

console.log("OK test-cash-in-edit-round");
