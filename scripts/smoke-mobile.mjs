/**
 * Mobile smoke checks against production TellTea.
 * Run before deploy: node scripts/smoke-mobile.mjs
 */
import { chromium, devices } from "playwright";

const phone = devices["iPhone 13"];
const LOGIN = "https://telltea-bo.web.app/login/";
const LEDGER = "https://telltea-bo.web.app/ledger/";

const errors = [];

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...phone });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("console: " + msg.text());
});

async function mustSeeLoginReady() {
  const res = await page.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!res || res.status() >= 400) fail(`login HTTP ${res?.status()}`);
  try {
    await page.getByRole("button", { name: "เข้าสู่ระบบด้วย Google" }).waitFor({
      timeout: 15000,
    });
    console.log("OK login page ready");
  } catch {
    const text = await page.locator("body").innerText();
    fail(`login never became ready. Got: ${text.slice(0, 240)}`);
  }
}

await mustSeeLoginReady();

await page.goto(LOGIN, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /เข้าสู่ระบบด้วย Google/ }).click();
await page.waitForTimeout(3500);
const afterClick = page.url();
// Long-term path: same-origin Google redirect (ไม่พึ่ง cross-domain bridge + ticket)
if (
  !afterClick.includes("accounts.google.com") &&
  !afterClick.includes("telltea-bo.web.app/__/auth")
) {
  fail(`login click did not reach Google redirect. url=${afterClick}`);
} else {
  console.log("OK login routes to same-origin Google");
}

// Ledger redirects to login when signed out — still must not white-screen
await page.goto(LEDGER, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const ledgerText = await page.locator("body").innerText();
if (!ledgerText.includes("TellTea") && !ledgerText.includes("เข้าสู่ระบบ")) {
  fail(`ledger/auth gate blank: ${ledgerText.slice(0, 180)}`);
} else {
  console.log("OK ledger auth gate");
}

const serious = errors.filter(
  (e) =>
    !e.includes("favicon") &&
    !e.includes("third-party") &&
    !e.includes("net::ERR") &&
    !e.includes("Minified React error #418") &&
    !e.includes("Minified React error #423") &&
    !e.includes("Minified React error #425"),
);
if (serious.length) {
  console.log("console/page errors:", serious.slice(0, 8));
  fail("page errors present");
}

await browser.close();
if (process.exitCode) {
  console.error("\nSmoke failed — do not deploy.");
  process.exit(process.exitCode);
}
console.log("\nSmoke passed.");
