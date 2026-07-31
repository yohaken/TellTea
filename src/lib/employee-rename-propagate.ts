/**
 * เปลี่ยนชื่อพนักงาน = คนเดิม (employeeId เดิม) — อัปเดตชื่อที่เก็บคู่ id ในระบบที่เกี่ยวข้อง
 * ไม่สร้าง id ใหม่
 */
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";

const BATCH_MAX = 400;

export function rewriteAlignedNames(
  ids: string[],
  names: string[],
  employeeId: string,
  newName: string,
  oldNames: string[] = [],
): string[] | null {
  const nextName = newName.trim();
  if (!nextName || !employeeId) return null;
  const oldSet = new Set(
    oldNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  if (ids.length) {
    let changed = false;
    const next = ids.map((id, i) => {
      const prev = String(names[i] ?? "").trim();
      if (id === employeeId) {
        if (prev !== nextName) changed = true;
        return nextName;
      }
      return prev;
    });
    return changed ? next : null;
  }

  // แถวเก่าไม่มี workerIds — แทนที่ชื่อเก่าตรงๆ
  if (!names.length || !oldSet.size) return null;
  let changed = false;
  const next = names.map((n) => {
    const t = String(n || "").trim();
    if (t && oldSet.has(t.toLowerCase())) {
      changed = true;
      return nextName;
    }
    return t;
  });
  return changed ? next : null;
}

async function commitNamePatches(
  patches: { ref: ReturnType<typeof doc>; names: string[]; field: string }[],
): Promise<number> {
  if (!patches.length) return 0;
  const db = getDb();
  let written = 0;
  for (let i = 0; i < patches.length; i += BATCH_MAX) {
    const chunk = patches.slice(i, i + BATCH_MAX);
    const batch = writeBatch(db);
    for (const p of chunk) {
      batch.update(p.ref, {
        [p.field]: p.names,
        updatedAt: Date.now(),
      });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

function patchAlignedDocs(
  docs: QueryDocumentSnapshot[],
  employeeId: string,
  newName: string,
  oldNames: string[],
  idField: string,
  nameField: string,
): { ref: ReturnType<typeof doc>; names: string[]; field: string }[] {
  const out: { ref: ReturnType<typeof doc>; names: string[]; field: string }[] = [];
  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    const ids = Array.isArray(data[idField]) ? (data[idField] as string[]) : [];
    const names = Array.isArray(data[nameField]) ? (data[nameField] as string[]) : [];
    if (ids.length && !ids.includes(employeeId)) continue;
    const next = rewriteAlignedNames(ids, names, employeeId, newName, oldNames);
    if (!next) continue;
    out.push({ ref: d.ref, names: next, field: nameField });
  }
  return out;
}

async function rewriteCollectionByArrayContains(input: {
  collectionName: string;
  employeeId: string;
  newName: string;
  oldNames: string[];
  idField: string;
  nameField: string;
}): Promise<number> {
  const q = query(
    collection(getDb(), input.collectionName),
    where(input.idField, "array-contains", input.employeeId),
  );
  const snap = await getDocs(q);
  const patches = patchAlignedDocs(
    snap.docs,
    input.employeeId,
    input.newName,
    input.oldNames,
    input.idField,
    input.nameField,
  );
  return commitNamePatches(patches);
}

async function rewritePayrollEmployeeName(
  employeeId: string,
  newName: string,
): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), "payrollItems"), where("employeeId", "==", employeeId)),
  );
  const db = getDb();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_MAX) {
    const chunk = snap.docs.slice(i, i + BATCH_MAX);
    const batch = writeBatch(db);
    let batchCount = 0;
    for (const d of chunk) {
      const cur = String((d.data() as { employeeName?: string }).employeeName || "").trim();
      if (cur === newName) continue;
      batch.update(d.ref, { employeeName: newName, updatedAt: Date.now() });
      batchCount += 1;
    }
    if (batchCount) {
      await batch.commit();
      n += batchCount;
    }
  }
  return n;
}

