/**
 * Owner-triggered prune of old platform email raw bodies.
 * Keeps metadata / parsed; clears rawText + rawHtml past retention.
 */

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  doc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { appendVatSalesAudit } from "./vat-sales-audit";
import { PLATFORM_EMAIL_REPORTS_COL } from "./vat-sales-mail";

export type PruneMailRawResult = {
  scanned: number;
  pruned: number;
  cutoffMs: number;
  months: number;
};

export async function prunePlatformEmailRaw(opts: {
  months: number;
  actor: string;
  maxScan?: number;
  dryRun?: boolean;
}): Promise<PruneMailRawResult> {
  const months = Math.min(36, Math.max(1, Math.floor(opts.months)));
  const maxScan = Math.min(500, Math.max(50, opts.maxScan || 300));
  const cutoffMs = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

  // เฉพาะเมลเก่ากว่า cutoff — ไม่ดึงชุดเดิมที่ prune แล้วซ้ำ
  const snap = await getDocs(
    query(
      collection(getDb(), PLATFORM_EMAIL_REPORTS_COL),
      where("receivedAt", "<", cutoffMs),
      orderBy("receivedAt", "asc"),
      limit(maxScan),
    ),
  );

  let scanned = 0;
  let pruned = 0;
  for (const d of snap.docs) {
    scanned += 1;
    const data = d.data() as Record<string, unknown>;
    if (data.rawPrunedAt) continue;
    const rawText = String(data.rawText || "");
    const rawHtml = String(data.rawHtml || "");
    if (!rawText && !rawHtml) continue;
    if (!opts.dryRun) {
      await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, d.id), {
        rawText: "",
        rawHtml: "",
        rawPrunedAt: Date.now(),
        rawPrunedBy: opts.actor,
      });
    }
    pruned += 1;
  }

  if (!opts.dryRun && pruned > 0) {
    await appendVatSalesAudit({
      action: "prune_mail_raw",
      summary: `ลบ raw เมลเก่ากว่า ${months} เดือน · ${pruned} ฉบับ`,
      after: { months, pruned, scanned, cutoffMs },
      actor: opts.actor,
    });
  }

  return { scanned, pruned, cutoffMs, months };
}
