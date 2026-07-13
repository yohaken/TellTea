import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { startOfLocalDay } from "./utils";

export type CheckShiftId = "late" | "morning" | "evening";

export const CHECK_SHIFTS: { id: CheckShiftId; label: string }[] = [
  { id: "late", label: "ดึก 0.3–7" },
  { id: "morning", label: "เช้า 7–17" },
  { id: "evening", label: "เย็น 17–0.3" },
];

export type CheckStatus = "pass" | "fail";

/** Template row — owner can add/edit/reorder */
export type ChecklistItem = {
  id: string;
  name: string;
  groupLabel: string;
  sortOrder: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Vertical record row — one doc per item per submission batch */
export type ChecklistRecord = {
  id: string;
  checkId: string;
  date: number;
  shift: CheckShiftId;
  inspector: string;
  inspectorId: string;
  itemId: string;
  itemName: string;
  status: CheckStatus;
  remark: string;
  imageUrl: string;
  submittedAt: number;
  createdBy: string;
  createdAt: number;
};

export type ChecklistRecordInput = {
  checkId: string;
  date: number;
  shift: CheckShiftId;
  inspector: string;
  inspectorId: string;
  itemId: string;
  itemName: string;
  status: CheckStatus;
  remark?: string;
  imageUrl?: string;
  submittedAt: number;
  createdBy: string;
};

export type CheckSessionSummary = {
  checkId: string;
  date: number;
  shift: CheckShiftId;
  inspector: string;
  submittedAt: number;
  total: number;
  passed: number;
  failed: number;
  failRecords: ChecklistRecord[];
};

export const DEFAULT_CHECKLIST_ITEMS: { name: string; groupLabel: string }[] = [
  { name: "กลุ่มเบสนม", groupLabel: "วัตถุดิบหลัก" },
  { name: "กลุ่มเบสชา", groupLabel: "วัตถุดิบหลัก" },
  { name: "ครีมชีส", groupLabel: "วัตถุดิบหลัก" },
  { name: "ขนมปัง", groupLabel: "วัตถุดิบหลัก" },
  { name: "ไอศกรีม", groupLabel: "วัตถุดิบหลัก" },
  { name: "นมสด", groupLabel: "วัตถุดิบหลัก" },
  { name: "วัตถุดิบอื่น", groupLabel: "วัตถุดิบเสริม" },
  { name: "น้ำเต้าหู้", groupLabel: "วัตถุดิบเสริม" },
  { name: "น้ำมะพร้าว", groupLabel: "วัตถุดิบเสริม" },
  { name: "ท็อปปิ้งในตู้เย็น", groupLabel: "วัตถุดิบเสริม" },
  { name: "เครื่องไอศกรีม", groupLabel: "เครื่องจักร" },
  { name: "แอร์ ความเย็น", groupLabel: "สภาพร้าน" },
  { name: "กลิ่นภายในร้าน", groupLabel: "สภาพร้าน" },
  { name: "เปิดปิดเมนูตัวเลือกให้ถูกต้องทุกแอพ", groupLabel: "ระบบ/แอพ" },
  { name: "เครื่องกาแฟ ล้าง เช็ค ปรับปรุง", groupLabel: "เครื่องจักร" },
];

function itemsCol() {
  return collection(getDb(), "checklistItems");
}

function recordsCol() {
  return collection(getDb(), "checklistRecords");
}

export function labelCheckShift(shift: CheckShiftId) {
  return CHECK_SHIFTS.find((s) => s.id === shift)?.label || shift;
}

export function labelCheckStatus(status: CheckStatus) {
  return status === "pass" ? "ผ่าน" : "ไม่ผ่าน";
}

export function newCheckId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normalize to local midnight — same key as OT / check form date picker */
export function normalizeCheckDateMs(ms: number) {
  return startOfLocalDay(new Date(ms));
}

function mapCheckRecordDoc(id: string, data: Record<string, unknown>): ChecklistRecord {
  return {
    id,
    ...(data as Omit<ChecklistRecord, "id">),
  };
}

function sessionFromSnapshotRows(docs: { id: string; data: () => Record<string, unknown> }[]) {
  if (!docs.length) return null;
  const rows = docs.map((d) => mapCheckRecordDoc(d.id, d.data()));
  const latestCheckId = rows[0]!.checkId;
  return buildSessionSummary(rows.filter((r) => r.checkId === latestCheckId));
}

export async function listChecklistItems(): Promise<ChecklistItem[]> {
  const snap = await getDocs(query(itemsCol(), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ChecklistItem, "id">),
  }));
}

export async function listActiveChecklistItems(): Promise<ChecklistItem[]> {
  return (await listChecklistItems()).filter((i) => i.active);
}

