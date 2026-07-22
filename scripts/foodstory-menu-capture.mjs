#!/usr/bin/env node
/**
 * Phase 0 — ดึงเมนู FoodStory แล้วเขียน snapshot JSON (ยังไม่ลง Firestore)
 *
 * วิธีที่ได้ผลในช่วง Cloudflare บล็อก headless:
 *   1) เปิด https://manage.foodstory.co/th/menu ในเบราว์เซอร์ที่ล็อกอินแล้ว
 *   2) DevTools → Console:
 *        copy({ idKey: localStorage.idKey, branchId: localStorage.branch_id })
 *   3) วางค่าเป็น env หรือไฟล์ auth แล้วรันคำสั่งนี้
 *
 *   FOODSTORY_ID_KEY=... FOODSTORY_BRANCH_ID=... npm run foodstory:menu-capture
 *
 * หรือใช้ storage ของ Playwright (หลัง foodstory:menu-login บนเครื่องที่ผ่าน Cloudflare):
 *   npm run foodstory:menu-capture -- --storage scripts/data/foodstory-auth/storage.json
 *
 * จาก raw dump:
 *   npm run foodstory:menu-capture -- --from-raw path/to/raw.json
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  createFoodstoryClient,
  extractEntity,
  extractList,
  FS_MANAGE_MENU_URL,
} from "./lib/foodstory-api.mjs";
import {
  normalizeFoodstoryRaw,
  summarizeSnapshot,
  validateSnapshot,
} from "./lib/foodstory-normalize.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, "data/foodstory-snapshots");
const AUTH_DIR = join(__dir, "data/foodstory-auth");
const DEFAULT_STORAGE = join(AUTH_DIR, "storage.json");
const DEFAULT_AUTH_JSON = join(AUTH_DIR, "session.json");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveCredentials() {
  const fromRaw = argValue("--from-raw");
  if (fromRaw) return { mode: "raw", rawPath: resolve(fromRaw) };

  const cdp =
    argValue("--cdp") ||
    process.env.FOODSTORY_CDP_URL ||
    (hasFlag("--attach-chrome") ? "http://127.0.0.1:9222" : null);
  if (cdp) {
    return { mode: "cdp", cdpUrl: cdp };
  }

  const idKey =
    process.env.FOODSTORY_ID_KEY ||
    process.env.FS_ID_KEY ||
    argValue("--id-key");
  const branchId =
    process.env.FOODSTORY_BRANCH_ID ||
    process.env.FS_BRANCH_ID ||
    argValue("--branch-id");

  const authPath = argValue("--auth") || (existsSync(DEFAULT_AUTH_JSON) ? DEFAULT_AUTH_JSON : null);
  if (authPath && (!idKey || !branchId)) {
    const auth = loadJson(authPath);
    return {
      mode: "api",
      idKey: idKey || auth.idKey || auth.accessToken,
      branchId: branchId || auth.branchId || auth.branch_id,
      companyId: auth.companyId || auth.company_id || null,
      authPath,
    };
  }

  const storagePath =
    argValue("--storage") || (existsSync(DEFAULT_STORAGE) ? DEFAULT_STORAGE : null);

  if (idKey && branchId) {
    return { mode: "api", idKey, branchId, companyId: process.env.FOODSTORY_COMPANY_ID || null };
  }

  if (storagePath) {
    return { mode: "browser-storage", storagePath: resolve(storagePath) };
  }

  return { mode: "missing" };
}

async function readSessionFromPage(page) {
  return page.evaluate(() => {
    const idKey = localStorage.getItem("idKey") || localStorage.getItem("access_token");
    const branchId = localStorage.getItem("branch_id");
    const companyId = localStorage.getItem("company_id");
    let userInfo = null;
    try {
      userInfo = JSON.parse(localStorage.getItem("userInfo") || "null");
    } catch {
      userInfo = null;
    }
    return {
      idKey,
      branchId,
      companyId,
      url: location.href,
      userInfo,
    };
  });
}

/**
 * เกาะ Chrome ที่เปิดอยู่แล้ว (ต้องเปิดด้วย --remote-debugging-port=9222)
 * หาแท็บ manage.foodstory.co ที่ล็อกอินแล้ว แล้วอ่าน idKey/branchId
 */