async function rewriteBonusCloseNames(
  employeeId: string,
  newName: string,
): Promise<number> {
  const db = getDb();
  let n = 0;

  // รายคน
  const personal = await getDocs(
    query(
      collection(db, "bonusPersonalCloses"),
      where("employeeId", "==", employeeId),
    ),
  );
  for (let i = 0; i < personal.docs.length; i += BATCH_MAX) {
    const chunk = personal.docs.slice(i, i + BATCH_MAX);
    const batch = writeBatch(db);
    let batchCount = 0;
    for (const d of chunk) {
      const data = d.data() as {
        employeeName?: string;
        row?: { workerName?: string; workerId?: string };
      };
      const patch: Record<string, unknown> = {};
      if ((data.employeeName || "").trim() !== newName) {
        patch.employeeName = newName;
      }
      if (data.row && (data.row.workerId === employeeId || data.row.workerName)) {
        patch.row = { ...data.row, workerName: newName, workerId: employeeId };
      }
      if (!Object.keys(patch).length) continue;
      batch.update(d.ref, patch);
      batchCount += 1;
    }
    if (batchCount) {
      await batch.commit();
      n += batchCount;
    }
  }

  // snapshot ทั้งร้าน
  const months = await getDocs(collection(db, "bonusMonthCloses"));
  for (const d of months.docs) {
    const data = d.data() as {
      snapshot?: { rows?: { workerId?: string; workerName?: string }[] };
    };
    const rows = data.snapshot?.rows;
    if (!Array.isArray(rows)) continue;
    let changed = false;
    const nextRows = rows.map((r) => {
      if (r.workerId !== employeeId) return r;
      if ((r.workerName || "").trim() === newName) return r;
      changed = true;
      return { ...r, workerName: newName };
    });
    if (!changed) continue;
    await updateDoc(doc(db, "bonusMonthCloses", d.id), {
      "snapshot.rows": nextRows,
    });
    n += 1;
  }

  return n;
}

async function rewriteStaffSuggestions(
  employeeId: string,
  newName: string,
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(getDb(), "staffSuggestions"),
      where("employeeId", "==", employeeId),
    ),
  );
  const db = getDb();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_MAX) {
    const chunk = snap.docs.slice(i, i + BATCH_MAX);
    const batch = writeBatch(db);
    let batchCount = 0;
    for (const d of chunk) {
      const cur = String((d.data() as { createdByName?: string }).createdByName || "").trim();
      if (cur === newName) continue;
      batch.update(d.ref, { createdByName: newName });
      batchCount += 1;
    }
    if (batchCount) {
      await batch.commit();
      n += batchCount;
    }
  }
  return n;
}

export type EmployeeRenamePropagateResult = {
  ot: number;
  prod: number;
  tasks: number;
  taskOccurrences: number;
  payroll: number;
  bonusCloses: number;
  suggestions: number;
};

/**
 * กระจายชื่อใหม่ไปยังชง / ผลิต / งาน / คิวจ่าย / snapshot โบนัส
 * เรียกหลังอัปเดต employees.name สำเร็จ — best-effort ต่อระบบ
 */
export async function propagateEmployeeRename(
  employeeId: string,
  newName: string,
  oldNames: string[] = [],
): Promise<EmployeeRenamePropagateResult> {
  const name = newName.trim();
  const result: EmployeeRenamePropagateResult = {
    ot: 0,
    prod: 0,
    tasks: 0,
    taskOccurrences: 0,
    payroll: 0,
    bonusCloses: 0,
    suggestions: 0,
  };
  if (!employeeId || !name) return result;

  const run = async (
    key: keyof EmployeeRenamePropagateResult,
    fn: () => Promise<number>,
  ) => {
    try {
      result[key] = await fn();
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(`[employee-rename] ${key} failed`, err);
      }
    }
  };

  await run("ot", () =>
    rewriteCollectionByArrayContains({
      collectionName: "otEntries",
      employeeId,
      newName: name,
      oldNames,
      idField: "workerIds",
      nameField: "workerNames",
    }),
  );
  await run("prod", () =>
    rewriteCollectionByArrayContains({
      collectionName: "prodEntries",
      employeeId,
      newName: name,
      oldNames,
      idField: "workerIds",
      nameField: "workerNames",
    }),
  );
  await run("tasks", () =>
    rewriteCollectionByArrayContains({
      collectionName: "taskTemplates",
      employeeId,
      newName: name,
      oldNames,
      idField: "assigneeIds",
      nameField: "assigneeNames",
    }),
  );
  await run("taskOccurrences", () =>
    rewriteCollectionByArrayContains({
      collectionName: "taskOccurrences",
      employeeId,
      newName: name,
      oldNames,
      idField: "assigneeIds",
      nameField: "assigneeNames",
    }),
  );
  await run("payroll", () => rewritePayrollEmployeeName(employeeId, name));
  await run("bonusCloses", () => rewriteBonusCloseNames(employeeId, name));
  await run("suggestions", () => rewriteStaffSuggestions(employeeId, name));

  return result;
}

/** แสดงชื่อจากรายชื่อร้านตาม id — กัน UI ค้างชื่อเก่าก่อน rewrite เสร็จ */
export function resolveWorkerDisplayNames(
  workerIds: string[] | undefined,
  workerNames: string[] | undefined,
  roster: { id: string; name: string }[],
): string[] {
  const ids = workerIds || [];
  const names = workerNames || [];
  if (!ids.length) return names.filter(Boolean);
  return ids.map((id, i) => {
    const live = roster.find((w) => w.id === id)?.name?.trim();
    if (live) return live;
    return String(names[i] || "").trim() || id;
  });
}
