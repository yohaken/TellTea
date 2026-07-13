/**
 * นำเข้ารูปเมนู POS จาก FoodStory export (manifest + images/)
 *
 *   npm run seed:pos-menu-images -- --dry-run
 *   npm run seed:pos-menu-images -- --apply
 *   npm run seed:pos-menu-images -- --apply --skip-existing
 *
 * ข้อมูลอยู่ที่ scripts/data/menu-images-import/foodstory-menu-images-20260713/
 * (ไม่ commit ZIP — ดาวน์โหลดจาก Drive แล้วแตกไฟล์ในเครื่อง)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { matchManifestRow } from "./lib/menu-image-match.mjs";
import { fileToMenuImageDataUrl } from "./lib/menu-image-process.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMPORT_DIR = join(__dir, "data/menu-images-import/foodstory-menu-images-20260713");

const APPLY = process.argv.includes("--apply");
const DRY = process.argv.includes("--dry-run") || !APPLY;
const SKIP_EXISTING = process.argv.includes("--skip-existing");
const USE_ADMIN = process.argv.includes("--admin") || Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";

const importDirArg = process.argv.find((a) => a.startsWith("--dir="));
const IMPORT_DIR = importDirArg ? importDirArg.slice("--dir=".length) : DEFAULT_IMPORT_DIR;

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw?.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT สำหรับ --admin");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

function loadManifest() {
  const manifestPath = join(IMPORT_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`ไม่พบ manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function resolveImagePath(row) {
  const rel = row.download?.file;
  if (!rel) return null;
  const abs = join(IMPORT_DIR, rel);
  return existsSync(abs) ? abs : null;
}

async function loadMenuItems() {
  if (USE_ADMIN && loadCredentials()) {
    const db = getAdminDb();
    const snap = await db.collection("menuItems").get();
    return snap.docs.map((d) => ({
      id: d.id,
      name: d.data().name,
      imageUrl: d.data().imageUrl || null,
    }));
  }
  const db = await getSeedDb();
  const snap = await getDocs(collection(db, "menuItems"));
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name,
    imageUrl: d.data().imageUrl || null,
  }));
}

async function applyUpdates(updates) {
  if (!updates.length) return;

  if (USE_ADMIN && loadCredentials()) {
    const db = getAdminDb();
    let batch = db.batch();
    let ops = 0;
    for (const u of updates) {
      batch.update(db.collection("menuItems").doc(u.id), {
        imageUrl: u.imageUrl,
        updatedAt: Date.now(),
      });
      ops += 1;
      if (ops >= 5) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops) await batch.commit();
    return;
  }

  const db = await getSeedDb();
  let batch = writeBatch(db);
  let ops = 0;
  for (const u of updates) {
    batch.update(doc(db, "menuItems", u.id), {
      imageUrl: u.imageUrl,
      updatedAt: Date.now(),
    });
    ops += 1;
    if (ops >= 5) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops) await batch.commit();
}

async function main() {
  const manifest = loadManifest();
  const items = await loadMenuItems();
  const okManifest = manifest.items.filter((r) => r.download?.ok);

  console.log("=== POS menu image import (FoodStory) ===");
  console.log(`dir: ${IMPORT_DIR}`);
  console.log(`manifest: ${manifest.totalRecords} records · downloaded ${manifest.downloaded}`);
  console.log(`Firestore menuItems: ${items.length}`);
  console.log(`mode: ${DRY ? "dry-run" : "apply"}${SKIP_EXISTING ? " · skip-existing" : ""}`);

  const matched = [];
  const unmatched = [];
  const skipped = [];
  const errors = [];

  for (const it of items) {
    if (SKIP_EXISTING && it.imageUrl) {
      skipped.push({ name: it.name, reason: "has-image" });
      continue;
    }

    const hit = matchManifestRow(it.name, manifest.items);
    if (!hit) {
      unmatched.push(it.name);
      continue;
    }

    const imagePath = resolveImagePath(hit.row);
    if (!imagePath) {
      errors.push({ name: it.name, error: `ไม่พบไฟล์: ${hit.row.download?.file}` });
      continue;
    }

    try {
      const dataUrl = DRY ? null : await fileToMenuImageDataUrl(imagePath);
      matched.push({
        id: it.id,
        name: it.name,
        manifestName: hit.row.name,
        method: hit.method,
        file: hit.row.download.file,
        imageUrl: dataUrl,
        chars: dataUrl ? dataUrl.length : null,
      });
    } catch (err) {
      errors.push({ name: it.name, error: err.message });
    }
  }

  const byMethod = {};
  for (const m of matched) {
    byMethod[m.method] = (byMethod[m.method] || 0) + 1;
  }

  console.log("\n--- summary ---");
  console.log(`matched: ${matched.length}`);
  console.log(`  by method: ${JSON.stringify(byMethod)}`);
  console.log(`unmatched: ${unmatched.length}`);
  if (unmatched.length) {
    console.log("  items:", unmatched.join("\n         "));
  }
  console.log(`skipped: ${skipped.length}`);
  console.log(`errors: ${errors.length}`);
  if (errors.length) errors.forEach((e) => console.log(`  - ${e.name}: ${e.error}`));

  const usedManifestIds = new Set(matched.map((m) => m.file));
  const orphanImages = okManifest.filter((r) => !usedManifestIds.has(r.download.file));
  if (orphanImages.length) {
    console.log(`orphan manifest images (not matched): ${orphanImages.length}`);
    orphanImages.slice(0, 5).forEach((r) => console.log(`  - ${r.name}`));
  }

  if (DRY) {
    console.log("\nOK dry-run — ใช้ --apply เพื่อเขียน Firestore");
    if (matched.length) {
      console.log("\nตัวอย่างจับคู่:");
      matched.slice(0, 8).forEach((m) => {
        console.log(`  [${m.method}] ${m.name}`);
        console.log(`       ← ${m.manifestName}`);
      });
    }
    return;
  }

  const updates = matched.filter((m) => m.imageUrl).map((m) => ({ id: m.id, imageUrl: m.imageUrl }));
  console.log(`\nเขียน Firestore: ${updates.length} docs...`);
  await applyUpdates(updates);
  console.log("\nOK seed-pos-menu-images applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  });
