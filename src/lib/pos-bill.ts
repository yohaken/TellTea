import { doc, runTransaction } from "firebase/firestore";
import { getPosDb } from "./pos-firebase";
import { startOfLocalDay } from "./utils";

function formatBillNo(dateMs: number, seq: number): string {
  const local = new Date(dateMs);
  const dd = String(local.getDate()).padStart(2, "0");
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  return `P${dd}${mm}-${String(seq).padStart(3, "0")}`;
}

/** Daily bill number — P1307-001 (resets each calendar day). */
export async function allocatePosBillNo(): Promise<string> {
  const db = getPosDb();
  const ref = doc(db, "meta", "pos");
  const today = startOfLocalDay();

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { billDate?: number; billSeq?: number } | undefined;
    let seq = 1;
    if (data?.billDate === today && typeof data.billSeq === "number") {
      seq = data.billSeq + 1;
    }
    tx.set(ref, { billDate: today, billSeq: seq, updatedAt: Date.now() }, { merge: true });
    return formatBillNo(today, seq);
  });
}

export function formatPosBillNoLabel(billNo: string): string {
  return billNo.startsWith("P") ? billNo : `P${billNo}`;
}
