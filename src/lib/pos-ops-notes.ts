import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import { POS_APK_DOWNLOAD_URL, POS_APK_INSTALL_PAGE_URL } from "./pos-url";

export const POS_OPS_NOTES_DOC = "posOpsNotes";

export type PosOpsNoteItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  sortOrder: number;
  updatedAt: number;
};

export type PosOpsNotes = {
  items: PosOpsNoteItem[];
  updatedAt: number;
  updatedBy: string;
};

const EMPTY: PosOpsNotes = {
  items: [],
  updatedAt: 0,
  updatedBy: "",
};

/** ค่าเริ่มต้นแนะนำ — ลิงก์ติดตั้ง APK (เจ้าของแก้/เพิ่มได้) */
export function defaultPosOpsNoteItems(now = Date.now()): PosOpsNoteItem[] {
  return [
    {
      id: "apk-install",
      title: "ดาวน์โหลดแอป TellTea POS",
      body: "เปิดด้วย Chrome บนแท็บเล็ต → กดดาวน์โหลด → ติดตั้ง",
      url: POS_APK_INSTALL_PAGE_URL,
      sortOrder: 0,
      updatedAt: now,
    },
    {
      id: "apk-file",
      title: "ไฟล์ติดตั้งตรงๆ (.apk)",
      body: "ถ้าหน้าดาวน์โหลดเปิดไม่ได้ ใช้ลิงก์นี้",
      url: POS_APK_DOWNLOAD_URL,
      sortOrder: 1,
      updatedAt: now,
    },
  ];
}

export function normalizePosOpsNotes(data?: Record<string, unknown> | null): PosOpsNotes {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: PosOpsNoteItem[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "";
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!id || !title) continue;
    items.push({
      id,
      title,
      body: typeof r.body === "string" ? r.body.trim() : "",
      url: typeof r.url === "string" ? r.url.trim() : "",
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : items.length,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    });
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "th"));
  return {
    items,
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "",
  };
}

function adminRef() {
  return doc(getDb(), "meta", POS_OPS_NOTES_DOC);
}

function posRef() {
  return doc(getPosDb(), "meta", POS_OPS_NOTES_DOC);
}

/** หลังบ้าน (เจ้าของ) */
export function subscribePosOpsNotesAdmin(
  onNotes: (notes: PosOpsNotes) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    adminRef(),
    (snap) => {
      onNotes(snap.exists() ? normalizePosOpsNotes(snap.data()) : { ...EMPTY });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** แท็บเล็ต POS (device auth / anonymous) */
export function subscribePosOpsNotes(
  onNotes: (notes: PosOpsNotes) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    posRef(),
    (snap) => {
      onNotes(snap.exists() ? normalizePosOpsNotes(snap.data()) : { ...EMPTY });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function savePosOpsNotes(
  items: PosOpsNoteItem[],
  updatedBy: string,
): Promise<void> {
  const now = Date.now();
  const cleaned = items
    .map((item, index) => ({
      id: item.id.trim() || `note_${index + 1}`,
      title: item.title.trim(),
      body: item.body.trim(),
      url: item.url.trim(),
      sortOrder: index,
      updatedAt: now,
    }))
    .filter((item) => item.title);

  try {
    await setDoc(
      adminRef(),
      {
        items: cleaned,
        updatedAt: now,
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกลิงก์หน้าร้าน", "pos"));
  }
}

export function newPosOpsNoteDraft(partial?: Partial<PosOpsNoteItem>): PosOpsNoteItem {
  const now = Date.now();
  return {
    id: partial?.id || `note_${now.toString(36)}`,
    title: partial?.title || "",
    body: partial?.body || "",
    url: partial?.url || "",
    sortOrder: partial?.sortOrder ?? 0,
    updatedAt: now,
  };
}
