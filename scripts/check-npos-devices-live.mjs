/**
 * Live nPos on-site device / hardware dump (Admin SDK).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/check-npos-devices-live.mjs
 *
 * Writes JSON under /opt/cursor/artifacts/npos-onsite-devices/ (or OUT_DIR).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "mypeer-501909";
const ONLINE_MS = Number(process.env.POS_ONLINE_MS || 5 * 60 * 1000);
const OUT_DIR =
  process.env.OUT_DIR || "/opt/cursor/artifacts/npos-onsite-devices";

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_KEY;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  return undefined;
}

function getAdminDb() {
  if (!getApps().length) {
    const credentials = loadCredentials();
    if (!credentials) throw new Error("ต้องมี FIREBASE_SERVICE_ACCOUNT");
    initializeApp({ credential: cert(credentials), projectId: PROJECT });
  }
  return getFirestore();
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function ageMin(ts, now) {
  if (!ts) return null;
  return Number(((now - ts) / 60000).toFixed(1));
}

function summarizeHardware(items) {
  const list = Array.isArray(items) ? items : [];
  const byCat = { usb: [], bt: [], net: [], display: [], other: [] };
  for (const raw of list) {
    const o = raw && typeof raw === "object" ? raw : {};
    const cat = String(o.category || "other").toLowerCase();
    const row = {
      title: String(o.title || "—"),
      detail: String(o.detail || ""),
    };
    if (cat.includes("usb")) byCat.usb.push(row);
    else if (cat.includes("bt") || cat.includes("bluetooth")) byCat.bt.push(row);
    else if (cat.includes("net") || cat.includes("wifi") || cat.includes("ip"))
      byCat.net.push(row);
    else if (cat.includes("display") || cat.includes("จอ")) byCat.display.push(row);
    else byCat.other.push(row);
  }
  return byCat;
}

function equipmentGuess(device, diagnose) {
  const parts = [];
  parts.push("แท็บเล็ต Android (nPos)");
  if (device.printerReady) {
    parts.push(`ปริ้นเตอร์พร้อม (${device.printerLabel || "ตั้งค่าแล้ว"})`);
  } else if (device.printerLabel) {
    parts.push(`ปริ้นเตอร์ตั้งชื่อแล้ว แต่ยังไม่พร้อม (${device.printerLabel})`);
  } else {
    parts.push("ปริ้นเตอร์: ยังไม่เห็นจาก heartbeat");
  }
  const cd = device.customerDisplay || diagnose?.customerDisplay || "";
  if (cd === "ok") parts.push("จอลูกค้า: มี");
  else if (cd === "missing") parts.push("จอลูกค้า: ไม่มี/ไม่ต่อ");
  else if (cd) parts.push(`จอลูกค้า: ${cd}`);
  else parts.push("จอลูกค้า: ยังไม่ทราบ");

  const hw = summarizeHardware(diagnose?.hardware);
  if (hw.usb.length) parts.push(`USB ที่เห็น: ${hw.usb.length}`);
  if (hw.bt.length) parts.push(`BT paired: ${hw.bt.length}`);
  return parts;
}

async function main() {
  const db = getAdminDb();
  const now = Date.now();
  mkdirSync(OUT_DIR, { recursive: true });

  const [devSnap, diagSnap] = await Promise.all([
    db.collection("posDevices").get(),
    db.collection("nposDiagnose").get(),
  ]);

  const diagnoseById = new Map();
  for (const doc of diagSnap.docs) {
    const data = doc.data() || {};
    diagnoseById.set(doc.id, {
      id: doc.id,
      installId: typeof data.installId === "string" ? data.installId : doc.id,
      stableKey: typeof data.stableKey === "string" ? data.stableKey : "",
      reportedAt: toMs(data.reportedAt),
      versionCode: typeof data.versionCode === "number" ? data.versionCode : 0,
      versionName: typeof data.versionName === "string" ? data.versionName : "",
      summary: typeof data.summary === "string" ? data.summary : "",
      customerDisplay:
        typeof data.customerDisplay === "string" ? data.customerDisplay : "",
      isEmulator: data.isEmulator === true,
      deviceClass: typeof data.deviceClass === "string" ? data.deviceClass : "",
      disabled: data.disabled === true,
      blocked: data.blocked === true,
      displays: Array.isArray(data.displays) ? data.displays : [],
      hardware: Array.isArray(data.hardware) ? data.hardware : [],
      source: typeof data.source === "string" ? data.source : "",
    });
  }

  const devices = [];
  for (const doc of devSnap.docs) {
    const data = doc.data() || {};
    const lastSeenAt = toMs(data.lastSeenAt);
    const online = lastSeenAt > 0 && now - lastSeenAt <= ONLINE_MS;
    const diagnose = diagnoseById.get(doc.id) || null;
    const device = {
      id: doc.id,
      pairingCode:
        typeof data.pairingCode === "string"
          ? data.pairingCode
          : doc.id.replace(/-/g, "").slice(-6).toUpperCase(),
      label: typeof data.label === "string" ? data.label : "",
      deviceHint: typeof data.deviceHint === "string" ? data.deviceHint : "",
      appBuild: typeof data.appBuild === "number" ? data.appBuild : 0,
      userAgent: typeof data.userAgent === "string" ? data.userAgent : "",
      shellKind: typeof data.shellKind === "string" ? data.shellKind : "",
      lastSeenAt,
      lastSeenAgeMin: ageMin(lastSeenAt, now),
      online,
      disabled: data.disabled === true,
      blocked: data.blocked === true || data.deviceClass === "blocked",
      deviceClass: typeof data.deviceClass === "string" ? data.deviceClass : "",
      isEmulator: data.isEmulator === true,
      stableKey: typeof data.stableKey === "string" ? data.stableKey : "",
      storeClaimed: data.storeClaimed === true,
      printerReady: data.printerReady === true,
      printerLabel: typeof data.printerLabel === "string" ? data.printerLabel : "",
      customerDisplay:
        typeof data.customerDisplay === "string" ? data.customerDisplay : "",
      screenSize: typeof data.screenSize === "string" ? data.screenSize : "",
      permissionsOk: data.permissionsOk === true,
      permissionsStatus:
        typeof data.permissionsStatus === "string" ? data.permissionsStatus : "",
      diagnose,
      equipment: [],
    };
    device.equipment = equipmentGuess(device, diagnose);
    devices.push(device);
  }

  devices.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
  });

  const shop = devices.filter(
    (d) =>
      !d.disabled &&
      !d.blocked &&
      !d.isEmulator &&
      d.deviceClass !== "dev" &&
      !/sdk|emulator|generic|goldfish|ranchu/i.test(d.deviceHint || ""),
  );
  const onlineShop = shop.filter((d) => d.online);

  const report = {
    at: new Date().toISOString(),
    project: PROJECT,
    onlineWindowMin: ONLINE_MS / 60000,
    totals: {
      posDevices: devices.length,
      nposDiagnose: diagnoseById.size,
      shopLike: shop.length,
      onlineShop: onlineShop.length,
    },
    onlineShop,
    shop,
    all: devices,
  };

  writeFileSync(join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push(`# nPos on-site devices @ ${report.at}`);
  lines.push("");
  lines.push(
    `ทั้งหมด ${report.totals.posDevices} เครื่อง · แนวร้าน ${report.totals.shopLike} · ออนไลน์ ${report.totals.onlineShop}`,
  );
  lines.push("");
  const focus = onlineShop.length ? onlineShop : shop.slice(0, 10);
  if (!focus.length) {
    lines.push("_ไม่พบเครื่องร้านใน posDevices_");
  }
  for (const d of focus) {
    lines.push(`## ${d.label || d.deviceHint || d.pairingCode} · ${d.pairingCode}`);
    lines.push(`- รุ่น: ${d.deviceHint || "—"}`);
    lines.push(
      `- สถานะ: ${d.online ? "ออนไลน์" : "ออฟ"} · เห็นล่าสุด ${d.lastSeenAgeMin ?? "—"} นาทีก่อน`,
    );
    lines.push(`- แอป: build ${d.appBuild} · claim ${d.storeClaimed ? "yes" : "no"}`);
    lines.push(`- ปริ้น: ${d.printerReady ? "พร้อม" : "ไม่พร้อม"} · ${d.printerLabel || "—"}`);
    lines.push(`- จอลูกค้า: ${d.customerDisplay || "—"} · จอเครื่อง: ${d.screenSize || "—"}`);
    lines.push(`- สิทธิ์: ${d.permissionsStatus || (d.permissionsOk ? "ok" : "—")}`);
    lines.push(`- อุปกรณ์ที่สรุป: ${d.equipment.join(" · ")}`);
    if (d.diagnose) {
      const displays = Array.isArray(d.diagnose.displays) ? d.diagnose.displays : [];
      lines.push(
        `- diagnose: v${d.diagnose.versionName || "?"} (${d.diagnose.versionCode || 0}) · จอ ${displays.length} · ${d.diagnose.summary || ""}`,
      );
      for (const disp of displays) {
        const o = disp && typeof disp === "object" ? disp : {};
        lines.push(
          `  - จอ ${o.number ?? "?"} ${o.primary ? "(หลัก)" : ""} ${o.widthPx || "?"}×${o.heightPx || "?"} ${o.orientation || ""} dpi=${o.densityDpi || "?"} ${o.name || ""}`,
        );
      }
      const hw = summarizeHardware(d.diagnose.hardware);
      for (const row of [...hw.usb, ...hw.bt, ...hw.net].slice(0, 20)) {
        lines.push(`  - ${row.title}: ${row.detail}`);
      }
    } else {
      lines.push("- diagnose: ยังไม่มีรายงาน");
    }
    lines.push("");
  }

  const md = `${lines.join("\n")}\n`;
  writeFileSync(join(OUT_DIR, "summary.md"), md);
  console.log(md);
  console.log(`OK wrote ${join(OUT_DIR, "report.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
