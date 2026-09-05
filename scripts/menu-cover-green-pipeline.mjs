/**
 * Pipeline สำรองรูปหน้าปกโทนเขียว (ยังไม่แนบ POS จนกว่าจะสั่ง)
 *
 * โฟลเดอร์:
 *   - ต้นฉบับ Drive: เมนูแยก / Signature·ชานม·ฯลฯ
 *   - สำรองผลงาน: เมนูแยก / telltea-โทนเขียว  (per-SKU: v1/v2 candidates)
 *   - ใน repo: public/menu-covers + scripts/data/menu-covers-import/telltea-green
 *
 * ใช้งาน:
 *   node scripts/menu-cover-green-pipeline.mjs --status
 *   node scripts/menu-cover-green-pipeline.mjs --list-drive
 *   node scripts/menu-cover-green-pipeline.mjs --compare --sku=SD_04
 *   node scripts/menu-cover-green-pipeline.mjs --set-main --sku=SD_04 --version=v2
 *   node scripts/menu-cover-green-pipeline.mjs --apply-pos --sku=SD_04          # dry-run
 *   node scripts/menu-cover-green-pipeline.mjs --apply-pos --sku=SD_04 --apply  # write Firestore
 *   node scripts/menu-cover-green-pipeline.mjs --export-master --in=... --out=...
 *
 * ต้องการ: gcloud auth login yohaken@gmail.com (scope Drive)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import sharp from "sharp";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { getSeedDb } from "./lib/pos-firebase-seed.mjs";
import { normKey, normLoose } from "./lib/menu-image-match.mjs";
import { fileToMenuImageDataUrl, MENU_SQUARE_PX } from "./lib/menu-image-process.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const BACKUP_DIR = join(ROOT, "public/menu-covers/backup");
const GREEN_DIR = join(ROOT, "scripts/data/menu-covers-import/telltea-green");
const PUB_DIR = join(ROOT, "public/menu-covers");
const INDEX_PATH = join(GREEN_DIR, "index.json");
/** Working master during iteration (≤2k). Upscale later only when shipping. */
const MASTER_PX = 2000;
const MASTER_W = MASTER_PX;
const MASTER_H = MASTER_PX;

/**
 * Cup logo proportion — canonical file lives in telltea-green/_formula/
 * Fallback defaults match measured SD_04 mark.
 */
function loadCupLogoSpec() {
  const p = join(GREEN_DIR, "_formula", "logo-cup-proportion.json");
  if (existsSync(p)) {
    const doc = JSON.parse(readFileSync(p, "utf8"));
    const s = doc.standard || {};
    return {
      widthOverFrame: s.widthOverFrame ?? 0.23,
      centerX: s.centerX ?? 0.5,
      topY: s.topY ?? 0.32,
      greenTone: s.greenTone ?? "#405B4A",
      widthOverCup: s.widthOverCup ?? 0.62,
      topOverCup: s.topOverCup ?? 0.26,
    };
  }
  return {
    widthOverFrame: 0.23,
    centerX: 0.5,
    topY: 0.32,
    greenTone: "#405B4A",
    widthOverCup: 0.62,
    topOverCup: 0.26,
  };
}

export const CUP_LOGO_SPEC = loadCupLogoSpec();

/**
 * Resize transparent logo PNG to cup standard and return { buffer, left, top, width, height }.
 * @param {string|Buffer} logoInput
 * @param {number} frameW
 * @param {number} frameH
 * @param {Partial<typeof CUP_LOGO_SPEC>} [override]
 */
