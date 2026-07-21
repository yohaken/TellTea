/**
 * Unified TellTea POS receipt template sanity checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templateSrc = readFileSync(join(root, "src/lib/pos-printer/receipt-template.ts"), "utf8");
const layoutSrc = readFileSync(join(root, "src/lib/pos-printer/layout.ts"), "utf8");
const typesSrc = readFileSync(join(root, "src/lib/pos-printer/types.ts"), "utf8");
const settingsSrc = readFileSync(join(root, "src/lib/pos-settings.ts"), "utf8");

assert.match(templateSrc, /buildUnifiedReceiptBody/);
assert.match(templateSrc, /ยอดสุทธิ/);
assert.match(templateSrc, /receiptLineBaseName/);
assert.match(templateSrc, /ใบเสร็จ/);
assert.match(templateSrc, /RECEIPT_CHANNEL_LABELS/);
assert.match(templateSrc, /shopeefood/);
assert.match(templateSrc, /lineman/);

assert.match(layoutSrc, /receipt-template/);
assert.match(layoutSrc, /sampleReceiptPayload/);
assert.doesNotMatch(layoutSrc, /ขอบคุณที่อุดหนุน.*layout/);

assert.match(typesSrc, /ReceiptOrderChannel/);
assert.match(typesSrc, /orderChannel/);
assert.match(typesSrc, /shopAddress/);

assert.match(settingsSrc, /shopNameTh/);
assert.match(settingsSrc, /shopPhone/);

assert.match(templateSrc, /qty-badge/);
assert.match(templateSrc, /background:\s*transparent/);
assert.doesNotMatch(templateSrc, /<span class="qty">×\$\{line\.qty\}<\/span>/);
assert.match(readFileSync(join(root, "src/components/PosReceiptPaper.tsx"), "utf8"), /pos-receipt-paper-item-qty-badge/);
assert.match(readFileSync(join(root, "src/app/globals.css"), "utf8"), /\.pos-receipt-paper-item-qty-badge[\s\S]*?background:\s*transparent/);
assert.match(readFileSync(join(root, "src/lib/pos-session.ts"), "utf8"), /startPosSessionLocal/);
assert.match(readFileSync(join(root, "src/lib/pos-session.ts"), "utf8"), /readLocalOpenPosSession/);
assert.match(readFileSync(join(root, "src/lib/pos-session.ts"), "utf8"), /applyRemotePosSessionUpdate/);
assert.match(readFileSync(join(root, "src/lib/pos-app-context.tsx"), "utf8"), /applyRemotePosSessionUpdate/);
assert.match(readFileSync(join(root, "src/components/PosShiftView.tsx"), "utf8"), /pos-shift-receipt-inline/);
assert.match(readFileSync(join(root, "src/components/PosOptionPickerModal.tsx"), "utf8"), /pos-option-picker-thumb/);
assert.match(readFileSync(join(root, "src/components/PosOptionPickerModal.tsx"), "utf8"), /is-required/);
assert.doesNotMatch(
  readFileSync(join(root, "src/components/PosOptionPickerModal.tsx"), "utf8"),
  /pos-option-req/,
);
assert.doesNotMatch(readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8"), /★/);
assert.match(readFileSync(join(root, "src/components/PosAppShell.tsx"), "utf8"), /pos-icon-btn--refresh/);
assert.match(readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8"), /pos-cart-line-tap/);
assert.match(templateSrc, /mod-qty/);
assert.match(templateSrc, /receiptQtyEmphasized/);
assert.match(readFileSync(join(root, "src/lib/pos-receipt-format.ts"), "utf8"), /receiptQtyEmphasized/);
assert.match(readFileSync(join(root, "src/components/PosShopPaySetup.tsx"), "utf8"), /ร้าน · สลิป · ชำระเงิน/);
assert.match(readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8"), /visibleOnPos !== false/);
assert.doesNotMatch(
  readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8"),
  /categoryId === categoryId && i\.active && i\.visibleOnPos/,
);
assert.match(readFileSync(join(root, "src/app/globals.css"), "utf8"), /repeat\(5, minmax\(0, 1fr\)\)/);
assert.match(readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8"), /pos-cart-head-count/);
assert.match(readFileSync(join(root, "src/components/PosShopPaySetup.tsx"), "utf8"), /PromptPay/);
assert.match(settingsSrc, /receiptStaffName/);
assert.match(readFileSync(join(root, "src/lib/pos-version.ts"), "utf8"), /POS_BUILD = \d+/);

console.log("OK pos-receipt-layout");
