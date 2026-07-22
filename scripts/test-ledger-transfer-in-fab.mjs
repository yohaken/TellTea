/**
 * Transfer-in is on ledger (owner FAB), not a separate more-menu card.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const ledger = read("src/app/ledger/page.tsx");
const more = read("src/app/more/page.tsx");
const inPage = read("src/app/in/page.tsx");
const transfer = read("src/components/TransferInModal.tsx");
const alert = read("src/components/LowBalanceAlert.tsx");
const push = read("src/lib/push.ts");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 267/);
assert.match(ledger, /TransferInModal/);
assert.match(ledger, /ledger-transfer-in-fab/);
assert.match(ledger, /isOwner/);
assert.match(ledger, /transferInOpen/);
assert.match(transfer, /บันทึกโอนเข้า/);
assert.match(inPage, /ledger\/\?transferIn=1/);
assert.doesNotMatch(more, /href: "\/in\/"/);
assert.match(alert, /ledger\/\?transferIn=1/);
assert.match(push, /ledger\/\?transferIn=1/);
assert.match(css, /\.ledger-transfer-in-fab/);

const cf = read("functions/index.js");
const sw = read("public/sw.js");
assert.match(cf, /ledger\/\?transferIn=1/);
assert.doesNotMatch(cf, /telltea-shop\.web\.app\/in\/"/);
assert.match(sw, /ledger\/\?transferIn=1/);
assert.doesNotMatch(sw, /telltea-shop\.web\.app\/in\/"/);

console.log("OK test-ledger-transfer-in-fab");