export async function seedChecklistItemsIfEmpty(): Promise<boolean> {
  const existing = await listChecklistItems();
  if (existing.length) return false;
  const now = Date.now();
  const batch = writeBatch(getDb());
  DEFAULT_CHECKLIST_ITEMS.forEach((item, idx) => {
    const ref = doc(itemsCol());
    batch.set(ref, {
      name: item.name,
      groupLabel: item.groupLabel,
      sortOrder: idx,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  await batch.commit();
  return true;
}

export async function addChecklistItem(name: string, groupLabel: string): Promise<string> {
  const n = name.trim();
  if (!n) throw new Error("ต้องใส่ชื่อรายการ");
  const items = await listChecklistItems();
  const now = Date.now();
  const ref = await addDoc(itemsCol(), {
    name: n,
    groupLabel: groupLabel.trim() || "ทั่วไป",
    sortOrder: items.length,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateChecklistItem(
  id: string,
  patch: Partial<Pick<ChecklistItem, "name" | "groupLabel" | "sortOrder" | "active">>,
): Promise<void> {
  const next: Record<string, string | number | boolean> = { updatedAt: Date.now() };
  if (patch.name != null) {
    const n = patch.name.trim();
    if (!n) throw new Error("ต้องใส่ชื่อรายการ");
    next.name = n;
  }
  if (patch.groupLabel != null) next.groupLabel = patch.groupLabel.trim() || "ทั่วไป";
  if (patch.sortOrder != null) next.sortOrder = patch.sortOrder;
  if (patch.active != null) next.active = patch.active;
  await updateDoc(doc(getDb(), "checklistItems", id), next);
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "checklistItems", id));
}

export function subscribeChecklistRecords(
  onRows: (rows: ChecklistRecord[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(recordsCol(), orderBy("submittedAt", "desc")),
    (snap) => {
      onRows(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ChecklistRecord, "id">),
        })),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getRecordsForDate(date: number): Promise<ChecklistRecord[]> {
  const snap = await getDocs(
    query(recordsCol(), where("date", "==", date), orderBy("submittedAt", "desc")),
  );
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ChecklistRecord, "id">),
  }));
}

export async function getSessionForShift(
  date: number,
  shift: CheckShiftId,
): Promise<CheckSessionSummary | null> {
  const dateMs = normalizeCheckDateMs(date);
  const snap = await getDocs(
    query(
      recordsCol(),
      where("date", "==", dateMs),
      where("shift", "==", shift),
      orderBy("submittedAt", "desc"),
    ),
  );
  return sessionFromSnapshotRows(snap.docs);
}

/** Live session for date×shift — used by OT ปิดกะ to skip duplicate SmartCheck */
export function subscribeCheckSessionForShift(
  date: number,
  shift: CheckShiftId,
  onSession: (session: CheckSessionSummary | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const dateMs = normalizeCheckDateMs(date);
  return onSnapshot(
    query(
      recordsCol(),
      where("date", "==", dateMs),
      where("shift", "==", shift),
      orderBy("submittedAt", "desc"),
    ),
    (snap) => onSession(sessionFromSnapshotRows(snap.docs)),
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function buildSessionSummary(rows: ChecklistRecord[]): CheckSessionSummary | null {
  if (!rows.length) return null;
  const first = rows[0]!;
  const failRecords = rows.filter((r) => r.status === "fail");
  return {
    checkId: first.checkId,
    date: first.date,
    shift: first.shift,
    inspector: first.inspector,
    submittedAt: first.submittedAt,
    total: rows.length,
    passed: rows.filter((r) => r.status === "pass").length,
    failed: failRecords.length,
    failRecords,
  };
}

export function groupRecordsBySession(rows: ChecklistRecord[]): CheckSessionSummary[] {
  const byCheck = new Map<string, ChecklistRecord[]>();
  for (const row of rows) {
    const list = byCheck.get(row.checkId) || [];
    list.push(row);
    byCheck.set(row.checkId, list);
  }
  return [...byCheck.values()]
    .map((group) => buildSessionSummary(group)!)
    .filter(Boolean)
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

export async function submitChecklistBatch(
  rows: ChecklistRecordInput[],
): Promise<string> {
  if (!rows.length) throw new Error("ไม่มีรายการตรวจ");
  const batch = writeBatch(getDb());
  const checkId = rows[0]!.checkId;
  for (const row of rows) {
    const ref = doc(recordsCol());
    batch.set(ref, {
      checkId: row.checkId,
      date: normalizeCheckDateMs(row.date),
      shift: row.shift,
      inspector: row.inspector,
      inspectorId: row.inspectorId,
      itemId: row.itemId,
      itemName: row.itemName,
      status: row.status,
      remark: (row.remark || "").trim(),
      imageUrl: row.imageUrl || "",
      submittedAt: row.submittedAt,
      createdBy: row.createdBy,
      createdAt: Date.now(),
    });
  }
  await batch.commit();
  return checkId;
}

export async function deleteCheckSession(checkId: string): Promise<void> {
  const snap = await getDocs(query(recordsCol(), where("checkId", "==", checkId)));
  const batch = writeBatch(getDb());
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/** Owner: wipe all checklist records (fresh start after CSV import). */
export async function deleteAllChecklistRecords(
  onProgress?: (done: number) => void,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await getDocs(
      query(recordsCol(), orderBy("createdAt", "asc"), limit(400)),
    );
    if (snap.empty) break;
    const batch = writeBatch(getDb());
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.docs.length;
    onProgress?.(deleted);
    if (snap.docs.length < 400) break;
  }
  return deleted;
}
