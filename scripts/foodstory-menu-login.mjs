#!/usr/bin/env node
/**
 * บันทึกเซสชัน FoodStory ลง Playwright storage (ใช้ตอนเครื่องผ่าน Cloudflare ได้)
 *
 *   npm run foodstory:menu-login -- --headed
 *
 * ล็อกอินในหน้าต่างที่เปิด → รอจนเข้า /th/menu ได้ → กด Enter ในเทอร์มินัล
 * จะเซฟที่ scripts/data/foodstory-auth/storage.json + session.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { chromium } from "playwright";
import { FS_MANAGE_MENU_URL, FS_OWNER_LOGIN_URL } from "./lib/foodstory-api.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dir, "data/foodstory-auth");
const STORAGE = join(AUTH_DIR, "storage.json");
const SESSION = join(AUTH_DIR, "session.json");

function waitEnter(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const headed = process.argv.includes("--headed") || process.env.FOODSTORY_HEADED === "1";
  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.FOODSTORY_CHROME_CHANNEL || (headed ? "chrome" : undefined),
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    locale: "th-TH",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const start =
    process.env.FOODSTORY_LOGIN_URL ||
    `${FS_OWNER_LOGIN_URL}?from_url=${encodeURIComponent(FS_MANAGE_MENU_URL)}`;
  console.log("เปิด", start);
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 90000 });

  if (!headed) {
    console.warn(
      "โหมด headless มักโดน Cloudflare บล็อก — แนะนำรันด้วย --headed บนเครื่องที่มีจอจริง",
    );
  }

  console.log(`
1) ล็อกอิน FoodStory ในหน้าต่างเบราว์เซอร์
2) เปิดให้ถึงหน้าเมนู: ${FS_MANAGE_MENU_URL}
3) กลับมาที่เทอร์มินัลนี้แล้วกด Enter
`);
  await waitEnter("กด Enter เมื่อล็อกอินและเข้าหน้าเมนูแล้ว… ");

  // try navigate to menu to refresh localStorage
  try {
    await page.goto(FS_MANAGE_MENU_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.warn("ไปหน้าเมนูไม่สำเร็จ:", err.message);
  }

  const session = await page.evaluate(() => ({
    idKey: localStorage.getItem("idKey") || localStorage.getItem("access_token"),
    branchId: localStorage.getItem("branch_id"),
    companyId: localStorage.getItem("company_id"),
    url: location.href,
  }));

  await context.storageState({ path: STORAGE });
  writeFileSync(
    SESSION,
    JSON.stringify({ ...session, savedAt: new Date().toISOString() }, null, 2),
  );

  console.log("บันทึก storage →", STORAGE);
  console.log("บันทึก session →", SESSION);
  console.log("session:", {
    hasIdKey: Boolean(session.idKey),
    branchId: session.branchId,
    companyId: session.companyId,
    url: session.url,
  });

  if (!session.idKey || !session.branchId) {
    console.error("ยังไม่มี idKey/branchId ใน localStorage — ล็อกอินไม่ครบ");
    await browser.close();
    process.exit(1);
  }

  await browser.close();
  console.log("ถัดไป: npm run foodstory:menu-capture");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
