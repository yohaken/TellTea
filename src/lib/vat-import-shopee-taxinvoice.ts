/**
 * อะแดปเตอร์ Shopee — ใบเสร็จรับเงิน/ใบกำกับภาษี (Commission Fee) รายวัน
 * ได้ภาษีซื้อ GP + เลขที่ใบกำกับ · ไม่มียอดขาย/ยอดโอน
 */
import { normalizeMoney, roundMoney } from "./vat-sales";
import type { VatImportRowInput } from "./vat-import";
import { isDateKey, monthKeyFromDateKey } from "./vat-import";

export const SHOPEE_TAXINVOICE_ADAPTER_ID = "shopee-taxinvoice-pdf";
export const SHOPEE_TAXINVOICE_ADAPTER_VERSION = "1";

export type ShopeeTaxInvoiceParseResult = {
  adapterId: typeof SHOPEE_TAXINVOICE_ADAPTER_ID;
  adapterVersion: typeof SHOPEE_TAXINVOICE_ADAPTER_VERSION;
  dateKey: string;
  monthKey: string;
  invoiceNo: string;
  sellerTaxId: string;
  feeExVat: number;
  gpVat: number;
  feeInclVat: number;
  merchantName: string;
  warnings: string[];
};

function parseMoney(raw: string): number {
  const t = String(raw || "")
    .trim()
    .replace(/[฿,\s]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

export function looksLikeShopeeTaxInvoice(text: string): boolean {
  const t = text || "";
  return (
    (t.includes("Shopee (Thailand)") || t.includes("Shopee")) &&
    (t.includes("ใบกำกับภาษี") || t.includes("Tax Invoice")) &&
    (t.includes("Commission Fee") || t.includes("ค่าคอมมิชชั่น"))
  );
}

/** จากชื่อไฟล์ TRSPESPF00-00000-260715-016860.pdf */
export function parseShopeeInvoiceFromFileName(fileName: string): {
  invoiceNo: string;
  dateKey: string;
} {
  const base = String(fileName || "").replace(/\.pdf$/i, "");
  // TRSPESPF00-00000-260715-016860
  const m = base.match(
    /^(TRSPESPF\d+-00000)-(\d{2})(\d{2})(\d{2})-(\d+)$/i,
  );
  if (!m) return { invoiceNo: base, dateKey: "" };
  const yy = Number(m[2]);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const dateKey = `${year}-${m[3]}-${m[4]}`;
  const invoiceNo = `${m[1]}-${m[2]}${m[3]}${m[4]}-${m[5]}`;
  return { invoiceNo, dateKey: isDateKey(dateKey) ? dateKey : "" };
}

export function parseShopeeTaxInvoice(
  text: string,
  fileName = "",
): ShopeeTaxInvoiceParseResult {
  const warnings: string[] = [];
  if (!looksLikeShopeeTaxInvoice(text)) {
    warnings.push("ข้อความไม่เหมือนใบกำกับ Shopee");
  }
  const fromName = parseShopeeInvoiceFromFileName(fileName);

  // เลขที่อาจขึ้นบรรทัดใหม่: TRSPESPF00-00000-26\n0715-016860
  let invoiceNo = fromName.invoiceNo;
  const noBlock = text.match(
    /เลขที่\/\s*No\.\s*(TRSPESPF[0-9A-Z-]+)\s*[\r\n]+\s*(\d{4}-\d+)/i,
  );
  if (noBlock) {
    invoiceNo = `${noBlock[1]}${noBlock[2]}`.replace(
      /(TRSPESPF\d+-00000-)(\d{2})(\d{4}-\d+)/i,
      (_, a, yy, rest) => `${a}${yy}${rest}`,
    );
    // normalize: TRSPESPF00-00000-26 + 0715-016860 → TRSPESPF00-00000-260715-016860
    const compact = text.match(
      /เลขที่\/\s*No\.\s*(TRSPESPF\d+-00000-)(\d{2})\s*[\r\n]+\s*(\d{4})-(\d+)/i,
    );
    if (compact) {
      invoiceNo = `${compact[1]}${compact[2]}${compact[3]}-${compact[4]}`;
    }
  } else {
    const oneLine = text.match(/เลขที่\/\s*No\.\s*(TRSPESPF[0-9A-Z-]+)/i);
    if (oneLine) invoiceNo = oneLine[1]!.trim();
  }

  let dateKey = fromName.dateKey;
  const dateM = text.match(/วันที่\/\s*Date\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (dateM) {
    dateKey = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;
  }
  if (!isDateKey(dateKey)) {
    warnings.push("อ่านวันที่ไม่ได้");
    dateKey = "";
  }

  const feeEx =
    text.match(
      /Total Value of Services \(Excluded VAT\)[^\d]*([\d,]+\.\d{2})/i,
    ) ||
    text.match(
      /มูลค่าก่อนภาษีมูลค่าเพิ่ม\/\s*Total Value of Services \(Excluded VAT\)\s*([\d,]+\.\d{2})/,
    );
  const vatM =
    text.match(/VAT 7%\s*([\d,]+\.\d{2})/i) ||
    text.match(/ภาษีมูลค่าเพิ่ม 7%\/\s*VAT 7%\s*([\d,]+\.\d{2})/);
  const feeInc =
    text.match(
      /Total Value of Services \(Included VAT\)\s*([\d,]+\.\d{2})/i,
    ) ||
    text.match(
      /มูลค่าบริการรวมภาษีมูลค่าเพิ่ม\/\s*Total Value of Services \(Included VAT\)\s*([\d,]+\.\d{2})/,
    );

  const feeExVat = parseMoney(feeEx?.[1] || "0");
  const gpVat = parseMoney(vatM?.[1] || "0");
  const feeInclVat = parseMoney(feeInc?.[1] || "0") || roundMoney(feeExVat + gpVat);

  const taxIdM = text.match(
    /Tax ID No\.?\s*([0-9]+)/i,
  ); // seller (Shopee)
  // customer tax id line: เลขประจำตัวผู้เสียภาษี/ Tax ID 14299...
  const customerTax = text.match(
    /เลขประจำตัวผู้เสียภาษี\/\s*Tax ID\s*([0-9]+)/,
  );

  const merchant =
    text.match(/Merchant\s*Name\s*([^\n]+)/i)?.[1]?.trim() ||
    text.match(/Kongsi[^\n]*/)?.[0]?.trim() ||
    "";

  if (!(gpVat > 0)) warnings.push("ไม่พบยอด VAT");
  if (!invoiceNo) warnings.push("ไม่พบเลขที่ใบกำกับ");

  return {
    adapterId: SHOPEE_TAXINVOICE_ADAPTER_ID,
    adapterVersion: SHOPEE_TAXINVOICE_ADAPTER_VERSION,
    dateKey,
    monthKey: dateKey ? monthKeyFromDateKey(dateKey) : "",
    invoiceNo: invoiceNo || fromName.invoiceNo,
    sellerTaxId: taxIdM?.[1] || "0105558019581",
    feeExVat,
    gpVat,
    feeInclVat,
    merchantName: merchant,
    warnings,
  };
}

export function shopeeTaxInvoiceToImportRow(
  parsed: ShopeeTaxInvoiceParseResult,
  opts?: {
    storagePath?: string;
    downloadUrl?: string;
    fileName?: string;
    contentType?: string;
    contentHash?: string;
  },
): VatImportRowInput | null {
  if (!parsed.dateKey || !parsed.monthKey) return null;
  return {
    monthKey: parsed.monthKey,
    dateKey: parsed.dateKey,
    channel: "shopee",
    rowKind: "tax_invoice",
    grossInclusive: 0,
    fee: normalizeMoney(parsed.feeInclVat),
    netTransfer: 0,
    gpVat: normalizeMoney(parsed.gpVat),
    invoiceNo: parsed.invoiceNo,
    invoiceDate: parsed.dateKey,
    sellerTaxId: parsed.sellerTaxId,
    storagePath: opts?.storagePath || "",
    downloadUrl: opts?.downloadUrl || "",
    fileName: opts?.fileName || "",
    contentType: opts?.contentType || "application/pdf",
    contentHash: opts?.contentHash || "",
    adapterId: SHOPEE_TAXINVOICE_ADAPTER_ID,
    adapterVersion: SHOPEE_TAXINVOICE_ADAPTER_VERSION,
    externalId: `shopee-inv:${parsed.invoiceNo}`,
    status: "draft",
    note: "Shopee ใบกำกับ Commission · มีแต่ภาษีซื้อ GP",
    appliedAt: null,
    appliedToMonth: "",
  };
}
