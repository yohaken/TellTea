import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { getDb } from "./firebase";
import patch from "./owner-notes-patch.json";

type NotePatch = {
  date: number;
  description: string;
  amountOut: number;
  note: string;
};

function matchKey(date: number, description: string, amountOut: number) {
  return `${date}|${description}|${Number(amountOut)}`;
}

/** Apply notes from the original บช. เจ้าของ.xlsx (20 rows). Idempotent. */
export async function backfillOwnerNotesFromPatch(): Promise<{
  updated: number;
  skipped: number;
  missing: number;
}> {
  const rows = patch as NotePatch[];
  const snap = await getDocs(collection(getDb(), "ownerBooks"));
  const byKey = new Map<string, { id: string; note: string }[]>();
  for (const d of snap.docs) {
    const data = d.data();
    const key = matchKey(
      Number(data.date) || 0,
      String(data.description || ""),
      Number(data.amountOut) || 0,
    );
    const list = byKey.get(key) || [];
    list.push({ id: d.id, note: String(data.note || "") });
    byKey.set(key, list);
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  const used = new Set<string>();

  for (const row of rows) {
    const key = matchKey(row.date, row.description, row.amountOut);
    const candidates = (byKey.get(key) || []).filter((c) => !used.has(c.id));
    const target = candidates.find((c) => !c.note) || candidates[0];
    if (!target) {
      missing += 1;
      continue;
    }
    used.add(target.id);
    if (target.note) {
      skipped += 1;
      continue;
    }
    await updateDoc(doc(getDb(), "ownerBooks", target.id), {
      note: row.note,
      updatedAt: Date.now(),
    });
    updated += 1;
  }

  return { updated, skipped, missing };
}