export async function placeCupLogo(logoInput, frameW, frameH, override = {}) {
  const spec = { ...CUP_LOGO_SPEC, ...override };
  const targetW = Math.round(frameW * spec.widthOverFrame);
  const buffer = await sharp(logoInput)
    .resize({ width: targetW, fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const width = meta.width || targetW;
  const height = meta.height || targetW;
  const left = Math.round(frameW * spec.centerX - width / 2);
  const top = Math.round(frameH * spec.topY);
  return { buffer, left, top, width, height, spec };
}

/**
 * Find the plastic cup, then return its box in 0–1 frame coords.
 * Primary: column occupancy of non-Feldgrau pixels (works when the drink contrasts).
 * Fallback: pair of vertical lid/wall edges — needed when the drink is the same green as the backdrop (SD_10).
 * Never treat "center of the whole image" as a successful cup.
 */
export async function detectCupBox(input) {
  const { data, info } = await sharp(input)
    .resize(400, 400, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const at = (x, y) => {
    const i = (y * W + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const FELD = [64, 91, 74];
  const isWallGreen = (p) => {
    const dF = dist(p, FELD);
    const greenish = p[1] > p[0] && p[1] >= p[2] - 12;
    return dF < 58 || (greenish && p[0] < 155 && dF < 130 && p[1] - p[0] >= 5);
  };
  const lumAt = (x, y) => lum(at(x, y));

  const y0 = Math.round(H * 0.22);
  const y1 = Math.round(H * 0.58);
  const band = y1 - y0 + 1;
  const col = new Array(W).fill(0);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W; x++) {
      if (!isWallGreen(at(x, y))) col[x] += 1;
    }
  }
  const smooth = new Array(W).fill(0);
  for (let x = 0; x < W; x++) {
    let s = 0;
    let n = 0;
    for (let k = -3; k <= 3; k++) {
      const xx = x + k;
      if (xx >= 0 && xx < W) {
        s += col[xx];
        n += 1;
      }
    }
    smooth[x] = s / n;
  }
  const need = band * 0.38;
  const runs = [];
  let runStart = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && smooth[x] >= need;
    if (on && runStart < 0) runStart = x;
    if (!on && runStart >= 0) {
      runs.push({ L: runStart, R: x - 1 });
      runStart = -1;
    }
  }
  const scored = runs
    .map((r) => {
      const w = (r.R - r.L + 1) / W;
      const cx = (r.L + r.R) / 2 / W;
      let occ = 0;
      for (let x = r.L; x <= r.R; x++) occ += smooth[x];
      occ /= (r.R - r.L + 1) * band;
      const centerBias = 1 - Math.abs(cx - 0.51) * 1.6;
      return { ...r, w, cx, score: occ * Math.max(0.1, centerBias) };
    })
    .filter((r) => r.w >= 0.22 && r.w <= 0.40 && r.cx >= 0.42 && r.cx <= 0.62)
    .sort((a, b) => b.score - a.score);

  const verticalExtent = (Lpx, Rpx) => {
    const cupNeed = Math.round((Rpx - Lpx + 1) * 0.35);
    let top = y0 / H;
    for (let y = Math.round(H * 0.06); y < y0; y++) {
      let n = 0;
      for (let x = Lpx; x <= Rpx; x++) {
        if (!isWallGreen(at(x, y))) n += 1;
      }
      if (n >= cupNeed) {
        top = y / H;
        break;
      }
    }
    let bottom = y1 / H;
    const yMax = Math.round(H * 0.78);
    for (let y = y1; y < yMax; y++) {
      let n = 0;
      for (let x = Lpx; x <= Rpx; x++) {
        if (!isWallGreen(at(x, y))) n += 1;
      }
      if (n >= cupNeed) bottom = y / H;
      else break;
    }
    return { top, bottom };
  };

  const boxFromLR = (left, right, method) => {
    const Lpx = Math.round(left * W);
    const Rpx = Math.round(right * W);
    const { top, bottom } = verticalExtent(Lpx, Rpx);
    return {
      left,
      right,
      top,
      bottom,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
      failed: false,
      method,
    };
  };

  const lidCup = (() => {
    const energy = new Array(W).fill(0);
    const yLid0 = Math.round(H * 0.1);
    const yLid1 = Math.round(H * 0.24);
    for (let y = yLid0; y <= yLid1; y++) {
      for (let x = 2; x < W - 2; x++) {
        const g = Math.abs(lumAt(x + 2, y) - lumAt(x - 2, y));
        if (g > 16) energy[x] += g;
      }
    }
    const sm = energy.map((_, x) => {
      let s = 0;
      let n = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < W) {
          s += energy[xx];
          n += 1;
        }
      }
      return s / n;
    });
    const peaks = [];
    const xMin = Math.round(W * 0.28);
    const xMax = Math.round(W * 0.74);
    for (let x = xMin; x < xMax; x++) {
      if (sm[x] > sm[x - 1] && sm[x] >= sm[x + 1] && sm[x] > sm[x - 2]) {
        peaks.push({ x, e: sm[x] });
      }
    }
    peaks.sort((a, b) => b.e - a.e);
    const top = peaks.slice(0, 10);
    let best = null;
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const L = Math.min(top[i].x, top[j].x);
        const R = Math.max(top[i].x, top[j].x);
        const w = (R - L) / W;
        const cx = (L + R) / 2 / W;
        if (w < 0.24 || w > 0.4) continue;
        if (cx < 0.44 || cx > 0.6) continue;
        const balance = Math.min(top[i].e, top[j].e) / Math.max(top[i].e, top[j].e);
        const score = (top[i].e + top[j].e) * (0.4 + balance);
        if (!best || score > best.score) best = { L, R, w, cx, score };
      }
    }
    if (!best) return null;
    return boxFromLR(best.L / W, best.R / W, "lid-edges");
  })();

  if (scored.length) {
    const occ = boxFromLR(scored[0].L / W, scored[0].R / W, "occupancy");
    const occLooksLikeSplash =
      lidCup && Math.abs(occ.cx - lidCup.cx) > 0.08 && Math.abs(lidCup.cx - 0.51) < Math.abs(occ.cx - 0.51);
    if (!occLooksLikeSplash) return occ;
  }

  if (lidCup) return lidCup;

  return {
    left: 0.34,
    right: 0.66,
    top: 0.14,
    bottom: 0.76,
    cx: 0.5,
    cy: 0.45,
    width: 0.32,
    height: 0.62,
    failed: true,
    method: "fallback-failed",
  };
}

