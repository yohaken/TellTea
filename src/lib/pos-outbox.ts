import type { PosOutboxEntry } from "./pos-sync-types";

const DB_NAME = "telltea-pos-sync";
const DB_VERSION = 1;
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB ไม่พร้อมใช้งาน"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("เปิด outbox ไม่สำเร็จ"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error || new Error("outbox transaction failed"));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error || new Error("outbox transaction failed"));
      }),
  );
}

export async function addOutboxEntry(entry: PosOutboxEntry): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
}

export async function getOutboxEntry(id: string): Promise<PosOutboxEntry | null> {
  const row = await withStore<PosOutboxEntry | undefined>("readonly", (store) => store.get(id));
  return row ?? null;
}

export async function listOutboxEntries(): Promise<PosOutboxEntry[]> {
  const rows = await withStore<PosOutboxEntry[]>("readonly", (store) => store.getAll());
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOutboxEntry(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function bumpOutboxAttempt(id: string, lastError: string): Promise<void> {
  const entry = await getOutboxEntry(id);
  if (!entry) return;
  await addOutboxEntry({
    ...entry,
    attempts: entry.attempts + 1,
    lastError: lastError.slice(0, 240),
  });
}

export async function countOutboxEntries(): Promise<number> {
  const rows = await listOutboxEntries();
  return rows.length;
}
