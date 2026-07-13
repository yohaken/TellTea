import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const preload = readFileSync(join(root, "src/lib/pos-menu-preload.ts"), "utf8");
assert.match(preload, /publishLocalMenuOrder/);
assert.match(preload, /savePosMenuCache/);
assert.match(preload, /localOrderHoldUntil/);
assert.match(preload, /applyHeldOrder/);

const admin = readFileSync(join(root, "src/components/PosMenuAdmin.tsx"), "utf8");
assert.match(admin, /publishLocalMenuOrder/);
assert.match(admin, /โชว์หน้าขายทันที/);
assert.match(admin, /void reorderMenuCategories\(ids\)\.catch/);
assert.match(admin, /void reorderMenuItemsInCategory\(catId, ids\)\.catch/);
assert.match(admin, /void reorderMenuOptionGroups\(ids\)\.catch/);

const promptpay = readFileSync(join(root, "src/lib/pos-promptpay.ts"), "utf8");
assert.match(promptpay, /isValidPromptPayId/);
assert.match(promptpay, /normalizePromptPayId/);

const biz = readFileSync(join(root, "src/components/PosBusinessSettingsView.tsx"), "utf8");
assert.match(biz, /PromptPay พร้อมใช้/);
assert.match(biz, /isValidPromptPayId/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 44/);

// PromptPay validation mirror
function isValid(id) {
  const d = String(id).replace(/\D/g, "");
  return (d.length === 10 && d.startsWith("0")) || d.length === 13;
}
assert.equal(isValid("0812345678"), true);
assert.equal(isValid("1234567890123"), true);
assert.equal(isValid("812345678"), false);
assert.equal(isValid(""), false);

console.log("OK pos-menu-order-promptpay");
