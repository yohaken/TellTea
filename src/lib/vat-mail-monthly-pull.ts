/**
 * ดึงสรุปเดือนจาก Gmail → พรีวิวแหล่งนำเข้า
 * Shopee = เนื้อเมล · LINE MAN = REPORT_*.csv ไฟล์แรก
 */
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import {
  previewIngestText,
  type IngestPreview,
} from "./vat-ingest-preview";
import {
  fetchVatMailStatus,
  startVatMailOAuth,
  type VatMailStatus,
} from "./vat-sales-mail";

export type MailMonthlyPullPiece = {
  ok: boolean;
  channel?: "shopee" | "lineman";
  kind?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  monthKey?: string;
  fileName?: string;
  text?: string;
  error?: string;
  scanned?: number;
};

export type MailMonthlyPullResult = {
  ok: boolean;
  monthKey: string;
  shopee: MailMonthlyPullPiece | null;
  lineman: MailMonthlyPullPiece | null;
};

export async function pullMonthlySourcesFromGmail(opts?: {
  monthKey?: string;
  shopee?: boolean;
  lineman?: boolean;
}): Promise<MailMonthlyPullResult> {
  const fn = httpsCallable<
    { monthKey?: string; shopee?: boolean; lineman?: boolean },
    MailMonthlyPullResult
  >(getFirebaseFunctions(), "vatMailPullMonthlySources");
  const res = await fn({
    ...(opts?.monthKey ? { monthKey: opts.monthKey } : {}),
    ...(opts?.shopee === false ? { shopee: false } : {}),
    ...(opts?.lineman === false ? { lineman: false } : {}),
  });
  return {
    ok: Boolean(res.data?.ok),
    monthKey: String(res.data?.monthKey || opts?.monthKey || ""),
    shopee: res.data?.shopee || null,
    lineman: res.data?.lineman || null,
  };
}

export function pieceToIngestPreview(
  piece: MailMonthlyPullPiece | null,
): IngestPreview | null {
  if (!piece?.ok || !piece.text) return null;
  const preview = previewIngestText(piece.text, {
    fileName: piece.fileName || "",
  });
  const warnings = [...preview.warnings];
  if (piece.subject) {
    warnings.unshift(`เมล: ${piece.subject}`);
  }
  return {
    ...preview,
    fileName: piece.fileName || preview.fileName || "(จาก Gmail)",
    monthKey: piece.monthKey || preview.monthKey,
    warnings,
  };
}

export async function loadMailIngestStatus(): Promise<VatMailStatus> {
  return fetchVatMailStatus();
}

export async function connectGmailForIngest(returnTo?: string): Promise<string> {
  return startVatMailOAuth(
    returnTo ||
      (typeof window !== "undefined"
        ? `${window.location.origin}/vat-sales/sources/?mail=connected`
        : "https://telltea-shop.web.app/vat-sales/sources/?mail=connected"),
  );
}