async function readSessionFromCdp(cdpUrl) {
  console.log("เกาะ Chrome ผ่าน CDP…", cdpUrl);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    throw new Error(
      `เชื่อม CDP ไม่ได้ที่ ${cdpUrl}: ${err.message}\n` +
        "เปิด Chrome บนเครื่องคุณด้วย remote debugging แล้วเปิดหน้าเมนูค้างไว้\n" +
        "(Cloud agent เชื่อม Chrome เครื่องคุณไม่ได้ — ต้องรันบนเครื่องเดียวกับ Chrome)",
    );
  }

  try {
    const contexts = browser.contexts();
    const pages = contexts.flatMap((c) => c.pages());
    let page =
      pages.find((p) => /manage\.foodstory\.co/i.test(p.url())) ||
      pages.find((p) => /foodstory\.co/i.test(p.url())) ||
      null;

    if (!page) {
      const ctx = contexts[0];
      if (!ctx) {
        throw new Error("CDP เชื่อมได้แต่ไม่มีหน้าต่าง Chrome — เปิดแท็บ manage.foodstory.co/th/menu ค้างไว้");
      }
      page = await ctx.newPage();
      await page.goto(FS_MANAGE_MENU_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
    } else if (!/\/th\/menu/i.test(page.url())) {
      await page.bringToFront().catch(() => {});
      await page.goto(FS_MANAGE_MENU_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
    }

    const session = await readSessionFromPage(page);
    session.cdpUrl = cdpUrl;
    session.pageUrl = page.url();
    return session;
  } finally {
    // ห้าม browser.close() — จะปิด Chrome ของผู้ใช้; แค่ตัดการเชื่อมต่อเมื่อโพรเซสจบ
  }
}

async function readSessionFromStorage(storagePath, { headed = false } = {}) {
  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.FOODSTORY_CHROME_CHANNEL || undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      storageState: storagePath,
      locale: "th-TH",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(FS_MANAGE_MENU_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const session = await readSessionFromPage(page);
    await context.close();
    return session;
  } finally {
    await browser.close();
  }
}

async function fetchRawBundle(client, { includeDetails = true, detailLimit = 0 } = {}) {
  console.log("ดึงหมวด / เมนู / กลุ่มตัวเลือก / ตัวเลือก…");
  const [categories, menus, options, choices, groups] = await Promise.all([
    client.fetchCategories(),
    client.fetchMenus(),
    client.fetchOptionListAll(),
    client.fetchChoices(),
    client.fetchGroups().catch(() => []),
  ]);
  console.log(
    `ได้ categories=${categories.length} menus=${menus.length} options=${options.length} choices=${choices.length} groups=${groups.length}`,
  );

  const menuDetails = {};
  if (includeDetails && menus.length) {
    const ids = menus
      .map((m) => m.menu_id || m.menuId || m.id)
      .filter((id) => id != null)
      .map(String);
    const limit = detailLimit > 0 ? Math.min(detailLimit, ids.length) : ids.length;
    console.log(`ดึงรายละเอียดเมนูเพื่อลิงก์ตัวเลือก (${limit}/${ids.length})…`);
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < limit) {
        const idx = i;
        i += 1;
        const id = ids[idx];
        try {
          const raw = await client.fetchMenuDetail(id);
          menuDetails[id] = extractEntity(raw);
        } catch (err) {
          console.warn(`  ข้าม menu ${id}: ${err.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  return { categories, menus, options, choices, groups, menuDetails };
}

async function main() {
  const creds = resolveCredentials();
  if (creds.mode === "missing") {
    console.error(`ยังไม่มีเซสชัน FoodStory

ใช้แบบใดแบบหนึ่ง:
  A) เกาะ Chrome ที่เปิดเมนูค้างไว้ (แนะนำ — รันบนเครื่องเดียวกับ Chrome):
       # เปิด Chrome ด้วย remote debugging ก่อน แล้วเปิดหน้าเมนูค้างไว้
       npm run foodstory:menu-capture -- --attach-chrome

  B) วาง session จาก localStorage ลง scripts/data/foodstory-auth/session.json
       npm run foodstory:menu-capture

  C) env FOODSTORY_ID_KEY + FOODSTORY_BRANCH_ID

หมายเหตุ: Cloud agent คุม Chrome บนเครื่องคุณไม่ได้ — ต้องรันคำสั่งบนเครื่องที่เปิด manage.foodstory.co
`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(AUTH_DIR, { recursive: true });

  let raw;
  let metaExtra = {};

  if (creds.mode === "raw") {
    console.log("อ่าน raw จาก", creds.rawPath);
    raw = loadJson(creds.rawPath);
    if (raw.categories && raw.menus) {
      // already raw bundle
    } else if (raw.items && raw.optionGroups) {
      // already normalized snapshot — re-wrap not needed; write through
      const summary = summarizeSnapshot(raw);
      console.log("ไฟล์นี้เป็น snapshot แล้ว:", summary);
      const out = join(OUT_DIR, `snapshot-from-file-${stamp()}.json`);
      writeFileSync(out, JSON.stringify(raw, null, 2));
      console.log("คัดลอกไป", out);
      return;
    } else {
      throw new Error("--from-raw ต้องเป็น raw bundle หรือ snapshot");
    }
  } else {
    let idKey = creds.idKey;
    let branchId = creds.branchId;
    let companyId = creds.companyId || null;

    if (creds.mode === "cdp" || creds.mode === "browser-storage") {
      let session;
      if (creds.mode === "cdp") {
        session = await readSessionFromCdp(creds.cdpUrl);
      } else {
        console.log("อ่านเซสชันจาก Playwright storage…", creds.storagePath);
        session = await readSessionFromStorage(creds.storagePath, {
          headed: hasFlag("--headed"),
        });
      }
      idKey = session.idKey;
      branchId = session.branchId;
      companyId = session.companyId;
      metaExtra.browserUrl = session.pageUrl || session.url;
      if (!idKey || !branchId) {
        throw new Error(
          `อ่าน Chrome ได้แต่ไม่มี idKey/branchId (url=${session.pageUrl || session.url}). ต้องล็อกอินหน้าเมนูค้างไว้`,
        );
      }
      writeFileSync(
        DEFAULT_AUTH_JSON,
        JSON.stringify({ idKey, branchId, companyId, savedAt: new Date().toISOString() }, null, 2),
      );
    }

    const client = createFoodstoryClient({ idKey, branchId });
    const detailLimit = Number(argValue("--detail-limit") || 0);
    const skipDetails = hasFlag("--skip-details");
    const bundle = await fetchRawBundle(client, {
      includeDetails: !skipDetails,
      detailLimit,
    });
    raw = {
      meta: {
        capturedAt: new Date().toISOString(),
        branchId: String(branchId),
        companyId: companyId ? String(companyId) : null,
        manageUrl: FS_MANAGE_MENU_URL,
        ...metaExtra,
      },
      ...bundle,
    };
  }

  const tag = stamp();
  const rawPath = join(OUT_DIR, `raw-${tag}.json`);
  const snapPath = join(OUT_DIR, `snapshot-${tag}.json`);
  const latestRaw = join(OUT_DIR, "raw-latest.json");
  const latestSnap = join(OUT_DIR, "snapshot-latest.json");

  writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  writeFileSync(latestRaw, JSON.stringify(raw, null, 2));

  const snapshot = normalizeFoodstoryRaw(raw);
  const issues = validateSnapshot(snapshot);
  const summary = summarizeSnapshot(snapshot);

  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  writeFileSync(latestSnap, JSON.stringify(snapshot, null, 2));

  console.log("=== FoodStory menu capture (Phase 0) ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("raw:", rawPath);
  console.log("snapshot:", snapPath);
  console.log("latest:", latestSnap);
  if (issues.length) {
    console.warn("คำเตือน validation:");
    for (const issue of issues.slice(0, 30)) console.warn(" -", issue);
    if (issues.length > 30) console.warn(` - …อีก ${issues.length - 30} รายการ`);
  }
  console.log("ขั้นถัดไป (Phase 1): apply snapshot → Firestore POS Web");
}

main().catch((err) => {
  console.error("capture ล้มเหลว:", err.message || err);
  if (err.status) console.error("status", err.status, err.body);
  process.exit(1);
});
