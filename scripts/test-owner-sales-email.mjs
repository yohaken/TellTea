/**
 * Owner storefront sales → Gmail on POS round close.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

const indexFn = read("functions/index.js");
const vatMail = read("functions/vat-mail.js");
const settingsPage = read("src/app/settings/page.tsx");
const setup = read("src/components/OwnerSalesEmailSetup.tsx");
const lib = read("src/lib/owner-sales-email.ts");

assert.match(indexFn, /onPosSessionClosedSalesEmail/);
assert.match(indexFn, /ownerSalesEmailSendNow/);
assert.match(vatMail, /auth\/gmail\.send/);
assert.match(vatMail, /hasSendScope/);
assert.match(settingsPage, /OwnerSalesEmailSetup/);
assert.match(setup, /ownerSalesEmail|sendOwnerSalesEmailNow/);
assert.match(lib, /yohaken@gmail\.com/);
assert.match(lib, /meta", "ownerSalesEmail"/);

const { _ownerSalesEmailTestOnly: t } = require(join(root, "functions/owner-sales-email.js"));

assert.deepEqual(t.parseSalesEmailSettings(undefined), {
  enabled: true,
  recipients: ["yohaken@gmail.com"],
});
assert.deepEqual(t.parseSalesEmailSettings({ enabled: false, recipients: [] }), {
  enabled: false,
  recipients: [],
});
assert.deepEqual(t.sanitizeRecipients("A@x.com, bad, a@x.com;b@y.co"), ["a@x.com", "b@y.co"]);

const day = {
  gross: 4520.5,
  bills: 61,
  cash: 2000,
  promptpay: 2320.5,
  transfer: 200,
  discount: 35,
  voidedCount: 1,
  voidedTotal: 45,
  roundCount: 2,
  topItems: [{ name: "ชานมไข่มุก <ใหญ่>", qty: 12, revenue: 660 }],
};
const session = {
  id: "s1",
  openedAt: Date.UTC(2026, 9, 22, 1, 0),
  closedAt: Date.UTC(2026, 9, 22, 13, 30),
  openedByName: "เต้",
  closedByName: "เต้",
  closeSource: "",
  totalSales: 3000,
  saleCount: 40,
  closingCashCounted: 1990,
  expectedCash: 2000,
  cashDifference: -10,
  remitAmount: 990,
  cashOutTotal: 0,
  discrepancyNote: "",
};
const mail = t.buildSalesEmail({ dateKey: "2026-10-22", day, session, openSessions: 1 });
assert.match(mail.subject, /2026-10-22/);
assert.match(mail.subject, /61 บิล/);
assert.match(mail.text, /ปิดรอบ 20:30/);
assert.match(mail.text, /พร้อมเพย์/);
assert.match(mail.text, /ส่วนต่าง/);
assert.match(mail.text, /ยังมีรอบเปิดอยู่อีก 1 รอบ/);
assert.match(mail.html, /&lt;ใหญ่&gt;/);
assert.doesNotMatch(mail.html, /<ใหญ่>/);

const dayOnly = t.buildSalesEmail({ dateKey: "2026-10-22", day: { ...day, topItems: [] } });
assert.doesNotMatch(dayOnly.text, /รอบที่เพิ่งปิด/);
assert.doesNotMatch(dayOnly.text, /\n\n\n/);

const raw = t.buildRawMime({
  from: "yohaken@gmail.com",
  to: ["yohaken@gmail.com"],
  ...mail,
});
const decoded = Buffer.from(raw, "base64url").toString("utf8");
assert.match(decoded, /^From: =\?UTF-8\?B\?/);
assert.match(decoded, /To: yohaken@gmail\.com/);
assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
assert.match(decoded, /multipart\/alternative/);

console.log("OK test-owner-sales-email");