/**
 * Place logo at the CENTER of the detected cup (both axes) — never the frame center.
 */
export async function placeCupLogoOnCup(logoInput, frameW, frameH, cup, override = {}) {
  const spec = { ...CUP_LOGO_SPEC, ...override };
  const cupWpx = frameW * cup.width;
  const widthOverCup = spec.widthOverCup ?? spec.widthOverFrame / Math.max(cup.width, 0.28);
  const targetW = Math.round(cupWpx * Math.min(0.78, Math.max(0.48, widthOverCup)));
  const buffer = await sharp(logoInput)
    .resize({ width: targetW, fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const width = meta.width || targetW;
  const height = meta.height || targetW;
  const padX = Math.round(cupWpx * 0.08);
  const padY = Math.round(frameH * cup.height * 0.08);
  const cupLeft = Math.round(frameW * cup.left) + padX;
  const cupRight = Math.round(frameW * cup.right) - padX;
  const cupTop = Math.round(frameH * cup.top) + padY;
  const cupBottom = Math.round(frameH * cup.bottom) - padY;
  const cx = frameW * cup.cx;
  const cy = frameH * cup.cy;
  let left = Math.round(cx - width / 2);
  let top = Math.round(cy - height / 2);
  if (left < cupLeft) left = cupLeft;
  if (left + width > cupRight) left = Math.max(cupLeft, cupRight - width);
  if (top < cupTop) top = cupTop;
  if (top + height > cupBottom) top = Math.max(cupTop, cupBottom - height);
  return { buffer, left, top, width, height, spec, cup };
}

/** โฟลเดอร์ Drive เมนูแยก */
export const DRIVE_MENU_ROOT_ID = "1BsCu0BzGY2DwMti3VYzEJ-p9HQoGLNky";
/** โฟลเดอร์สำรองโทนเขียว */
export const DRIVE_GREEN_FOLDER_ID = "1dChZwVd9nms-xHaViZo6E8-bdqHN7sLz";

/** Source folders on เมนูแยก (original library — may still have count suffixes on Drive). */
const SOURCE_GROUP_FOLDERS = {
  "0% แคล": "1qUOSflmNfWVf2rnfxDkqUuhaFGzkoTQC",
  "Fruit tea": "1X9nGNDVR6z8bAUeJB4_WoG9oiH9dY3r_",
  "Signature Drinks": "1SFBFbuCJPEq8w3fd81-Qj7rL3oVh1Zw0",
  กาแฟ: "1pk6duwhyi7Q74hv_yh6wrDRPSeobneOb",
  กาแฟสด: "1MSy3hRv_bFiXgj_XtkhWM6LxYfgT5-RP",
  ชา: "13xlDlrLXDl1TetjRN4iVvefywjfa1UPP",
  ชานม: "11M0BINhGr02LW4O9y0dBaYqupqJ1Lif4",
  โซดา: "1zYsyu1hfJHVjlJd3qtx7wktuQzm1AspZ",
  นมสด: "1IVUjuYJKKIcJUo-zBaNdnjp4RLqy7A32",
};

/** Green output group names (no count suffixes) — load ids from drive-subfolder-ids.json when present. */
function loadGreenGroupFolders() {
  const mapPath = join(GREEN_DIR, "drive-subfolder-ids.json");
  if (existsSync(mapPath)) {
    const doc = JSON.parse(readFileSync(mapPath, "utf8"));
    return doc.folders || {};
  }
  return {};
}

function token() {
  return execSync("gcloud auth print-access-token --account=yohaken@gmail.com", {
    encoding: "utf8",
  }).trim();
}

async function driveGet(path, query = "") {
  const url = `https://www.googleapis.com/drive/v3${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

async function drivePatch(fileId, body) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,description`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive PATCH ${res.status}: ${await res.text()}`);
  return res.json();
}

async function driveUploadJson(localPath, parentId, name = "index.json") {
  const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and trashed=false`);
  const listed = await driveGet("/files", `q=${q}&fields=files(id)`);
  let fid = listed.files?.[0]?.id;
  if (!fid) {
    const created = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    });
    if (!created.ok) throw new Error(`Drive create ${created.status}: ${await created.text()}`);
    fid = (await created.json()).id;
  }
  const buf = readFileSync(localPath);
  const up = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media&fields=id,name,webViewLink`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: buf,
    },
  );
  if (!up.ok) throw new Error(`Drive upload ${up.status}: ${await up.text()}`);
  return up.json();
}

async function listFolder(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,size,imageMediaMetadata)");
  return driveGet("/files", `q=${q}&fields=${fields}&pageSize=200`);
}

function argValue(args, key) {
  const hit = args.find((a) => a.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : null;
}

function loadIndex() {
  if (!existsSync(INDEX_PATH)) {
    return {
      version: 2,
      purpose: "menu-cover-candidates-green-tone",
      folder: "telltea-โทนเขียว",
      driveFolderId: DRIVE_GREEN_FOLDER_ID,
      formula: "_formula/logo-cup-proportion.json",
      assets: "_assets/",
      items: [],
    };
  }
  return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
}

function saveIndex(index) {
  index.updatedAt = new Date().toISOString();
  const text = `${JSON.stringify(index, null, 2)}\n`;
  writeFileSync(INDEX_PATH, text);
  mkdirSync(PUB_DIR, { recursive: true });
  writeFileSync(join(PUB_DIR, "index.json"), text);
}

function findIndexItem(index, sku) {
  const item = (index.items || []).find((it) => String(it.sku).toUpperCase() === String(sku).toUpperCase());
  if (!item) throw new Error(`ไม่พบ SKU ใน index.json: ${sku}`);
  return item;
}

function resolveCandidatePath(candidate) {
  if (!candidate?.file) return null;
  const abs = join(GREEN_DIR, candidate.file);
  return existsSync(abs) ? abs : null;
}

/**
 * Export JPEG master (default ≤2k). Pass --hires for 3567 later if needed.
 */
async function exportMaster(inputPath, outputPath, size = MASTER_PX) {
  mkdirSync(dirname(outputPath), { recursive: true });
  await sharp(inputPath)
    .resize(size, size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  const meta = await sharp(outputPath).metadata();
  return { width: meta.width, height: meta.height, path: outputPath };
}

/**
 * Composite exact transparent logo onto a cleared cup base using CUP_LOGO_SPEC.
 */
async function compositeCupLogo(basePath, logoPath, outputPath) {
  const baseBuf = await sharp(basePath)
    .resize(MASTER_PX, MASTER_PX, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const cup = await detectCupBox(baseBuf);
  const placed = await placeCupLogoOnCup(logoPath, MASTER_PX, MASTER_PX, cup);
  mkdirSync(dirname(outputPath), { recursive: true });
  await sharp(baseBuf)
    .composite([{ input: placed.buffer, left: placed.left, top: placed.top }])
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  return { ...placed, cup };
}

function loadManifest() {
  const p = join(BACKUP_DIR, "manifest.json");
  if (!existsSync(p)) return { version: 1, items: [] };
  return JSON.parse(readFileSync(p, "utf8"));
}

function printStatus() {
  const index = loadIndex();
  const m = loadManifest();
  console.log("=== menu-cover green pipeline (candidates → POS on order) ===");
  console.log(`green import: ${GREEN_DIR}`);
  console.log(`index: ${INDEX_PATH}`);
  console.log(`Drive green: ${DRIVE_GREEN_FOLDER_ID}`);
  console.log(`master size: ${MASTER_W}×${MASTER_H} (iteration cap ≤2k)`);
  console.log(
    `cup logo: width=${CUP_LOGO_SPEC.widthOverFrame}·frame · topY=${CUP_LOGO_SPEC.topY} · green=${CUP_LOGO_SPEC.greenTone}`,
  );
  console.log(`registry items: ${(index.items || []).length}`);
  for (const it of index.items || []) {
    const versions = Object.keys(it.candidates || {}).join(",");
    console.log(
      ` - ${it.sku} ${it.displayName || it.posName} · candidates=[${versions}] · main=${it.main ?? "null"} · posAttached=${Boolean(it.posAttached)}`,
    );
  }
  if (m.items?.length) {
    console.log(`\nlegacy backup manifest items: ${m.items.length}`);
  }
  console.log("\nยังไม่แนบ POS จนกว่าจะ --apply-pos --apply (หรือสั่งในแชท)");
}

async function listDriveGroups() {
  console.log("=== Drive green output (telltea-โทนเขียว) ===");
  const greenFolders = loadGreenGroupFolders();
  for (const [name, id] of Object.entries(greenFolders)) {
    if (!id || name.startsWith("_")) continue;
    const data = await listFolder(id);
    const files = (data.files || []).filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
    const folders = (data.files || []).filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    console.log(`\n${name} (skuFolders=${folders.length} · looseFiles=${files.length})`);
    for (const f of folders) console.log(`  📁 ${f.name}`);
    for (const f of files) console.log(`  ${f.name}  ${f.size || ""}`);
  }
  console.log("\n=== source library refs (เมนูแยก) ===");
  for (const name of Object.keys(SOURCE_GROUP_FOLDERS)) {
    console.log(`  ${name}`);
  }
}

function printCompare(sku) {
  const index = loadIndex();
  const item = findIndexItem(index, sku);
  console.log(`=== compare ${item.sku} · ${item.posName} ===`);
  console.log(`main: ${item.main ?? "null"} · posAttached: ${Boolean(item.posAttached)}`);
  for (const [ver, cand] of Object.entries(item.candidates || {})) {
    const local = resolveCandidatePath(cand);
    console.log(`\n${ver}:`);
    console.log(`  file: ${cand.file}`);
    console.log(`  local: ${local || "(missing)"}`);
    console.log(`  drive: ${cand.webViewLink || `https://drive.google.com/file/d/${cand.driveFileId}/view`}`);
  }
}

async function setMain(sku, version) {
  const ver = String(version || "").toLowerCase();
  if (!/^v\d+$/.test(ver)) {
    throw new Error(`--version ต้องเป็น v1/v2/... ได้: ${version}`);
  }
  const index = loadIndex();
  const item = findIndexItem(index, sku);
  const cand = item.candidates?.[ver];
  if (!cand) throw new Error(`${item.sku} ไม่มี candidate ${ver}`);
  const local = resolveCandidatePath(cand);
  if (!local) throw new Error(`ไฟล์ local หาย: ${cand.file}`);

  item.main = ver;
  // choosing a new main clears attached flag until apply-pos
  item.posAttached = false;
  saveIndex(index);

  // mark Drive description on chosen file (best-effort)
  if (cand.driveFileId) {
    try {
      await drivePatch(cand.driveFileId, {
        description: `telltea-main=${ver} sku=${item.sku} posName=${item.posName}`,
      });
    } catch (err) {
      console.warn(`Drive description skip: ${err.message}`);
    }
  }

  try {
    await driveUploadJson(INDEX_PATH, index.driveFolderId || DRIVE_GREEN_FOLDER_ID);
  } catch (err) {
    console.warn(`Drive index upload skip: ${err.message}`);
  }

  console.log(`set-main ${item.sku} → ${ver}`);
  console.log(`  file: ${cand.file}`);
  console.log(`  drive: ${cand.webViewLink || cand.driveFileId}`);
  console.log("  (ยังไม่เขียน POS — ใช้ --apply-pos เมื่อพร้อม)");
}

function matchPosItem(posName, menuItems) {
  const nk = normKey(posName);
  const nl = normLoose(posName);
  const exact = menuItems.find((it) => normKey(it.name) === nk);
  if (exact) return { item: exact, method: "exact" };
  const loose = menuItems.find((it) => normLoose(it.name) === nl);
  if (loose) return { item: loose, method: "loose" };
  return null;
}

async function loadPosMenuItems() {
  const db = await getSeedDb();
  const snap = await getDocs(collection(db, "menuItems"));
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name,
    imageUrl: d.data().imageUrl || null,
  }));
}

/**
 * Apply index.main cover → menuItems.imageUrl (480 JPEG data URL).
 * Default dry-run unless --apply.
 */
async function applyPos(sku, doApply) {
  const index = loadIndex();
  const item = findIndexItem(index, sku);
  if (!item.main) {
    throw new Error(`${item.sku} ยังไม่ตั้ง main — รัน --set-main --sku=${sku} --version=v1|v2 ก่อน`);
  }
  const cand = item.candidates?.[item.main];
  if (!cand) throw new Error(`${item.sku} main=${item.main} ไม่มีไฟล์ใน candidates`);
  const local = resolveCandidatePath(cand);
  if (!local) throw new Error(`ไฟล์ local หาย: ${cand.file}`);

  console.log(`=== apply-pos ${item.sku} (${doApply ? "APPLY" : "dry-run"}) ===`);
  console.log(`main: ${item.main}`);
  console.log(`file: ${local}`);
  console.log(`target POS name: ${item.posName}`);
  console.log(`encode: ${MENU_SQUARE_PX}×${MENU_SQUARE_PX} JPEG data URL`);

  const menuItems = await loadPosMenuItems();
  const hit = matchPosItem(item.posName, menuItems);
  if (!hit) {
    throw new Error(`ไม่พบ menuItems ที่ชื่อตรงกับ「${item.posName}」`);
  }
  console.log(`matched: ${hit.item.name} (${hit.method}) id=${hit.item.id}`);
  console.log(`hasExistingImage: ${Boolean(hit.item.imageUrl)}`);

  if (!doApply) {
    // still encode once to prove pipeline size
    const dataUrl = await fileToMenuImageDataUrl(local);
    console.log(`dry-run encode ok · chars=${dataUrl.length}`);
    console.log("ไม่เขียน Firestore — ใส่ --apply เมื่อสั่งใช้ใบนี้ไปเมน");
    return { dryRun: true, item, hit, chars: dataUrl.length };
  }

  const dataUrl = await fileToMenuImageDataUrl(local);
  const db = await getSeedDb();
  await updateDoc(doc(db, "menuItems", hit.item.id), {
    imageUrl: dataUrl,
    updatedAt: Date.now(),
  });

  item.posAttached = true;
  item.posItemId = hit.item.id;
  saveIndex(index);
  try {
    await driveUploadJson(INDEX_PATH, index.driveFolderId || DRIVE_GREEN_FOLDER_ID);
  } catch (err) {
    console.warn(`Drive index upload skip: ${err.message}`);
  }

  console.log(`applied → menuItems/${hit.item.id}.imageUrl (${dataUrl.length} chars)`);
  return { dryRun: false, item, hit, chars: dataUrl.length };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--status") || args.length === 0) {
    printStatus();
    return;
  }
  if (args.includes("--list-drive")) {
    await listDriveGroups();
    return;
  }
  if (args.includes("--compare")) {
    const sku = argValue(args, "--sku");
    if (!sku) {
      console.error("ต้องมี --sku=SD_04");
      process.exit(1);
    }
    printCompare(sku);
    return;
  }
  if (args.includes("--set-main")) {
    const sku = argValue(args, "--sku");
    const version = argValue(args, "--version");
    if (!sku || !version) {
      console.error("ต้องมี --sku=SD_04 --version=v1|v2");
      process.exit(1);
    }
    await setMain(sku, version);
    return;
  }
  if (args.includes("--apply-pos")) {
    const sku = argValue(args, "--sku");
    if (!sku) {
      console.error("ต้องมี --sku=SD_04");
      process.exit(1);
    }
    const doApply = args.includes("--apply");
    await applyPos(sku, doApply);
    return;
  }
  if (args.includes("--export-master")) {
    const inArg = args.find((a) => a.startsWith("--in="));
    const outArg = args.find((a) => a.startsWith("--out="));
    if (!inArg || !outArg) {
      console.error("ต้องมี --in=path --out=path");
      process.exit(1);
    }
    const size = args.includes("--hires") ? 3567 : MASTER_PX;
    const result = await exportMaster(inArg.slice(5), outArg.slice(6), size);
    console.log(result);
    return;
  }
  if (args.includes("--composite-logo")) {
    const inArg = args.find((a) => a.startsWith("--in="));
    const logoArg = args.find((a) => a.startsWith("--logo="));
    const outArg = args.find((a) => a.startsWith("--out="));
    if (!inArg || !outArg) {
      console.error("ต้องมี --in=base --out=path [--logo=png]");
      process.exit(1);
    }
    const logoPath =
      logoArg?.slice(7) || join(GREEN_DIR, "_assets", "tell-tea-logo-white-transparent.png");
    const placed = await compositeCupLogo(inArg.slice(5), logoPath, outArg.slice(6));
    console.log(placed);
    return;
  }
  console.error(
    "flags: --status | --list-drive | --compare --sku= | --set-main --sku= --version= | --apply-pos --sku= [--apply] | --export-master --in= --out= [--hires] | --composite-logo --in= --out= [--logo=]",
  );
  process.exit(1);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
