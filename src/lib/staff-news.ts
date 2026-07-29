import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const STAFF_NEWS_DOC = "staffNews";

export type StaffNewsNote = {
  id: string;
  title: string;
  body: string;
  /** อยู่ในคลังโนต — เจ้าของเก็บไว้ใช้ภายหลังได้ */
  inWarehouse: boolean;
  /** กำลังแจ้งข่าวสาร (popup) — ทุกคนเห็นจนกว่าเจ้าของจะเอาออกจากแจ้ง */
  announced: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type StaffNewsDoc = {
  notes: StaffNewsNote[];
  updatedAt: number;
  updatedBy: string;
};

const EMPTY: StaffNewsDoc = {
  notes: [],
  updatedAt: 0,
  updatedBy: "",
};

function newsRef() {
  return doc(getDb(), "meta", STAFF_NEWS_DOC);
}

export function normalizeStaffNews(data?: Record<string, unknown> | null): StaffNewsDoc {
  const rawNotes = Array.isArray(data?.notes) ? data.notes : [];
  const notes: StaffNewsNote[] = [];
  for (const row of rawNotes) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "";
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!id || !title) continue;
    const createdAt = typeof r.createdAt === "number" ? r.createdAt : 0;
    const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : createdAt;
    notes.push({
      id,
      title,
      body: typeof r.body === "string" ? r.body.trim() : "",
      inWarehouse: r.inWarehouse !== false,
      announced: r.announced === true,
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : notes.length,
      createdAt,
      updatedAt,
    });
  }
  notes.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt);
  return {
    notes,
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "",
  };
}

/** โนตที่กำลังแจ้ง — เรียงใหม่สุดก่อน */
export function announcedStaffNews(notes: StaffNewsNote[]): StaffNewsNote[] {
  return notes
    .filter((n) => n.announced)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sortOrder - b.sortOrder);
}

export function subscribeStaffNews(
  onNews: (doc: StaffNewsDoc) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    newsRef(),
    (snap) => {
      onNews(snap.exists() ? normalizeStaffNews(snap.data()) : { ...EMPTY });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveStaffNews(notes: StaffNewsNote[], updatedBy: string): Promise<void> {
  const now = Date.now();
  const cleaned = notes
    .map((item, index) => ({
      id: item.id.trim() || `news_${index + 1}`,
      title: item.title.trim(),
      body: item.body.trim(),
      inWarehouse: item.inWarehouse !== false,
      announced: item.announced === true,
      sortOrder: index,
      createdAt: item.createdAt || now,
      updatedAt: now,
    }))
    .filter((item) => item.title)
    // เก็บเฉพาะที่อยู่ในคลังหรือกำลังแจ้ง — ลบออกทั้งสองอย่าง = ทิ้ง
    .filter((item) => item.inWarehouse || item.announced);

  try {
    await setDoc(
      newsRef(),
      {
        notes: cleaned,
        updatedAt: now,
        updatedBy,
      },
      { merge: true },
    );
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกคลังโนต / แจ้งข่าวสาร", "staff"));
  }
}

export function newStaffNewsDraft(partial?: Partial<StaffNewsNote>): StaffNewsNote {
  const now = Date.now();
  return {
    id: partial?.id || `news_${now.toString(36)}`,
    title: partial?.title || "",
    body: partial?.body || "",
    inWarehouse: partial?.inWarehouse !== false,
    announced: partial?.announced === true,
    sortOrder: partial?.sortOrder ?? 0,
    createdAt: partial?.createdAt ?? now,
    updatedAt: now,
  };
}

/** fingerprint สำหรับ session dismiss — เปลี่ยนเนื้อหาแล้วต้องลอยใหม่ */
export function staffNewsAnnounceFingerprint(notes: StaffNewsNote[]): string {
  return announcedStaffNews(notes)
    .map((n) => `${n.id}:${n.updatedAt}`)
    .join("|");
}
