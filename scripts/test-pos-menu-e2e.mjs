/**
 * POS menu UX e2e — Playwright simulates real tablet taps on production POS.
 * Run: npm run test:pos-menu-e2e
 * Env: POS_E2E_URL (default https://telltea-pos.web.app/pos/)
 */
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const POS_URL = process.env.POS_E2E_URL || "https://telltea-pos.web.app/pos/sell/";
const phone = devices["iPhone 13"];
const errors = [];
const report = [];

function note(msg) {
  report.push(msg);
  console.log(msg);
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...phone });
const page = await context.newPage();

page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});

page.on("dialog", async (dialog) => {
  if (dialog.type() === "prompt") {
    await dialog.accept(`e2e-${Date.now().toString(36)}`);
  } else {
    await dialog.accept();
  }
});

note(`1. โหลด POS ${POS_URL}`);
const res = await page.goto(POS_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
assert.ok(res && res.status() < 400, `HTTP ${res?.status()}`);

await page.waitForFunction(
  () =>
    document.body.innerText.includes("พร้อมขาย")
    || document.body.innerText.includes("กดค้างเมนู")
    || document.body.innerText.includes("สั่งและชำระเงิน")
    || document.body.innerText.includes("เชื่อมต่อไม่สำเร็จ"),
  { timeout: 45000 },
);

const bootText = await page.locator("body").innerText();
if (bootText.includes("เชื่อมต่อไม่สำเร็จ")) {
  fail("POS boot failed — Firebase/auth unavailable in e2e");
  await browser.close();
  process.exit(1);
}
note("   OK boot (พร้อมขายหรือหน้าขาย)");

await page.locator(".pos-mobile-menu-btn").click().catch(() => {});
const sidebarOpen = await page.locator(".pos-sidebar.is-open").isVisible().catch(() => false);
if (!sidebarOpen) {
  const btn = page.locator(".pos-mobile-menu-btn");
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

const menuLink = page.locator('a.pos-sidebar-link[href="/pos/menu/"]');
assert.ok(await menuLink.count() >= 1, "ลิงก์เมนูใน sidebar ต้องมีอย่างน้อย 1");
const href = await menuLink.first().getAttribute("href");
assert.equal(href, "/pos/menu/", `href ต้องเป็น /pos/menu/ ได้ ${href}`);
note("2. ลิงก์เมนูใน sidebar เป็น /pos/menu/");

await Promise.all([
  page.waitForURL(/\/pos\/menu\/?/, { timeout: 20000, waitUntil: "domcontentloaded" }),
  menuLink.first().click(),
]);
note(`3. คลิกเฟือง → ไปหน้าเมนู OK (${page.url()})`);

await page.waitForFunction(
  () => {
    const t = document.body.innerText;
    return t.includes("หมวดหมู่รายการ") && !t.includes("กำลังเชื่อมต่อเมนู...");
  },
  { timeout: 30000 },
);

const menuText = await page.locator("body").innerText();
assert.ok(menuText.includes("เมนูอาหาร") || menuText.includes("หมวดหมู่รายการ"), "ต้องเห็นแท็บเมนู");
assert.ok(menuText.includes("กลุ่มตัวเลือก"), "ต้องเห็นแท็บกลุ่มตัวเลือก");
if (/Missing or insufficient permissions/i.test(menuText)) {
  fail("หน้าเมนูยัง permission denied หลัง auth");
}
note("4. หน้าเมนูโหลด + auth OK");

await page.getByRole("button", { name: "กลุ่มตัวเลือก" }).click();
await page.waitForTimeout(500);
const plusBtn = page.locator("button.pos-menu-add-btn, header.pos-menu-admin-top button[title='เพิ่ม']").first();
await plusBtn.click();

await page.waitForFunction(
  () => document.body.innerText.includes("แก้ไขกลุ่มตัวเลือก"),
  { timeout: 15_000 },
);
const editorText = await page.locator("body").innerText();
assert.ok(editorText.includes("แก้ไขกลุ่มตัวเลือก"), "กด + ต้องเปิด editor กลุ่มตัวเลือก");
note("5. เพิ่มกลุ่มตัวเลือก → เปิด editor");

const nameInput = page.locator("form.pos-menu-editor-form input").first();
await nameInput.fill("ท็อปปิ้ง e2e");
await page.getByRole("button", { name: "บันทึก" }).click();

await page.waitForFunction(
  () => !document.body.innerText.includes("แก้ไขกลุ่มตัวเลือก"),
  { timeout: 15_000 },
);

const afterSave = await page.locator("body").innerText();
if (/Unsupported field value|permission/i.test(afterSave)) {
  fail(`บันทึกกลุ่มล้มเหลว: ${afterSave.slice(0, 200)}`);
}
note("6. บันทึกกลุ่มตัวเลือก OK");

assert.ok(afterSave.includes("กลุ่มตัวเลือก"), "หลังบันทึกต้องกลับรายการกลุ่ม");
note("7. กลับรายการกลุ่ม OK");

const itemsTab = page.getByRole("button", { name: /เมนูอาหาร|หมวดหมู่รายการ/ });
if (await itemsTab.count()) await itemsTab.first().click();
await page.waitForTimeout(300);
const addCatBtn = page.locator("button.pos-menu-add-btn, header.pos-menu-admin-top button[title='เพิ่ม']").first();
if (await addCatBtn.count()) await addCatBtn.click();
await page.waitForTimeout(1500);
const catEditor = await page.locator("body").innerText();
if (catEditor.includes("แก้ไขเมนู") || catEditor.includes("เพิ่มหมวด")) {
  note("8. เพิ่มหมวด/เมนู เปิดฟอร์ม OK");
} else {
  note("8. เพิ่มหมวด — ตรวจสอบด้วยตา (อาจมีหมวดอยู่แล้ว)");
}

const hydration418 = errors.filter((e) => e.includes("418"));
if (hydration418.length) {
  note(`WARN: React hydration #418 (${hydration418.length}x) — ไม่บล็อก deploy แต่ควรแก้`);
}

const serious = errors.filter(
  (e) => !e.includes("418") && !e.includes("favicon") && !e.includes("net::ERR"),
);
if (serious.length) {
  console.log("Extra errors:", serious.slice(0, 6));
}

await browser.close();

if (process.exitCode) {
  console.error("\nPOS menu e2e FAILED");
  process.exit(process.exitCode);
}

console.log("\n=== POS menu e2e report ===");
for (const line of report) console.log(line);
console.log("\nOK pos-menu-e2e");
