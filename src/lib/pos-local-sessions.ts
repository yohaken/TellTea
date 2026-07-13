/** ประวัติรอบขายที่ปิดแล้ว — เก็บบนเครื่อง (POS อ่าน list posSessions จาก Firestore ไม่ได้) */
import type { PosSession } from "./types";

export type PosLocalSessionRecord = PosSession & {
  closedAt: number;
  cashTotal: number;
  promptpayTotal: number;
};

const KEY = "telltea-pos-local-sessions";
const MAX = 50;
const HISTORY_DAYS = 7;

function readAll(): PosLocalSessionRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PosLocalSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PosLocalSessionRecord[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
}

export function saveLocalClosedSession(record: PosLocalSessionRecord) {
  const all = readAll().filter((r) => r.id !== record.id);
  all.push(record);
  writeAll(all);
}

export function listLocalSessionsForDevice(deviceId: string, days = HISTORY_DAYS): PosLocalSessionRecord[] {
  const cutoff = Date.now() - days * 86_400_000;
  return readAll()
    .filter((r) => r.deviceId === deviceId && r.closedAt >= cutoff)
    .sort((a, b) => b.closedAt - a.closedAt);
}
